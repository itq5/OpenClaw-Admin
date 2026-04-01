import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  Channel,
  ChannelAccountConfig,
  ChannelConfig,
  ConfigPatch,
  OpenClawConfig,
  PluginPackage,
} from '@/api/types'
import { ConnectionState } from '@/api/types'
import { useWebSocketStore } from './websocket'
import { useRpcSafe } from '@/composables/useRpcSafe'
import {
  buildChannelPatches,
  cloneChannelConfigs,
  deriveAccountId,
  deriveChannelKey,
  ensureAccountConfig,
  ensureChannelConfig,
  removeAccountConfig,
} from '@/utils/channel-config'
import { normalizeSecretInput } from '@/utils/secret-mask'
import { byLocale, getActiveLocale } from '@/i18n/text'

type SecretScope = {
  channelKey: string
  field: string
  accountId?: string
}

type PluginInstallHints = {
  channelKey?: string
  pluginIds?: string[]
}

const PLUGIN_LIST_METHODS = ['plugins.list', 'plugin.list', 'plugins.status', 'plugin.status']

function asAccountsRecord(value: unknown): Record<string, ChannelAccountConfig> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, ChannelAccountConfig> = {}
  for (const [key, accountValue] of Object.entries(value as Record<string, unknown>)) {
    if (!accountValue || typeof accountValue !== 'object' || Array.isArray(accountValue)) continue
    result[key] = accountValue as ChannelAccountConfig
  }
  return result
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function secretScopeKey(scope: SecretScope): string {
  return `${scope.channelKey}|${scope.accountId || ''}|${scope.field}`
}

function splitSecretScopeKey(raw: string): SecretScope | null {
  const parts = raw.split('|')
  if (parts.length !== 3) return null
  const [channelKey, accountId, field] = parts
  if (!channelKey || !field) return null
  return {
    channelKey,
    accountId: accountId || undefined,
    field,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const useChannelManagementStore = defineStore('channel-management', () => {
  const wsStore = useWebSocketStore()
  const rpc = useRpcSafe()

  const loading = ref(false)
  const saving = ref(false)
  const applying = ref(false)
  const runtimeChannels = ref<Channel[]>([])
  const configSnapshot = ref<OpenClawConfig | null>(null)
  const channelsBaseline = ref<Record<string, ChannelConfig>>({})
  const channelsDraft = ref<Record<string, ChannelConfig>>({})
  const plugins = ref<PluginPackage[]>([])
  const pluginInstalledMap = ref<Record<string, boolean>>({})
  const pluginRpcSupported = ref(true)
  const pluginLastError = ref<string | null>(null)
  const secretUpdates = ref<Record<string, string>>({})
  const lastError = ref<string | null>(null)

  function normalizePluginName(name: string): string {
    return name.trim().toLowerCase()
  }

  function pluginNameVariants(rawName: string): string[] {
    const normalized = normalizePluginName(rawName)
    if (!normalized) return []

    const result = new Set<string>([normalized])
    const withoutScope = normalized.replace(/^@[^/]+\//, '')
    if (withoutScope) result.add(withoutScope)

    const slashTail = normalized.split('/').pop() || ''
    if (slashTail) result.add(slashTail)

    if (slashTail.startsWith('openclaw-')) {
      result.add(slashTail.slice('openclaw-'.length))
    }
    if (slashTail.startsWith('openclaw-china-')) {
      result.add(slashTail.slice('openclaw-china-'.length))
    }
    if (slashTail.endsWith('-china')) {
      result.add(slashTail.slice(0, -'-china'.length))
    }

    return Array.from(result).filter(Boolean)
  }

  function markInstalledByName(target: Record<string, boolean>, name: string, installed: boolean): void {
    for (const key of pluginNameVariants(name)) {
      target[key] = installed
    }
  }

  function mergeInstalledMap(base: Record<string, boolean>, overrides: Record<string, boolean>): Record<string, boolean> {
    return {
      ...base,
      ...overrides,
    }
  }

  function inferInstalledPluginMapFromConfigAndRuntime(): Record<string, boolean> {
    const inferred: Record<string, boolean> = {}

    for (const item of runtimeChannels.value) {
      const channelKey = deriveChannelKey(item)
      if (channelKey && channelKey !== 'unknown') {
        markInstalledByName(inferred, channelKey, true)
      }
      const explicitChannelKey = asString(item.channelKey)
      if (explicitChannelKey) {
        markInstalledByName(inferred, explicitChannelKey, true)
      }
      const platform = asString(item.platform)
      if (platform && platform !== 'unknown') {
        markInstalledByName(inferred, platform, true)
      }
    }

    const pluginsConfig = asRecord(configSnapshot.value?.plugins)
    const installs = asRecord(pluginsConfig.installs)
    for (const [pluginId, installValue] of Object.entries(installs)) {
      markInstalledByName(inferred, pluginId, true)
      const installRecord = asRecord(installValue)
      const spec = asString(installRecord.spec)
      if (spec) {
        markInstalledByName(inferred, spec, true)
      }
    }

    const entries = asRecord(pluginsConfig.entries)
    for (const pluginId of Object.keys(entries)) {
      markInstalledByName(inferred, pluginId, true)
    }

    for (const pluginId of asStringArray(pluginsConfig.allow)) {
      markInstalledByName(inferred, pluginId, true)
    }
    for (const pluginId of asStringArray(pluginsConfig.deny)) {
      markInstalledByName(inferred, pluginId, true)
    }

    return inferred
  }

  function syncPluginInstalledMap(): void {
    const inferred = inferInstalledPluginMapFromConfigAndRuntime()
    if (!pluginRpcSupported.value || plugins.value.length === 0) {
      pluginInstalledMap.value = inferred
      return
    }

    const rpcMap: Record<string, boolean> = {}
    for (const item of plugins.value) {
      markInstalledByName(rpcMap, item.name, item.installed)
    }
    pluginInstalledMap.value = mergeInstalledMap(inferred, rpcMap)
  }

  function normalizePluginRpcErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    if (/unknown method/i.test(message) || /method not found/i.test(message)) {
      return byLocale(
        'Gateway 当前版本未提供插件列表 RPC（plugins.list）',
        'This Gateway does not support plugins.list RPC',
        getActiveLocale(),
      )
    }
    return message
  }

  const runtimeByChannel = computed(() => {
    const grouped: Record<string, Channel[]> = {}
    for (const channel of runtimeChannels.value) {
      const channelKey = deriveChannelKey(channel)
      if (!grouped[channelKey]) grouped[channelKey] = []
      grouped[channelKey].push(channel)
    }
    return grouped
  })

  const allChannelKeys = computed(() => {
    return Array.from(
      new Set([...Object.keys(channelsDraft.value), ...Object.keys(runtimeByChannel.value)])
    ).sort()
  })

  function resetDraftFromConfig(config: OpenClawConfig): void {
    const channels = cloneChannelConfigs(config.channels)
    configSnapshot.value = config
    channelsBaseline.value = channels
    channelsDraft.value = cloneChannelConfigs(channels)
    secretUpdates.value = {}
    syncPluginInstalledMap()
  }

  async function refreshRuntimeChannels(): Promise<void> {
    runtimeChannels.value = await rpc.call(() => wsStore.rpc.listChannels(), {
      label: 'listChannels', timeout: 10000, retries: 1,
    })
    syncPluginInstalledMap()
  }

  async function refreshAll(): Promise<void> {
    loading.value = true
    lastError.value = null
    try {
      const [runtime, config] = await Promise.all([
        rpc.call(() => wsStore.rpc.listChannels(), { label: 'listChannels', timeout: 10000, retries: 1 }),
        rpc.call(() => wsStore.rpc.getConfig(), { label: 'getConfig', timeout: 12000, retries: 1 }),
      ])
      runtimeChannels.value = runtime
      resetDraftFromConfig(config)
      await refreshPlugins()
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      loading.value = false
    }
  }

  function ensureDraftChannel(channelKey: string): ChannelConfig {
    return ensureChannelConfig(channelsDraft.value, channelKey)
  }

  function ensureDraftAccount(channelKey: string, accountId: string): ChannelAccountConfig {
    return ensureAccountConfig(channelsDraft.value, channelKey, accountId)
  }

  function upsertAccount(channelKey: string, accountId: string): void {
    ensureDraftAccount(channelKey, accountId)
  }

  function deleteAccount(channelKey: string, accountId: string): void {
    removeAccountConfig(channelsDraft.value, channelKey, accountId)
  }

  function replaceChannelConfig(channelKey: string, nextConfig: ChannelConfig): void {
    const normalizedKey = channelKey.trim().toLowerCase()
    channelsDraft.value[normalizedKey] = nextConfig
  }

  function replaceAccountConfig(
    channelKey: string,
    accountId: string,
    nextConfig: ChannelAccountConfig
  ): void {
    const channelConfig = ensureDraftChannel(channelKey)
    const accounts = asAccountsRecord(channelConfig.accounts)
    accounts[accountId] = nextConfig
    channelConfig.accounts = accounts
  }

  function setChannelField(channelKey: string, field: string, value: unknown): void {
    const channelConfig = ensureDraftChannel(channelKey) as Record<string, unknown>
    if (value === undefined) {
      delete channelConfig[field]
      return
    }
    channelConfig[field] = value
  }

  function setAccountField(channelKey: string, accountId: string, field: string, value: unknown): void {
    const accountConfig = ensureDraftAccount(channelKey, accountId) as Record<string, unknown>
    if (value === undefined) {
      delete accountConfig[field]
      return
    }
    accountConfig[field] = value
  }

  function setSecretUpdate(scope: SecretScope, rawValue: string): void {
    const normalized = normalizeSecretInput(rawValue)
    const key = secretScopeKey(scope)
    if (!normalized) {
      delete secretUpdates.value[key]
      return
    }
    secretUpdates.value[key] = normalized
  }

  function getSecretUpdate(scope: SecretScope): string {
    return secretUpdates.value[secretScopeKey(scope)] || ''
  }

  function hasSecretUpdate(scope: SecretScope): boolean {
    return Object.prototype.hasOwnProperty.call(secretUpdates.value, secretScopeKey(scope))
  }

  async function refreshPlugins(): Promise<void> {
    pluginLastError.value = null

    const hasMethodSnapshot = wsStore.gatewayMethods.length > 0
    if (hasMethodSnapshot && !wsStore.supportsAnyMethod(PLUGIN_LIST_METHODS)) {
      plugins.value = []
      pluginRpcSupported.value = false
      syncPluginInstalledMap()
      return
    }

    try {
      const list = await rpc.call(() => wsStore.rpc.listPlugins(), {
        label: 'listPlugins', timeout: 10000, retries: 0,
      })
      plugins.value = list
      pluginRpcSupported.value = true
    } catch (error) {
      plugins.value = []
      pluginRpcSupported.value = false
      pluginLastError.value = normalizePluginRpcErrorMessage(error)
    } finally {
      syncPluginInstalledMap()
    }
  }

  function isPluginInstalled(pluginNames: string[], hints?: PluginInstallHints): boolean {
    const candidates = [...pluginNames]
    if (hints?.pluginIds?.length) {
      candidates.push(...hints.pluginIds)
    }
    if (hints?.channelKey) {
      candidates.push(hints.channelKey)
    }

    return candidates.some((candidate) =>
      pluginNameVariants(candidate).some((key) => pluginInstalledMap.value[key] === true)
    )
  }

  async function installChannelPlugin(pluginNames: string[]): Promise<string> {
    if (pluginNames.length === 0) {
      throw new Error(byLocale('未提供可安装插件', 'No installable plugin provided', getActiveLocale()))
    }

    let lastInstallError: unknown
    for (const pluginName of pluginNames) {
      try {
        await rpc.call(() => wsStore.rpc.installPlugin(pluginName), {
          label: 'installPlugin', timeout: 30000, retries: 0,
        })
        await refreshPlugins()
        return pluginName
      } catch (error) {
        lastInstallError = error
      }
    }

    throw lastInstallError instanceof Error
      ? lastInstallError
      : new Error(byLocale('远程安装失败', 'Remote install failed', getActiveLocale()))
  }

  function buildPersistedChannelsDraft(): Record<string, ChannelConfig> {
    const draft = cloneChannelConfigs(channelsDraft.value)

    for (const [rawKey, value] of Object.entries(secretUpdates.value)) {
      const scope = splitSecretScopeKey(rawKey)
      if (!scope) continue

      if (scope.accountId) {
        const accountConfig = ensureAccountConfig(draft, scope.channelKey, scope.accountId) as Record<string, unknown>
        accountConfig[scope.field] = value
        continue
      }

      const channelConfig = ensureChannelConfig(draft, scope.channelKey) as Record<string, unknown>
      channelConfig[scope.field] = value
    }

    return draft
  }

  async function waitForGatewayReconnect(timeoutMs = 35000): Promise<boolean> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      if (wsStore.state === ConnectionState.CONNECTED) {
        return true
      }
      await sleep(500)
    }
    return false
  }

  async function applyConfigAndRefresh(): Promise<void> {
    applying.value = true
    lastError.value = null
    try {
      await rpc.call(() => wsStore.rpc.applyConfig(), {
        label: 'applyConfig', timeout: 15000, retries: 0,
      })
    } catch (error) {
      // config.apply 可能触发连接重置，允许继续等待重连
      console.warn('[ChannelManagement] applyConfig request interrupted:', error)
    }

    try {
      const connected = await waitForGatewayReconnect()
      if (!connected) {
        throw new Error(byLocale('配置应用后重连超时，请检查 Gateway 状态', 'Reconnect timed out after apply. Please check Gateway status.', getActiveLocale()))
      }
      await refreshRuntimeChannels()
    } finally {
      applying.value = false
    }
  }

  async function saveChannels(options?: { apply?: boolean }): Promise<ConfigPatch[]> {
    saving.value = true
    lastError.value = null
    try {
      const nextChannels = buildPersistedChannelsDraft()
      const patches = buildChannelPatches(channelsBaseline.value, nextChannels)
      if (patches.length === 0) {
        return []
      }

      await rpc.call(() => wsStore.rpc.patchConfig(patches), {
        label: 'patchConfig', timeout: 15000, retries: 1,
      })
      const latestConfig = await rpc.call(() => wsStore.rpc.getConfig(), {
        label: 'getConfig', timeout: 12000, retries: 1,
      })
      resetDraftFromConfig(latestConfig)
      await refreshRuntimeChannels()

      if (options?.apply) {
        await applyConfigAndRefresh()
      }

      return patches
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      saving.value = false
    }
  }

  async function authChannel(channel: Channel): Promise<void> {
    await rpc.call(
      () =>
        wsStore.rpc.authChannel({
          channelId: channel.id,
          channelKey: deriveChannelKey(channel),
          accountId: deriveAccountId(channel),
        }),
      { label: 'authChannel', timeout: 15000, retries: 0 }
    )
    await refreshRuntimeChannels()
  }

  async function pairChannel(channel: Channel, code: string): Promise<void> {
    await rpc.call(
      () =>
        wsStore.rpc.pairChannel({
          channelId: channel.id,
          channelKey: deriveChannelKey(channel),
          accountId: deriveAccountId(channel),
          code,
        }),
      { label: 'pairChannel', timeout: 15000, retries: 0 }
    )
    await refreshRuntimeChannels()
  }

  return {
    loading,
    saving,
    applying,
    runtimeChannels,
    configSnapshot,
    channelsBaseline,
    channelsDraft,
    plugins,
    pluginInstalledMap,
    pluginRpcSupported,
    pluginLastError,
    secretUpdates,
    lastError,
    allChannelKeys,
    runtimeByChannel,
    refreshAll,
    refreshRuntimeChannels,
    ensureDraftChannel,
    ensureDraftAccount,
    upsertAccount,
    deleteAccount,
    replaceChannelConfig,
    replaceAccountConfig,
    setChannelField,
    setAccountField,
    setSecretUpdate,
    getSecretUpdate,
    hasSecretUpdate,
    refreshPlugins,
    isPluginInstalled,
    installChannelPlugin,
    saveChannels,
    applyConfigAndRefresh,
    authChannel,
    pairChannel,
  }
})
