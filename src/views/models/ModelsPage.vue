<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NCode,
  NCollapse,
  NCollapseItem,
  NDataTable,
  NDescriptions,
  NDescriptionsItem,
  NEmpty,
  NForm,
  NFormItem,
  NGrid,
  NGridItem,
  NIcon,
  NInput,
  NModal,
  NPopconfirm,
  NSelect,
  NSpace,
  NTabPane,
  NTag,
  NTabs,
  NText,
  useMessage,
} from 'naive-ui'
import { AddOutline, CheckmarkCircleOutline, CloseOutline, CreateOutline, RefreshOutline, SaveOutline, TrashOutline } from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useConfigStore } from '@/stores/config'
import { useWebSocketStore } from '@/stores/websocket'
import type { DataTableColumns } from 'naive-ui'
import type { ConfigPatch, ModelProviderConfig, OpenClawConfig } from '@/api/types'

const configStore = useConfigStore()
const wsStore = useWebSocketStore()
const message = useMessage()
const { t, locale } = useI18n()

function joinDisplayList(values: string[]): string {
  const separator = locale.value === 'zh-CN' ? '、' : ', '
  return values.join(separator)
}

const primaryModel = ref('')
const selectedProviderId = ref('')
const providerSearch = ref('')
const showEditProviderModal = ref(false)
const showCreateProviderModal = ref(false)
const showSaveConfirmModal = ref(false)
const confirmActionType = ref<'edit' | 'create'>('edit')
const editActiveTab = ref<'basic' | 'models' | 'preview'>('basic')
const createActiveTab = ref<'basic' | 'models' | 'preview'>('basic')

type ModelInputType = 'text' | 'image' | 'video'

type ModelConfig = {
  id: string
  input: ModelInputType[]
  raw?: Record<string, unknown>
}

const modelInputTypeOptions = [
  { label: 'text', value: 'text' },
  { label: 'image', value: 'image' },
  { label: 'video', value: 'video' },
]

const DEFAULT_MODEL_INPUT_TYPES: ModelInputType[] = ['text']

type QuickProviderKey = 'zhipu' | 'kimi' | 'minimax' | 'bailian'

type QuickProviderPreset = {
  key: QuickProviderKey
  providerId: string
  api: string
  baseUrl: string
  modelId: string
  modelName: string
  input: ModelInputType[]
  docsUrl: string
}

const QUICK_PROVIDER_PRESETS: Record<QuickProviderKey, QuickProviderPreset> = {
  zhipu: {
    key: 'zhipu',
    providerId: 'zai',
    api: 'openai-completions',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    modelId: 'glm-5',
    modelName: 'GLM-5',
    input: ['text'],
    docsUrl: 'https://docs.bigmodel.cn/cn/coding-plan/faq',
  },
  kimi: {
    key: 'kimi',
    providerId: 'moonshot',
    api: 'openai-completions',
    baseUrl: 'https://api.moonshot.cn/v1',
    modelId: 'kimi-k2.5',
    modelName: 'Kimi K2.5',
    input: ['text'],
    docsUrl: 'https://platform.moonshot.cn/docs/introduction',
  },
  minimax: {
    key: 'minimax',
    providerId: 'minimax',
    api: 'openai-completions',
    baseUrl: 'https://api.minimax.io/v1',
    modelId: 'MiniMax-M3',
    modelName: 'MiniMax-M3',
    input: ['text', 'image', 'video'],
    docsUrl: 'https://platform.minimax.io/docs',
  },
  bailian: {
    key: 'bailian',
    providerId: 'bailian',
    api: 'openai-completions',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    modelId: 'qwen3.5-plus',
    modelName: 'qwen3.5-plus',
    input: ['text', 'image'],
    docsUrl: 'https://help.aliyun.com/zh/model-studio/coding-plan',
  },
}

const quickProviderList = Object.values(QUICK_PROVIDER_PRESETS)
const quickProviderApiKeys = reactive<Record<QuickProviderKey, string>>({
  zhipu: '',
  kimi: '',
  minimax: '',
  bailian: '',
})
const quickProviderSaving = reactive<Record<QuickProviderKey, boolean>>({
  zhipu: false,
  kimi: false,
  minimax: false,
  bailian: false,
})

const providerForm = reactive({
  id: '',
  api: 'openai-completions',
  baseUrl: '',
  apiKey: '',
  models: [] as ModelConfig[],
  pendingPrimaryModel: '',
})

const createProviderForm = reactive({
  id: '',
  api: 'openai-completions',
  baseUrl: '',
  apiKey: '',
  models: [] as ModelConfig[],
  pendingPrimaryModel: '',
})

const apiOptions = [
  { label: 'OpenAI Completions', value: 'openai-completions' },
  { label: 'OpenAI Responses', value: 'openai-responses' },
  { label: 'Anthropic Messages', value: 'anthropic-messages' },
  { label: 'Google Generative AI', value: 'google-generative-ai' },
]

type ProviderSummary = {
  id: string
  api: string
  baseUrl: string
  modelIds: string[]
  sources: string[]
}

type DefaultsModelsCatalogSnapshot = {
  catalog: Record<string, unknown> | null
  normalized: boolean
}

function splitModelRef(value: string): { providerId: string; modelId: string } | null {
  const modelRef = value.trim()
  const slashIndex = modelRef.indexOf('/')
  if (slashIndex <= 0 || slashIndex >= modelRef.length - 1) {
    return null
  }

  const providerId = modelRef.slice(0, slashIndex).trim()
  const modelId = modelRef.slice(slashIndex + 1).trim()
  if (!providerId || !modelId) {
    return null
  }

  return { providerId, modelId }
}

function normalizeProviderIdForMatch(value: string): string {
  const normalized = normalizeProviderId(value)
  if (normalized === 'z.ai' || normalized === 'z-ai') return 'zai'
  if (normalized === 'opencode-zen') return 'opencode'
  if (normalized === 'qwen') return 'qwen-portal'
  if (normalized === 'kimi-code') return 'kimi-coding'
  return normalized
}

function isModelRefFromProvider(modelRef: string, providerId: string): boolean {
  const parsed = splitModelRef(modelRef)
  if (!parsed) return false
  return normalizeProviderIdForMatch(parsed.providerId) === normalizeProviderIdForMatch(providerId)
}

function looksLikeProviderConfig(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return (
    'api' in row ||
    'baseUrl' in row ||
    'baseURL' in row ||
    'base_url' in row ||
    'apiKey' in row ||
    'api_key' in row ||
    'token' in row ||
    'models' in row ||
    'modelIds' in row ||
    'availableModels' in row ||
    'whitelist' in row
  )
}

function extractProviderEntries(config: unknown): Array<{
  id: string
  pathPrefix: 'models.providers' | 'models'
  provider: Record<string, unknown>
}> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return []
  const root = config as Record<string, unknown>
  const modelsRaw = root.models
  if (!modelsRaw || typeof modelsRaw !== 'object' || Array.isArray(modelsRaw)) return []
  const models = modelsRaw as Record<string, unknown>

  const registry = new Map<string, { id: string; pathPrefix: 'models.providers' | 'models'; provider: Record<string, unknown> }>()
  const addEntry = (
    id: string,
    pathPrefix: 'models.providers' | 'models',
    provider: unknown
  ) => {
    if (!id || !looksLikeProviderConfig(provider)) return
    const existing = registry.get(id)
    if (existing && existing.pathPrefix === 'models.providers' && pathPrefix === 'models') {
      return
    }
    registry.set(id, {
      id,
      pathPrefix,
      provider: provider as Record<string, unknown>,
    })
  }

  const providersRaw = models.providers
  if (providersRaw && typeof providersRaw === 'object' && !Array.isArray(providersRaw)) {
    for (const [id, provider] of Object.entries(providersRaw as Record<string, unknown>)) {
      addEntry(id, 'models.providers', provider)
    }
  }

  const reservedKeys = new Set(['primary', 'fallback', 'mode', 'providers'])
  for (const [id, provider] of Object.entries(models)) {
    if (reservedKeys.has(id)) continue
    addEntry(id, 'models', provider)
  }

  return Array.from(registry.values())
}

type ModelRefSource =
  | 'models.primary'
  | 'models.fallback'
  | 'agents.defaults.models'
  | 'agents.defaults.model.primary'
  | 'agents.defaults.model.fallback'

function readProviderText(
  provider: ModelProviderConfig | Record<string, unknown> | undefined,
  keys: string[]
): string {
  if (!provider) return ''
  const row = provider as Record<string, unknown>
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }
  return ''
}

function normalizeModelInputTypes(value: unknown): ModelInputType[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set<ModelInputType>(['text', 'image', 'video'])
  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is ModelInputType => allowed.has(item as ModelInputType))
  return Array.from(new Set(normalized)) as ModelInputType[]
}

function normalizeModelInputTypeSelection(types: ModelInputType[] | string[]): ModelInputType[] {
  const normalized = normalizeModelInputTypes(types)
  if (normalized.length > 0) {
    return normalized
  }
  return [...DEFAULT_MODEL_INPUT_TYPES]
}

function isSameModelInputTypes(before: ModelInputType[], after: ModelInputType[]): boolean {
  if (before.length !== after.length) return false
  const beforeSorted = [...before].sort((a, b) => a.localeCompare(b))
  const afterSorted = [...after].sort((a, b) => a.localeCompare(b))
  return beforeSorted.every((item, index) => item === afterSorted[index])
}

function readProviderModelInputTypes(
  provider: ModelProviderConfig | Record<string, unknown> | undefined
): ModelInputType[] {
  if (!provider) {
    return [...DEFAULT_MODEL_INPUT_TYPES]
  }
  const row = provider as Record<string, unknown>
  const result = new Set<ModelInputType>()

  const collectFromModelEntry = (entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return
    const model = entry as Record<string, unknown>
    const inputs = normalizeModelInputTypes(model.input)
    for (const input of inputs) {
      result.add(input)
    }
  }

  const models = row.models
  if (Array.isArray(models)) {
    for (const entry of models) {
      collectFromModelEntry(entry)
    }
  } else if (models && typeof models === 'object') {
    for (const entry of Object.values(models as Record<string, unknown>)) {
      collectFromModelEntry(entry)
    }
  }

  if (result.size > 0) {
    return Array.from(result).sort((a, b) => a.localeCompare(b))
  }
  return [...DEFAULT_MODEL_INPUT_TYPES]
}

function readProviderModelIds(provider: ModelProviderConfig | Record<string, unknown> | undefined): string[] {
  if (!provider) return []
  const row = provider as Record<string, unknown>

  const collectFromCollection = (value: unknown): string[] => {
    if (!value) return []

    const collectFromArray = (items: unknown[]): string[] => {
      const ids: string[] = []
      for (const item of items) {
        if (typeof item === 'string' && item.trim()) {
          ids.push(item.trim())
          continue
        }
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const model = item as Record<string, unknown>
          const id =
            (typeof model.id === 'string' && model.id.trim()) ||
            (typeof model.name === 'string' && model.name.trim()) ||
            ''
          if (id) ids.push(id)
        }
      }
      return ids
    }

    if (Array.isArray(value)) {
      return collectFromArray(value)
    }

    if (typeof value === 'object') {
      const ids: string[] = []
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        const candidateKey = key.trim()
        if (!candidateKey) continue

        if (typeof item === 'string' && item.trim()) {
          ids.push(item.trim())
          continue
        }
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const model = item as Record<string, unknown>
          const id =
            (typeof model.id === 'string' && model.id.trim()) ||
            (typeof model.name === 'string' && model.name.trim()) ||
            ''
          ids.push(id || candidateKey)
          continue
        }
        ids.push(candidateKey)
      }
      return ids
    }

    return []
  }

  const candidates: unknown[] = [
    row.models,
    row.modelIds,
    row.availableModels,
    row.whitelist,
  ]
  const collected: string[] = []
  for (const candidate of candidates) {
    collected.push(...collectFromCollection(candidate))
  }
  return Array.from(new Set(collected))
}

function readProviderModels(provider: ModelProviderConfig | Record<string, unknown> | undefined): Array<{ id: string; input?: ModelInputType[]; raw?: Record<string, unknown> }> {
  if (!provider) return []
  const row = provider as Record<string, unknown>

  const modelsArray = row.models
  if (!Array.isArray(modelsArray)) {
    return readProviderModelIds(provider).map(id => ({ id, input: ['text'] as ModelInputType[] }))
  }

  return modelsArray.map((item): { id: string; input?: ModelInputType[]; raw?: Record<string, unknown> } => {
    if (typeof item === 'string') {
      return { id: item.trim(), input: ['text'] }
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const model = item as Record<string, unknown>
      const id = (typeof model.id === 'string' && model.id.trim()) ||
        (typeof model.name === 'string' && model.name.trim()) || ''
      const input = Array.isArray(model.input)
        ? model.input.filter((v): v is ModelInputType => v === 'text' || v === 'image' || v === 'video')
        : ['text'] as ModelInputType[]
      return { id, input, raw: model }
    }
    return { id: '', input: ['text'] }
  }).filter(m => m.id)
}

function collectModelRefsFromUnknown(
  value: unknown,
  source: ModelRefSource
): Array<{ modelRef: string; source: ModelRefSource }> {
  const refs = new Map<string, ModelRefSource>()

  const addRef = (modelRef: string) => {
    if (!refs.has(modelRef)) {
      refs.set(modelRef, source)
    }
  }

  const collect = (input: unknown) => {
    if (!input) return

    if (typeof input === 'string') {
      const parsed = splitModelRef(input)
      if (parsed) addRef(`${parsed.providerId}/${parsed.modelId}`)
      return
    }

    if (Array.isArray(input)) {
      for (const item of input) {
        collect(item)
      }
      return
    }

    if (typeof input === 'object') {
      const row = input as Record<string, unknown>
      const possibleRefs = [row.id, row.model, row.ref, row.primary]
      for (const candidate of possibleRefs) {
        if (typeof candidate === 'string') {
          const parsed = splitModelRef(candidate)
          if (parsed) addRef(`${parsed.providerId}/${parsed.modelId}`)
        }
      }

      for (const [key, item] of Object.entries(row)) {
        const parsedKey = splitModelRef(key)
        if (parsedKey) addRef(`${parsedKey.providerId}/${parsedKey.modelId}`)

        if (typeof item === 'string') {
          const parsedValue = splitModelRef(item)
          if (parsedValue) addRef(`${parsedValue.providerId}/${parsedValue.modelId}`)
        }
      }
    }
  }

  collect(value)
  return Array.from(refs.entries()).map(([modelRef, modelRefSource]) => ({
    modelRef,
    source: modelRefSource,
  }))
}

function extractConfiguredModelRefs(config: unknown): Array<{ modelRef: string; source: ModelRefSource }> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return []
  const root = config as Record<string, unknown>
  const refs = new Map<string, ModelRefSource>()
  const addRefs = (value: unknown, source: ModelRefSource) => {
    for (const item of collectModelRefsFromUnknown(value, source)) {
      if (!refs.has(item.modelRef)) {
        refs.set(item.modelRef, item.source)
      }
    }
  }

  const models = root.models as Record<string, unknown> | undefined
  addRefs(models?.primary, 'models.primary')
  addRefs(models?.fallback, 'models.fallback')

  const agents = root.agents as Record<string, unknown> | undefined
  const defaults = agents?.defaults as Record<string, unknown> | undefined
  addRefs(defaults?.models, 'agents.defaults.models')

  const defaultModel = defaults?.model as Record<string, unknown> | undefined
  addRefs(defaultModel?.primary, 'agents.defaults.model.primary')
  addRefs(defaultModel?.fallback, 'agents.defaults.model.fallback')
  addRefs(defaultModel?.fallbacks, 'agents.defaults.model.fallback')

  return Array.from(refs.entries()).map(([modelRef, source]) => ({
    modelRef,
    source,
  }))
}

const providerEntries = computed(() => extractProviderEntries(configStore.config))
const configuredModelRefs = computed(() => extractConfiguredModelRefs(configStore.config))

const providerMap = computed<Record<string, ModelProviderConfig>>(() => {
  const map: Record<string, ModelProviderConfig> = {}
  for (const entry of providerEntries.value) {
    map[entry.id] = entry.provider as unknown as ModelProviderConfig
  }
  return map
})

const quickProviderConfiguredMap = computed<Record<QuickProviderKey, boolean>>(() => {
  const next = {} as Record<QuickProviderKey, boolean>
  for (const item of quickProviderList) {
    const provider = providerMap.value[item.providerId]
    if (!provider) {
      next[item.key] = false
      continue
    }
    next[item.key] = readProviderModelIds(provider).length > 0
  }
  return next
})

const providerPathPrefixMap = computed<Record<string, 'models.providers' | 'models'>>(() => {
  const map: Record<string, 'models.providers' | 'models'> = {}
  for (const entry of providerEntries.value) {
    map[entry.id] = entry.pathPrefix
  }
  return map
})

const managedProviderIdSet = computed(() => new Set(providerEntries.value.map((entry) => entry.id)))

const providerSummaries = computed(() => {
  const registry = new Map<
    string,
    {
      id: string
      api: string
      baseUrl: string
      modelIds: Set<string>
      sources: Set<string>
    }
  >()

  for (const entry of providerEntries.value) {
    const id = entry.id
    const provider = entry.provider as unknown as ModelProviderConfig
    const providerApi = readProviderText(provider, ['api', 'protocol', 'format']) || '-'
    const providerBaseUrl = readProviderText(provider, ['baseUrl', 'baseURL', 'base_url', 'url', 'endpoint']) || '-'
    registry.set(id, {
      id,
      api: providerApi,
      baseUrl: providerBaseUrl,
      modelIds: new Set(readProviderModelIds(provider)),
      sources: new Set([entry.pathPrefix]),
    })
  }

  for (const refItem of configuredModelRefs.value) {
    const parsed = splitModelRef(refItem.modelRef)
    if (!parsed) continue

    const provider = providerMap.value[parsed.providerId]
    const providerApi = readProviderText(provider, ['api', 'protocol', 'format']) || '-'
    const providerBaseUrl = readProviderText(provider, ['baseUrl', 'baseURL', 'base_url', 'url', 'endpoint']) || '-'

    const current = registry.get(parsed.providerId)
    if (current) {
      current.modelIds.add(parsed.modelId)
      current.sources.add(refItem.source)
      continue
    }

    registry.set(parsed.providerId, {
      id: parsed.providerId,
      api: providerApi,
      baseUrl: providerBaseUrl,
      modelIds: new Set([parsed.modelId]),
      sources: new Set([refItem.source]),
    })
  }

  return Array.from(registry.values())
    .map((item) => ({
      id: item.id,
      api: item.api,
      baseUrl: item.baseUrl,
      modelIds: Array.from(item.modelIds).sort((a, b) => a.localeCompare(b)),
      sources: Array.from(item.sources).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
})

const filteredProviderSummaries = computed(() => {
  const q = providerSearch.value.trim().toLowerCase()
  if (!q) return providerSummaries.value
  return providerSummaries.value.filter((item) => {
    if (item.id.toLowerCase().includes(q)) return true
    if (item.api.toLowerCase().includes(q)) return true
    if (item.baseUrl.toLowerCase().includes(q)) return true
    return item.modelIds.some((modelId) => modelId.toLowerCase().includes(q))
  })
})

function sanitizeProviderForDisplay(provider: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...provider }
  for (const key of ['apiKey', 'api_key', 'key', 'token', 'accessToken', 'access_token']) {
    const value = clone[key]
    if (typeof value === 'string' && value.trim()) {
      clone[key] = '********'
    }
  }
  return clone
}

const selectedProviderHasKey = computed(() => {
  if (!selectedProviderId.value) return false
  const provider = providerMap.value[selectedProviderId.value] as unknown as Record<string, unknown> | undefined
  if (!provider) return false
  return !!readProviderText(provider, ['apiKey', 'api_key', 'key', 'token', 'accessToken', 'access_token'])
})

const selectedProviderRawText = computed(() => {
  if (!selectedProviderId.value) return ''
  const provider = providerMap.value[selectedProviderId.value]
  if (!provider) return ''
  try {
    return JSON.stringify(sanitizeProviderForDisplay(provider as unknown as Record<string, unknown>), null, 2)
  } catch {
    return ''
  }
})

const editingExistingProvider = computed(() => {
  const id = normalizeProviderId(providerForm.id || selectedProviderId.value)
  return !!id && !!providerMap.value[id]
})

const currentEditingProviderId = computed(() =>
  normalizeProviderId(providerForm.id || selectedProviderId.value)
)
const providerEditorTitle = computed(() =>
  editingExistingProvider.value
    ? t('pages.models.editor.titleEdit', { id: currentEditingProviderId.value })
    : selectedProviderId.value
      ? t('pages.models.editor.titleMissing', { id: normalizeProviderId(selectedProviderId.value) })
      : t('pages.models.editor.titleSelect')
)
const providerSubmitLabel = computed(() => t('pages.models.actions.saveChanges'))

const apiKeyPlaceholder = computed(() =>
  editingExistingProvider.value
    ? t('pages.models.form.apiKeyPlaceholderEdit')
    : t('pages.models.form.apiKeyPlaceholderCreate')
)

const currentModelIds = computed(() => normalizeUniqueIds(providerForm.models.map(m => m.id)))
const createCurrentModelIds = computed(() => normalizeUniqueIds(createProviderForm.models.map(m => m.id)))
const editChangePreview = computed(() => {
  if (!editingExistingProvider.value) return null
  const providerId = currentEditingProviderId.value
  const existingProvider = providerMap.value[providerId]
  if (!existingProvider) return null

  const providerPrefix = providerPathPrefixMap.value[providerId] || 'models.providers'
  const providerBasePath = `models.providers.${providerId}`
  const shouldMigrateLegacyProviderPath = providerPrefix === 'models'
  const existingApi = readProviderText(existingProvider, ['api', 'protocol', 'format']) || ''
  const nextApi = providerForm.api || '-'
  const existingBaseUrl = readProviderText(existingProvider, ['baseUrl', 'baseURL', 'base_url', 'url', 'endpoint']) || ''
  const nextBaseUrl = providerForm.baseUrl.trim()

  const existingModelIds = normalizeUniqueIds(readProviderModelIds(existingProvider))
  const nextModelIds = pickProviderModelIds(
    currentModelIds.value.length > 0 ? currentModelIds.value : existingModelIds
  )
  const addedModelIds = nextModelIds.filter((id) => !existingModelIds.includes(id))
  const removedModelIds = existingModelIds.filter((id) => !nextModelIds.includes(id))
  const modelsChanged =
    addedModelIds.length > 0 ||
    removedModelIds.length > 0 ||
    existingModelIds.length !== nextModelIds.length

  const apiKeyInput = providerForm.apiKey.trim()
  const maskedKey = /^[*•]+$/.test(apiKeyInput)
  const willPatchApiKey = !!apiKeyInput && !maskedKey

  const warnings: string[] = []
  const patchPaths = [
    'models.mode',
    `${providerBasePath}.api`,
    `${providerBasePath}.baseUrl`,
    `${providerBasePath}.models`,
  ]

  const apiChanged = existingApi !== nextApi
  const baseUrlChanged = existingBaseUrl !== nextBaseUrl
  if (willPatchApiKey) {
    warnings.push(t('pages.models.preview.warnings.overwriteApiKey'))
    patchPaths.push(`${providerBasePath}.apiKey`)
  }
  if (shouldMigrateLegacyProviderPath) {
    warnings.push(t('pages.models.preview.warnings.migrateLegacyPath'))
    patchPaths.push(`models.${providerId}`)
  }

  const currentPrimary = primaryModel.value.trim() || configStore.config?.agents?.defaults?.model?.primary || ''
  let inferredPrimary = ''
  if (providerForm.pendingPrimaryModel) {
    inferredPrimary = providerForm.pendingPrimaryModel
    patchPaths.push('agents.defaults.model.primary')
  } else if (!currentPrimary && nextModelIds[0]) {
    inferredPrimary = `${providerId}/${nextModelIds[0]}`
    patchPaths.push('agents.defaults.model.primary')
  }

  if (removedModelIds.length > 0) {
    warnings.push(t('pages.models.preview.warnings.removeModels'))
  }

  const defaultsCatalogSnapshot = readExistingDefaultsModelsCatalog()
  const modelReferenceSyncPatches = buildAgentModelReferenceSyncPatches(
    providerId,
    nextModelIds,
    defaultsCatalogSnapshot.catalog
  )
  for (const patch of modelReferenceSyncPatches) {
    if (!patchPaths.includes(patch.path)) {
      patchPaths.push(patch.path)
    }
  }

  const hasChanges =
    apiChanged ||
    baseUrlChanged ||
    modelsChanged ||
    willPatchApiKey ||
    !!inferredPrimary ||
    modelReferenceSyncPatches.length > 0

  return {
    providerId,
    hasChanges,
    warnings,
    patchPaths,
    apiDiff: {
      before: existingApi || '-',
      after: nextApi || '-',
      changed: apiChanged,
    },
    baseUrlDiff: {
      before: existingBaseUrl || '-',
      after: nextBaseUrl || '-',
      changed: baseUrlChanged,
    },
    modelDiff: {
      changed: modelsChanged,
      beforeCount: existingModelIds.length,
      afterCount: nextModelIds.length,
      added: addedModelIds,
      removed: removedModelIds,
    },
    apiKeyAction: willPatchApiKey ? 'overwrite' : 'keep',
    inferredPrimary: inferredPrimary || null,
  }
})

const createChangePreview = computed(() => {
  const providerId = normalizeProviderId(createProviderForm.id)
  const providerExists = !!providerMap.value[providerId]
  const api = createProviderForm.api
  const baseUrl = createProviderForm.baseUrl.trim()
  const apiKey = createProviderForm.apiKey.trim()
  const modelIds = pickProviderModelIds(createCurrentModelIds.value)
  const hasApiKey = !!apiKey

  const warnings: string[] = []
  const missingRequired: string[] = []
  const patchPaths: string[] = []

  if (!providerId) {
    warnings.push(t('pages.models.preview.warnings.providerIdMissing'))
    missingRequired.push(t('pages.models.fields.providerId'))
  } else {
    patchPaths.push(
      `models.providers.${providerId}.api`,
      `models.providers.${providerId}.baseUrl`,
      `models.providers.${providerId}.apiKey`,
      `models.providers.${providerId}.models`
    )
  }

  if (providerExists) {
    warnings.push(t('pages.models.preview.warnings.providerIdExists'))
  }

  if (baseUrl) {
  } else {
    warnings.push(t('pages.models.preview.warnings.baseUrlMissing'))
    missingRequired.push(t('pages.models.fields.baseUrl'))
  }

  if (modelIds.length === 0) {
    warnings.push(t('pages.models.preview.warnings.modelListMissing'))
    missingRequired.push(t('pages.models.fields.models'))
  }

  if (hasApiKey) {
  } else {
    warnings.push(t('pages.models.preview.warnings.apiKeyMissing'))
    missingRequired.push(t('pages.models.fields.apiKey'))
  }

  const currentPrimary = primaryModel.value.trim() || configStore.config?.agents?.defaults?.model?.primary || ''
  let inferredPrimary = ''
  if (createProviderForm.pendingPrimaryModel) {
    inferredPrimary = createProviderForm.pendingPrimaryModel
    patchPaths.push('agents.defaults.model.primary')
  } else if (!currentPrimary && providerId && modelIds[0]) {
    inferredPrimary = `${providerId}/${modelIds[0]}`
    patchPaths.push('agents.defaults.model.primary')
  }

  if (patchPaths.length > 0) {
    patchPaths.unshift('models.mode')
  }

  const ready =
    !!providerId &&
    !providerExists &&
    !!baseUrl &&
    hasApiKey &&
    modelIds.length > 0

  return {
    ready,
    warnings,
    missingRequired,
    patchPaths,
    providerId,
    providerExists,
    api,
    baseUrl: baseUrl || '-',
    modelIds,
    hasApiKey,
    inferredPrimary: inferredPrimary || null,
  }
})
const saveConfirmTitle = computed(() =>
  confirmActionType.value === 'edit'
    ? t('pages.models.confirm.titleEdit')
    : t('pages.models.confirm.titleCreate')
)
const saveConfirmButtonLabel = computed(() =>
  confirmActionType.value === 'edit'
    ? t('pages.models.confirm.buttonEdit')
    : t('pages.models.confirm.buttonCreate')
)
const canConfirmSave = computed(() =>
  confirmActionType.value === 'edit'
    ? !!editChangePreview.value?.hasChanges
    : createChangePreview.value.ready
)
const selectedProviderSummary = computed(() =>
  providerSummaries.value.find((item) => item.id === selectedProviderId.value) || null
)
const providerStats = computed(() => {
  const providerCount = providerSummaries.value.length
  const modelCount = providerSummaries.value.reduce((total, item) => total + item.modelIds.length, 0)
  return {
    providerCount,
    modelCount,
    selectedProvider: selectedProviderSummary.value?.id || '-',
  }
})

const primaryModelDisplay = computed(() => {
  const current = primaryModel.value.trim()
  if (current) return current
  const fromConfig = configStore.config?.models?.primary || configStore.config?.agents?.defaults?.model?.primary || ''
  return fromConfig || '-'
})

const currentPrimaryProviderId = computed(() => {
  const resolvedModelRef = resolveModelRefFromConfigValue(primaryModelDisplay.value)
  const parsed = resolvedModelRef ? splitModelRef(resolvedModelRef) : null
  return parsed?.providerId || ''
})

const providerColumns = computed<DataTableColumns<ProviderSummary>>(() => [
  {
    title: t('pages.models.table.providers.provider'),
    key: 'id',
    width: 136,
    ellipsis: { tooltip: true },
    render(row) {
      return h('code', { style: 'font-size: 12px;' }, row.id)
    },
  },
  {
    title: t('pages.models.table.providers.protocol'),
    key: 'api',
    width: 132,
    ellipsis: { tooltip: true },
    render(row) {
      return row.api || '-'
    },
  },
  {
    title: t('pages.models.table.providers.baseUrl'),
    key: 'baseUrl',
    width: 256,
    ellipsis: { tooltip: true },
    render(row) {
      return row.baseUrl || '-'
    },
  },
  {
    title: t('pages.models.table.providers.models'),
    key: 'models',
    width: 220,
    ellipsis: { tooltip: true },
    render(row) {
      return row.modelIds.join(', ') || '-'
    },
  },
  {
    title: t('pages.models.table.providers.actions'),
    key: 'actions',
    width: 320,
    align: 'right',
    titleAlign: 'right',
    render(row) {
      const isPrimaryProvider = row.id === currentPrimaryProviderId.value
      const isManagedProvider = managedProviderIdSet.value.has(row.id)
      return h('div', {
        class: 'models-provider-actions-wrap',
        style: {
          width: '100%',
          display: 'flex',
          justifyContent: 'flex-end',
        },
      }, [
        h(
          NSpace,
          {
            size: 6,
            wrap: false,
            justify: 'end',
            class: 'models-provider-actions',
            style: {
              width: '100%',
              justifyContent: 'flex-end',
            },
          },
          () => [
            ...(isManagedProvider
              ? [
                  h(
                    NButton,
                    {
                      size: 'small',
                      type: 'info',
                      secondary: true,
                      strong: true,
                      class: 'models-action-btn models-action-btn--edit',
                      onClick: () => handleLoadProvider(row.id)
                    },
                    {
                      icon: () => h(NIcon, { component: CreateOutline }),
                      default: () => t('common.edit'),
                    }
                  ),
                ]
              : []),
            h(
              NButton,
              {
                size: 'small',
                type: isPrimaryProvider ? 'default' : 'success',
                secondary: true,
                strong: true,
                class: isPrimaryProvider
                  ? 'models-action-btn models-action-btn--active'
                  : 'models-action-btn models-action-btn--primary',
                disabled: isPrimaryProvider,
                onClick: () => handleUseProviderAsPrimary(row.id, row.modelIds),
              },
              {
                icon: () => h(NIcon, { component: CheckmarkCircleOutline }),
                default: () => (isPrimaryProvider ? t('pages.models.default.active') : t('pages.models.default.set')),
              }
            ),
            ...(isManagedProvider
              ? [
                  h(
                    NPopconfirm,
                    {
                      onPositiveClick: () => handleDeleteProvider(row.id),
                      positiveText: t('common.delete'),
                      negativeText: t('common.cancel'),
                    },
                    {
                      trigger: () =>
                        h(
                          NButton,
                          {
                            size: 'small',
                            type: 'error',
                            secondary: true,
                            strong: true,
                            class: 'models-action-btn models-action-btn--delete',
                            disabled: isPrimaryProvider,
                            onClick: (e: MouseEvent) => e.stopPropagation(),
                          },
                          {
                            icon: () => h(NIcon, { component: TrashOutline }),
                            default: () => t('common.delete'),
                          }
                        ),
                      default: () =>
                        isPrimaryProvider
                          ? t('pages.models.confirm.deleteDefaultProviderBlocked')
                          : t('pages.models.confirm.deleteProvider', { id: row.id }),
                    }
                  ),
                ]
              : []),
          ]
        ),
      ])
    },
  },
])

function providerRowProps(row: ProviderSummary) {
  const isManagedProvider = managedProviderIdSet.value.has(row.id)
  const active = row.id === selectedProviderId.value
  if (!isManagedProvider) {
    return {
      style: active ? 'cursor: default; background: rgba(32, 128, 240, 0.08);' : 'cursor: default;',
    }
  }
  return {
    style: active ? 'cursor: pointer; background: rgba(32, 128, 240, 0.08);' : 'cursor: pointer;',
    onClick: () => handleLoadProvider(row.id),
  }
}

watch(
  () => configStore.config,
  (config) => {
    if (!config) return
    primaryModel.value = config.models?.primary || config.agents?.defaults?.model?.primary || ''

    const allProviders = providerEntries.value.map((item) => item.id)
    if (selectedProviderId.value && !allProviders.includes(selectedProviderId.value)) {
      selectedProviderId.value = ''
    }
    const firstProvider = allProviders[0]
    if (!selectedProviderId.value && firstProvider) {
      selectedProviderId.value = firstProvider
      loadProviderForm(firstProvider)
    }
  },
  { immediate: true }
)

watch(selectedProviderId, (value) => {
  if (!value) {
    resetEditorForm()
    return
  }
  loadProviderForm(value)
})

onMounted(async () => {
  await configStore.fetchConfig()
})

function normalizeProviderId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-')
}

function parseModelIds(input: string): string[] {
  const values = input
    .split(/\n|,|;/g)
    .map((item) => item.trim())
    .filter(Boolean)
  return Array.from(new Set(values))
}

function normalizeUniqueIds(ids: string[]): string[] {
  return Array.from(
    new Set(
      ids
        .map((id) => id.trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b))
}

function pickProviderModelIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of ids) {
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

function normalizeSingleModelInput(value: string): string {
  const first = pickProviderModelIds(parseModelIds(value))[0]
  return first || ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function normalizeDefaultsModelCatalogEntry(entry: unknown, fallbackAlias: string): Record<string, unknown> {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return fallbackAlias ? { alias: fallbackAlias } : {}
  }

  const row = entry as Record<string, unknown>
  const normalized: Record<string, unknown> = {}

  if (typeof row.alias === 'string' && row.alias.trim()) {
    normalized.alias = row.alias.trim()
  } else if (fallbackAlias) {
    normalized.alias = fallbackAlias
  }
  if (row.params && typeof row.params === 'object' && !Array.isArray(row.params)) {
    normalized.params = row.params
  }
  if (typeof row.streaming === 'boolean') {
    normalized.streaming = row.streaming
  }

  return normalized
}

function readExistingDefaultsModelsCatalog(): DefaultsModelsCatalogSnapshot {
  const agents = asRecord(configStore.config?.agents)
  const defaults = asRecord(agents?.defaults)
  const modelsRaw = defaults?.models

  if (!modelsRaw) {
    return { catalog: null, normalized: false }
  }

  if (Array.isArray(modelsRaw)) {
    const next: Record<string, unknown> = {}
    for (const item of collectModelRefsFromUnknown(modelsRaw, 'agents.defaults.models')) {
      const parsed = splitModelRef(item.modelRef)
      if (!parsed) continue
      const modelRef = `${parsed.providerId}/${parsed.modelId}`
      if (next[modelRef]) continue
      next[modelRef] = { alias: parsed.modelId }
    }
    return { catalog: next, normalized: true }
  }

  const models = asRecord(modelsRaw)
  if (!models) {
    return { catalog: {}, normalized: true }
  }

  const next: Record<string, unknown> = {}
  let normalized = false

  for (const [rawModelRef, entry] of Object.entries(models)) {
    const modelRef = rawModelRef.trim()
    if (!modelRef) {
      normalized = true
      continue
    }
    const parsed = splitModelRef(modelRef)
    const fallbackAlias = parsed?.modelId || modelRef
    const normalizedEntry = normalizeDefaultsModelCatalogEntry(entry, fallbackAlias)
    next[modelRef] = normalizedEntry

    if (modelRef !== rawModelRef) {
      normalized = true
      continue
    }
    if (JSON.stringify(normalizedEntry) !== JSON.stringify(entry ?? {})) {
      normalized = true
    }
  }

  return { catalog: next, normalized }
}

function resolveModelRefFromConfigValue(
  value: unknown,
  defaultsModelsCatalog?: Record<string, unknown> | null
): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = splitModelRef(trimmed)
  if (parsed) {
    return `${parsed.providerId}/${parsed.modelId}`
  }

  const catalog = defaultsModelsCatalog ?? readExistingDefaultsModelsCatalog().catalog
  if (!catalog) return null

  const aliasKey = trimmed.toLowerCase()
  for (const [modelRef, entry] of Object.entries(catalog)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const aliasRaw = (entry as Record<string, unknown>).alias
    const alias = typeof aliasRaw === 'string' ? aliasRaw.trim() : ''
    if (alias && alias.toLowerCase() === aliasKey) {
      return modelRef
    }
  }

  return null
}

function buildBootstrapDefaultsModelsCatalog(): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const provider of providerSummaries.value) {
    for (const modelId of provider.modelIds) {
      const modelRef = `${provider.id}/${modelId}`.trim()
      if (!modelRef) continue
      next[modelRef] = {
        alias: modelId || modelRef,
      }
    }
  }
  return next
}

function buildMergedDefaultsModelsCatalog(
  entries: Array<{ modelRef: string; alias: string }>,
  options?: { createWhenMissing?: boolean }
): Record<string, unknown> | null {
  const existingSnapshot = readExistingDefaultsModelsCatalog()
  const existing = existingSnapshot.catalog
  if (!existing && !options?.createWhenMissing) return null

  const next: Record<string, unknown> = existing ? { ...existing } : buildBootstrapDefaultsModelsCatalog()
  let changed = existingSnapshot.normalized || (!existing && Object.keys(next).length > 0)

  for (const entry of entries) {
    const modelRef = entry.modelRef.trim()
    if (!modelRef) continue
    if (Object.prototype.hasOwnProperty.call(next, modelRef)) continue

    next[modelRef] = {
      alias: entry.alias.trim() || modelRef,
    }
    changed = true
  }

  return changed ? next : null
}

function buildAllowlistEntriesFromProvider(
  providerId: string,
  modelIds: string[]
): Array<{ modelRef: string; alias: string }> {
  return normalizeUniqueIds(modelIds).map((modelId) => ({
    modelRef: `${providerId}/${modelId}`,
    alias: modelId,
  }))
}

function isJsonValueEqual(before: unknown, after: unknown): boolean {
  return JSON.stringify(before ?? null) === JSON.stringify(after ?? null)
}

function buildProviderModelRefSet(providerId: string, modelIds: string[]): Set<string> {
  const refs = new Set<string>()
  for (const modelId of normalizeUniqueIds(modelIds)) {
    refs.add(`${providerId}/${modelId}`)
  }
  return refs
}

function buildDefaultsModelsCatalogWithoutProvider(providerId: string): Record<string, unknown> | null {
  const existingSnapshot = readExistingDefaultsModelsCatalog()
  const existing = existingSnapshot.catalog
  if (!existing) return null

  const patch: Record<string, unknown> = {}
  let changed = false

  for (const modelRef of Object.keys(existing)) {
    if (isModelRefFromProvider(modelRef, providerId)) {
      // JSON Merge Patch: null means remove this key from agents.defaults.models.
      patch[modelRef] = null
      changed = true
    }
  }

  if (!changed) return null
  return patch
}

function buildDefaultsModelsCatalogSyncedForProvider(
  providerId: string,
  modelIds: string[],
  options?: { createWhenMissing?: boolean }
): Record<string, unknown> | null {
  const existingSnapshot = readExistingDefaultsModelsCatalog()
  const existing = existingSnapshot.catalog
  if (!existing && !options?.createWhenMissing) return null

  const incomingEntries = buildAllowlistEntriesFromProvider(providerId, modelIds)
  const incomingEntryMap = new Map(incomingEntries.map((entry) => [entry.modelRef, entry]))

  const patch: Record<string, unknown> = {}
  let changed = false

  if (existing) {
    for (const [modelRef, entry] of Object.entries(existing)) {
      if (!isModelRefFromProvider(modelRef, providerId)) continue

      const incoming = incomingEntryMap.get(modelRef)
      if (!incoming) {
        // JSON Merge Patch: null means remove outdated provider model ref.
        patch[modelRef] = null
        changed = true
        continue
      }

      const normalizedEntry = normalizeDefaultsModelCatalogEntry(entry, incoming.alias)
      if (!isJsonValueEqual(entry ?? {}, normalizedEntry)) {
        patch[modelRef] = normalizedEntry
        changed = true
      }
      incomingEntryMap.delete(modelRef)
    }
  }

  for (const incoming of incomingEntryMap.values()) {
    patch[incoming.modelRef] = {
      alias: incoming.alias.trim() || incoming.modelRef,
    }
    changed = true
  }

  if (!changed && !existing && options?.createWhenMissing) {
    for (const entry of incomingEntries) {
      patch[entry.modelRef] = {
        alias: entry.alias.trim() || entry.modelRef,
      }
    }
    changed = Object.keys(patch).length > 0
  }

  if (!changed) return null
  return patch
}

function filterModelRefArrayByProviderSync(
  value: unknown,
  options: {
    providerId: string
    allowedModelRefs: Set<string>
    defaultsModelsCatalog: Record<string, unknown> | null
  }
): { changed: boolean; value: string[] } {
  if (!Array.isArray(value)) {
    return { changed: false, value: [] }
  }

  const next: string[] = []
  let changed = false

  for (const rawItem of value) {
    if (typeof rawItem !== 'string') {
      changed = true
      continue
    }

    const item = rawItem.trim()
    if (!item) {
      changed = true
      continue
    }
    if (item !== rawItem) {
      changed = true
    }

    const resolvedModelRef = resolveModelRefFromConfigValue(item, options.defaultsModelsCatalog)
    if (
      resolvedModelRef &&
      isModelRefFromProvider(resolvedModelRef, options.providerId) &&
      !options.allowedModelRefs.has(resolvedModelRef)
    ) {
      changed = true
      continue
    }
    next.push(item)
  }

  return { changed, value: next }
}

function syncSingleModelConfigForProvider(
  modelConfig: Record<string, unknown>,
  options: {
    providerId: string
    replacementPrimary: string | null
    allowedModelRefs: Set<string>
    defaultsModelsCatalog: Record<string, unknown> | null
  }
): { changed: boolean; model: Record<string, unknown> } {
  const nextModel = { ...modelConfig }
  let changed = false

  const primaryModelRef = resolveModelRefFromConfigValue(modelConfig.primary, options.defaultsModelsCatalog)
  if (
    primaryModelRef &&
    isModelRefFromProvider(primaryModelRef, options.providerId) &&
    !options.allowedModelRefs.has(primaryModelRef)
  ) {
    nextModel.primary = options.replacementPrimary
    changed = true
  }

  const fallbacks = filterModelRefArrayByProviderSync(modelConfig.fallbacks, {
    providerId: options.providerId,
    allowedModelRefs: options.allowedModelRefs,
    defaultsModelsCatalog: options.defaultsModelsCatalog,
  })
  if (fallbacks.changed) {
    nextModel.fallbacks = fallbacks.value.length > 0 ? fallbacks.value : null
    changed = true
  }

  const legacyFallback = filterModelRefArrayByProviderSync(modelConfig.fallback, {
    providerId: options.providerId,
    allowedModelRefs: options.allowedModelRefs,
    defaultsModelsCatalog: options.defaultsModelsCatalog,
  })
  if (legacyFallback.changed) {
    nextModel.fallback = legacyFallback.value.length > 0 ? legacyFallback.value : null
    changed = true
  }

  return {
    changed,
    model: nextModel,
  }
}

function buildAgentModelReferenceSyncPatches(
  providerId: string,
  modelIds: string[],
  defaultsModelsCatalog: Record<string, unknown> | null
): ConfigPatch[] {
  const patches: ConfigPatch[] = []
  const normalizedModelIds = normalizeUniqueIds(modelIds)
  const replacementPrimary = normalizedModelIds[0] ? `${providerId}/${normalizedModelIds[0]}` : null
  const allowedModelRefs = buildProviderModelRefSet(providerId, normalizedModelIds)

  const agents = asRecord(configStore.config?.agents)
  const defaults = asRecord(agents?.defaults)
  const defaultModel = asRecord(defaults?.model)
  if (defaultModel) {
    const synced = syncSingleModelConfigForProvider(defaultModel, {
      providerId,
      replacementPrimary,
      allowedModelRefs,
      defaultsModelsCatalog,
    })
    if (!isJsonValueEqual(defaultModel.primary, synced.model.primary)) {
      patches.push({
        path: 'agents.defaults.model.primary',
        value: synced.model.primary ?? null,
      })
    }
    if (!isJsonValueEqual(defaultModel.fallbacks, synced.model.fallbacks)) {
      patches.push({
        path: 'agents.defaults.model.fallbacks',
        value: synced.model.fallbacks ?? null,
      })
    }
    if (!isJsonValueEqual(defaultModel.fallback, synced.model.fallback)) {
      patches.push({
        path: 'agents.defaults.model.fallback',
        value: synced.model.fallback ?? null,
      })
    }
  }

  const listRaw = Array.isArray(agents?.list) ? agents.list : []
  if (listRaw.length > 0) {
    let listChanged = false
    const nextList = listRaw.map((agentRaw) => {
      if (!agentRaw || typeof agentRaw !== 'object' || Array.isArray(agentRaw)) {
        return agentRaw
      }

      const agent = agentRaw as Record<string, unknown>
      const model = asRecord(agent.model)
      if (!model) {
        return agentRaw
      }

      const synced = syncSingleModelConfigForProvider(model, {
        providerId,
        replacementPrimary,
        allowedModelRefs,
        defaultsModelsCatalog,
      })
      if (!synced.changed) {
        return agentRaw
      }

      listChanged = true
      return {
        ...agent,
        model: synced.model,
      }
    })

    if (listChanged) {
      patches.push({
        path: 'agents.list',
        value: nextList,
      })
    }
  }

  return patches
}

function buildLegacyModelsReferenceSyncPatches(
  providerId: string,
  modelIds: string[],
  defaultsModelsCatalog: Record<string, unknown> | null
): ConfigPatch[] {
  const patches: ConfigPatch[] = []
  const normalizedModelIds = normalizeUniqueIds(modelIds)
  const replacementPrimary = normalizedModelIds[0] ? `${providerId}/${normalizedModelIds[0]}` : null
  const allowedModelRefs = buildProviderModelRefSet(providerId, normalizedModelIds)

  const models = asRecord(configStore.config?.models)
  if (!models) return patches

  const primaryModelRef = resolveModelRefFromConfigValue(models.primary, defaultsModelsCatalog)
  if (
    primaryModelRef &&
    isModelRefFromProvider(primaryModelRef, providerId) &&
    !allowedModelRefs.has(primaryModelRef)
  ) {
    patches.push({
      path: 'models.primary',
      value: replacementPrimary,
    })
  }

  const fallback = filterModelRefArrayByProviderSync(models.fallback, {
    providerId,
    allowedModelRefs,
    defaultsModelsCatalog,
  })
  if (fallback.changed) {
    patches.push({
      path: 'models.fallback',
      value: fallback.value.length > 0 ? fallback.value : null,
    })
  }

  return patches
}

function dedupeConfigPatchesByPath(patches: ConfigPatch[]): ConfigPatch[] {
  const map = new Map<string, ConfigPatch>()
  for (const patch of patches) {
    const path = patch.path.trim()
    if (!path) continue
    map.set(path, { path, value: patch.value })
  }
  return Array.from(map.values())
}

function resetEditorForm() {
  providerForm.id = ''
  providerForm.api = 'openai-completions'
  providerForm.baseUrl = ''
  providerForm.apiKey = ''
  providerForm.models = []
  providerForm.pendingPrimaryModel = ''
}

function resetCreateProviderForm() {
  createProviderForm.id = ''
  createProviderForm.api = 'openai-completions'
  createProviderForm.baseUrl = ''
  createProviderForm.apiKey = ''
  createProviderForm.models = []
  createProviderForm.pendingPrimaryModel = ''
}

function loadProviderForm(providerId: string) {
  const provider = providerMap.value[providerId]

  providerForm.id = providerId
  providerForm.api = readProviderText(provider, ['api', 'protocol', 'format']) || 'openai-completions'
  providerForm.baseUrl = readProviderText(provider, ['baseUrl', 'baseURL', 'base_url', 'url', 'endpoint']) || ''
  providerForm.apiKey = ''

  const models = readProviderModels(provider)
  providerForm.models = models.map(m => ({
    id: m.id || '',
    input: normalizeModelInputTypeSelection(m.input as ModelInputType[] || ['text']),
    raw: m.raw,
  })).filter(m => m.id)
}

function handleNewProvider() {
  resetCreateProviderForm()
  createActiveTab.value = 'basic'
  showCreateProviderModal.value = true
}

function openSaveConfirm(action: 'edit' | 'create') {
  confirmActionType.value = action
  showSaveConfirmModal.value = true
}

function handleLoadProvider(providerId: string) {
  selectedProviderId.value = providerId
  editActiveTab.value = 'basic'
  showEditProviderModal.value = true
}

function handleCloseEditProviderModal() {
  showEditProviderModal.value = false
  editActiveTab.value = 'basic'
}

async function savePrimaryModel(targetInput: string): Promise<void> {
  const target = targetInput.trim()
  if (!target) {
    message.warning(t('pages.models.messages.primaryModelRequired'))
    return
  }

  const parsedTarget = splitModelRef(target)
  const mergedDefaultsModels = parsedTarget
    ? buildMergedDefaultsModelsCatalog([
        {
          modelRef: `${parsedTarget.providerId}/${parsedTarget.modelId}`,
          alias: parsedTarget.modelId,
        },
      ], {
        createWhenMissing: true,
      })
    : null

  const patches: ConfigPatch[] = [
    { path: 'agents.defaults.model.primary', value: target },
  ]
  if (mergedDefaultsModels) {
    patches.push({ path: 'agents.defaults.models', value: mergedDefaultsModels })
  }

  try {
    await configStore.patchConfig(patches)
    primaryModel.value = target
    message.success(t('pages.models.messages.primaryModelSaved', { model: target }))
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('common.saveFailed'))
  }
}

async function handleUseProviderAsPrimary(providerId: string, modelIds: string[]) {
  if (modelIds.length === 0) {
    message.warning(t('pages.models.messages.noModelsForProvider'))
    return
  }
  const primary = `${providerId}/${modelIds[0]}`
  await savePrimaryModel(primary)
}

function isCurrentPrimaryModel(providerId: string, modelId: string): boolean {
  if (!providerId || !modelId) return false
  const modelRef = `${providerId}/${modelId}`
  const currentPrimary = primaryModel.value.trim() || configStore.config?.agents?.defaults?.model?.primary || ''
  return currentPrimary === modelRef
}

function isPendingPrimaryModel(formType: 'edit' | 'create', providerId: string, modelId: string): boolean {
  if (!providerId || !modelId) return false
  const modelRef = `${providerId}/${modelId}`
  if (formType === 'edit') {
    return providerForm.pendingPrimaryModel === modelRef
  }
  return createProviderForm.pendingPrimaryModel === modelRef
}

function setAsPendingPrimaryModel(formType: 'edit' | 'create', providerId: string, modelId: string) {
  if (!providerId || !modelId) return
  const modelRef = `${providerId}/${modelId}`
  if (formType === 'edit') {
    providerForm.pendingPrimaryModel = modelRef
  } else {
    createProviderForm.pendingPrimaryModel = modelRef
  }
}

function getPrimaryModelStatus(formType: 'edit' | 'create', providerId: string, modelId: string): 'current' | 'pending' | 'none' {
  if (isCurrentPrimaryModel(providerId, modelId)) return 'current'
  if (isPendingPrimaryModel(formType, providerId, modelId)) return 'pending'
  return 'none'
}

async function handleDeleteProvider(providerIdInput: string): Promise<void> {
  const providerId = normalizeProviderId(providerIdInput)
  if (!providerId) return

  if (providerId === currentPrimaryProviderId.value) {
    message.warning(t('pages.models.messages.deleteDefaultProviderBlocked'))
    return
  }

  if (!providerMap.value[providerId]) {
    message.warning(t('pages.models.messages.deleteWhitelistProviderBlocked'))
    return
  }

  await configStore.fetchConfig()
  const currentConfig = configStore.config
  if (!currentConfig) {
    message.error('Config not loaded')
    return
  }

  const allProviders = currentConfig.models?.providers || {}
  const newProviders: Record<string, ModelProviderConfig> = { ...allProviders }
  delete newProviders[providerId]

  const existingDefaultsModels = currentConfig.agents?.defaults?.models || {}
  const newDefaultsModels: Record<string, { alias?: string }> = {}
  
  for (const [modelRef, entry] of Object.entries(existingDefaultsModels)) {
    if (!modelRef.startsWith(`${providerId}/`)) {
      newDefaultsModels[modelRef] = entry as { alias?: string }
    }
  }

  const newConfig: OpenClawConfig = {
    ...currentConfig,
    models: {
      ...currentConfig.models,
      mode: 'replace',
      providers: newProviders,
    },
    agents: {
      ...currentConfig.agents,
      defaults: {
        ...currentConfig.agents?.defaults,
        models: newDefaultsModels,
      },
    },
  }

  try {
    await wsStore.rpc.setConfig(newConfig)
    await configStore.fetchConfig()
    if (selectedProviderId.value === providerId) {
      selectedProviderId.value = ''
    }
    if (currentEditingProviderId.value === providerId) {
      showEditProviderModal.value = false
    }
    message.success(t('pages.models.messages.providerDeleted', { id: providerId }))
  } catch (error) {
    message.error(t('pages.models.messages.saveFailed', { reason: error instanceof Error ? error.message : String(error) }))
  }
}

async function handleSaveProvider(confirmed = false) {
  const providerId = normalizeProviderId(providerForm.id)
  const baseUrl = providerForm.baseUrl.trim()
  const apiKey = providerForm.apiKey.trim()
  const models = providerForm.models
  const existingProvider = providerMap.value[providerId]
  const existingModelIds = readProviderModelIds(existingProvider)
  const finalModelIds = pickProviderModelIds(models.length > 0 ? models.map(m => m.id) : existingModelIds)
  const maskedKey = /^[*•]+$/.test(apiKey)
  const shouldPatchApiKey = !!apiKey && !maskedKey

  if (!existingProvider) {
    message.warning(t('pages.models.messages.selectProviderToEdit'))
    return
  }
  if (!editChangePreview.value?.hasChanges) {
    message.info(t('pages.models.messages.noConfigChanges'))
    return
  }
  if (!confirmed) {
    openSaveConfirm('edit')
    return
  }
  if (!providerId) {
    message.warning(t('pages.models.validation.providerIdRequired'))
    return
  }
  if (!/^[a-z0-9_-]+$/.test(providerId)) {
    message.warning(t('pages.models.validation.providerIdInvalid'))
    return
  }
  if (!baseUrl) {
    message.warning(t('pages.models.validation.baseUrlRequired'))
    return
  }
  if (finalModelIds.length === 0) {
    message.warning(t('pages.models.validation.modelsRequired'))
    return
  }

  const providerPrefix = providerPathPrefixMap.value[providerId] || 'models.providers'
  const providerBasePath = `models.providers.${providerId}`
  const shouldMigrateLegacyProviderPath = providerPrefix === 'models'

  const modelsValue = models.map((m) => {
    const base: Record<string, unknown> = {
      id: m.id,
      name: m.id,
      input: [...m.input],
    }
    if (m.raw && typeof m.raw === 'object') {
      const merged = { ...m.raw }
      merged.id = m.id
      merged.name = m.id
      merged.input = [...m.input]
      return merged
    }
    return base
  })
  const fullProviderValue: Record<string, unknown> = {
    api: providerForm.api,
    baseUrl,
    models: modelsValue,
  }
  if (shouldPatchApiKey) {
    fullProviderValue.apiKey = apiKey
  } else if ((existingProvider as Record<string, unknown>)?.apiKey) {
    fullProviderValue.apiKey = (existingProvider as Record<string, unknown>).apiKey
  }
  
  await configStore.fetchConfig()
  const currentConfig = configStore.config
  if (!currentConfig) {
    message.error('Config not loaded')
    return
  }
  
  const allProviders = currentConfig.models?.providers || {}
  const newProviders: Record<string, unknown> = {
    ...allProviders,
    [providerId]: fullProviderValue,
  }
  
  const newConfig: OpenClawConfig = {
    ...currentConfig,
    models: {
      ...currentConfig.models,
      mode: 'replace',
      providers: newProviders as Record<string, ModelProviderConfig>,
    },
  }
  
  const existingDefaultsModels = currentConfig.agents?.defaults?.models || {}
  const newDefaultsModels: Record<string, { alias?: string }> = {}
  
  for (const [modelRef, entry] of Object.entries(existingDefaultsModels)) {
    if (!isModelRefFromProvider(modelRef, providerId)) {
      newDefaultsModels[modelRef] = entry
    }
  }
  
  for (const modelId of finalModelIds) {
    const modelRef = `${providerId}/${modelId}`
    const existingEntry = existingDefaultsModels[modelRef]
    newDefaultsModels[modelRef] = {
      alias: (existingEntry as { alias?: string })?.alias || modelId,
    }
  }
  
  newConfig.agents = {
    ...newConfig.agents,
    defaults: {
      ...newConfig.agents?.defaults,
      models: newDefaultsModels,
      model: {
        ...newConfig.agents?.defaults?.model,
      },
    },
  }
  
  const currentPrimary = (newConfig.agents?.defaults?.model as { primary?: string })?.primary || ''
  const currentPrimaryFromThisProvider = currentPrimary.startsWith(`${providerId}/`)
  const currentPrimaryExists = finalModelIds.some(id => `${providerId}/${id}` === currentPrimary)
  
  if (providerForm.pendingPrimaryModel) {
    ;(newConfig.agents!.defaults!.model as { primary?: string }).primary = providerForm.pendingPrimaryModel
  } else if (currentPrimaryFromThisProvider && !currentPrimaryExists) {
    if (finalModelIds[0]) {
      ;(newConfig.agents!.defaults!.model as { primary?: string }).primary = `${providerId}/${finalModelIds[0]}`
    }
  }
  
  try {
    await wsStore.rpc.setConfig(newConfig)
    showSaveConfirmModal.value = false
    showEditProviderModal.value = false
    await configStore.fetchConfig()
    selectedProviderId.value = providerId
    message.success(t('pages.models.messages.providerSaved'))
  } catch (error) {
    message.error(t('pages.models.messages.saveFailed', { reason: error instanceof Error ? error.message : String(error) }))
  }
  return
}

async function handleCreateProvider(confirmed = false) {
  const providerId = normalizeProviderId(createProviderForm.id)
  const baseUrl = createProviderForm.baseUrl.trim()
  const apiKey = createProviderForm.apiKey.trim()
  const models = createProviderForm.models
  const modelIds = pickProviderModelIds(models.map(m => m.id))

  if (!providerId) {
    message.warning(t('pages.models.validation.providerIdRequired'))
    return
  }
  if (!/^[a-z0-9_-]+$/.test(providerId)) {
    message.warning(t('pages.models.validation.providerIdInvalid'))
    return
  }
  if (providerMap.value[providerId]) {
    message.warning(t('pages.models.validation.providerIdExists'))
    return
  }
  if (!baseUrl) {
    message.warning(t('pages.models.validation.baseUrlRequired'))
    return
  }
  if (!apiKey) {
    message.warning(t('pages.models.validation.apiKeyRequiredForCreate'))
    return
  }
  if (modelIds.length === 0) {
    message.warning(t('pages.models.validation.modelsRequired'))
    return
  }
  if (!confirmed) {
    openSaveConfirm('create')
    return
  }

  const modelsValue = models.map((m) => ({ id: m.id, name: m.id, input: [...m.input] }))
  
  const fullProviderValue: Record<string, unknown> = {
    api: createProviderForm.api,
    baseUrl,
    models: modelsValue,
    apiKey,
  }
  
  await configStore.fetchConfig()
  const currentConfig = configStore.config
  if (!currentConfig) {
    message.error('Config not loaded')
    return
  }
  
  const allProviders = currentConfig.models?.providers || {}
  const newProviders: Record<string, unknown> = {
    ...allProviders,
    [providerId]: fullProviderValue,
  }
  
  const newConfig: OpenClawConfig = {
    ...currentConfig,
    models: {
      ...currentConfig.models,
      mode: 'replace',
      providers: newProviders as Record<string, ModelProviderConfig>,
    },
  }
  
  const existingDefaultsModels = currentConfig.agents?.defaults?.models || {}
  const newDefaultsModels: Record<string, { alias?: string }> = {}
  
  for (const [modelRef, entry] of Object.entries(existingDefaultsModels)) {
    newDefaultsModels[modelRef] = entry as { alias?: string }
  }
  
  for (const modelId of modelIds) {
    const modelRef = `${providerId}/${modelId}`
    newDefaultsModels[modelRef] = {
      alias: modelId,
    }
  }
  
  newConfig.agents = {
    ...newConfig.agents,
    defaults: {
      ...newConfig.agents?.defaults,
      models: newDefaultsModels,
      model: {
        ...newConfig.agents?.defaults?.model,
      },
    },
  }
  
  const currentPrimary = primaryModel.value.trim() || configStore.config?.agents?.defaults?.model?.primary || ''
  if (createProviderForm.pendingPrimaryModel) {
    ;(newConfig.agents!.defaults!.model as { primary?: string }).primary = createProviderForm.pendingPrimaryModel
  } else if (!currentPrimary && modelIds[0]) {
    ;(newConfig.agents!.defaults!.model as { primary?: string }).primary = `${providerId}/${modelIds[0]}`
  }

  try {
    await wsStore.rpc.setConfig(newConfig)
    showSaveConfirmModal.value = false
    showCreateProviderModal.value = false
    await configStore.fetchConfig()
    selectedProviderId.value = providerId
    loadProviderForm(providerId)
    message.success(t('pages.models.messages.providerCreated'))
  } catch (error) {
    message.error(t('pages.models.messages.saveFailed', { reason: error instanceof Error ? error.message : String(error) }))
  }
}

async function handleQuickProviderSetup(key: QuickProviderKey) {
  if (quickProviderConfiguredMap.value[key]) {
    return
  }
  const preset = QUICK_PROVIDER_PRESETS[key]
  const apiKey = quickProviderApiKeys[key].trim()
  if (!apiKey) {
    message.warning(t('pages.models.quick.messages.keyRequired'))
    return
  }

  quickProviderSaving[key] = true
  try {
    const providerId = normalizeProviderId(preset.providerId)
    const providerPath = `models.providers.${providerId}`
    
    // 为阿里云百炼提供完整模型列表
    let modelIds: string[]
    let modelsConfig: any[]
    
    if (key === 'bailian') {
      // 阿里云百炼完整模型列表
      const bailianModels = [
        { id: 'qwen3.5-plus', name: 'qwen3.5-plus', reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 65536, compat: { thinkingFormat: 'qwen' } },
        { id: 'qwen3-max-2026-01-23', name: 'qwen3-max-2026-01-23', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 65536, compat: { thinkingFormat: 'qwen' } },
        { id: 'qwen3-coder-next', name: 'qwen3-coder-next', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 65536 },
        { id: 'qwen3-coder-plus', name: 'qwen3-coder-plus', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 65536 },
        { id: 'MiniMax-M2.5', name: 'MiniMax-M2.5', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 196608, maxTokens: 32768 },
        { id: 'glm-5', name: 'glm-5', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 202752, maxTokens: 16384, compat: { thinkingFormat: 'qwen' } },
        { id: 'glm-4.7', name: 'glm-4.7', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 202752, maxTokens: 16384, compat: { thinkingFormat: 'qwen' } },
        { id: 'kimi-k2.5', name: 'kimi-k2.5', reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 32768, compat: { thinkingFormat: 'qwen' } },
      ]
      modelIds = bailianModels.map(model => model.id)
      modelsConfig = bailianModels
    } else if (key === 'minimax') {
      // MiniMax current models with full metadata (context, pricing, cache, input capabilities)
      const minimaxModels = [
        { id: 'MiniMax-M3', name: 'MiniMax-M3', reasoning: true, input: ['text', 'image', 'video'], cost: { input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: null }, contextWindow: 1000000 },
        { id: 'MiniMax-M2.7', name: 'MiniMax-M2.7', reasoning: true, input: ['text'], cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 }, contextWindow: 204800 },
      ]
      modelIds = minimaxModels.map(model => model.id)
      modelsConfig = minimaxModels
    } else {
      // 其他提供商保持现有行为
      modelIds = [preset.modelId]
      modelsConfig = modelIds.map((id) => ({ id, name: preset.modelName || id, input: [...preset.input] }))
    }

    const patches: ConfigPatch[] = [
      { path: 'models.mode', value: 'merge' },
      { path: `${providerPath}.api`, value: preset.api },
      { path: `${providerPath}.baseUrl`, value: preset.baseUrl },
      { path: `${providerPath}.apiKey`, value: apiKey },
      {
        path: `${providerPath}.models`,
        value: modelsConfig,
      },
    ]

    const providerPrefix = providerPathPrefixMap.value[providerId] || 'models.providers'
    if (providerPrefix === 'models') {
      patches.push({ path: `models.${providerId}`, value: null })
    }

    const mergedDefaultsModels = buildDefaultsModelsCatalogSyncedForProvider(providerId, modelIds, {
      createWhenMissing: true,
    })
    if (mergedDefaultsModels) {
      patches.push({ path: 'agents.defaults.models', value: mergedDefaultsModels })
    }

    const defaultsCatalogSnapshot = readExistingDefaultsModelsCatalog()
    patches.push(
      ...buildAgentModelReferenceSyncPatches(providerId, modelIds, defaultsCatalogSnapshot.catalog),
      ...buildLegacyModelsReferenceSyncPatches(providerId, modelIds, defaultsCatalogSnapshot.catalog),
    )

    const currentPrimary = primaryModel.value.trim() || configStore.config?.agents?.defaults?.model?.primary || ''
    if (!currentPrimary) {
      patches.push({ path: 'agents.defaults.model.primary', value: `${providerId}/${preset.modelId}` })
    }

    const finalPatches = dedupeConfigPatchesByPath(patches)
    await configStore.patchConfig(finalPatches)
    quickProviderApiKeys[key] = ''
    selectedProviderId.value = providerId
    loadProviderForm(providerId)
    message.success(t('pages.models.quick.messages.saved', {
      provider: t(`pages.models.quick.providers.${key}.name`)
    }))
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('common.saveFailed'))
  } finally {
    quickProviderSaving[key] = false
  }
}

async function handleConfirmSave() {
  if (confirmActionType.value === 'edit') {
    await handleSaveProvider(true)
    return
  }
  await handleCreateProvider(true)
}

function handleSaveProviderClick() {
  void handleSaveProvider()
}

function handleCreateProviderClick() {
  void handleCreateProvider()
}
</script>

<template>
  <div class="models-page">
    <NCard class="models-overview-card" :bordered="false">
      <template #header>
        <div class="models-overview-title">{{ t('pages.models.overview.title') }}</div>
      </template>
      <template #header-extra>
        <NButton size="small" :loading="configStore.loading" @click="configStore.fetchConfig()">
          <template #icon><NIcon :component="RefreshOutline" /></template>
          {{ t('pages.models.actions.refreshConfig') }}
        </NButton>
      </template>

      <NAlert type="info" :bordered="false" style="margin-bottom: 12px;">
        {{ t('pages.models.overview.hintPrefix') }}<code>provider/model</code>{{ t('pages.models.overview.hintMiddle') }}<code>models.providers</code>{{ t('pages.models.overview.hintSuffix') }}
      </NAlert>

      <NAlert v-if="configStore.lastError" type="error" :bordered="false" style="margin-bottom: 12px;">
        {{ configStore.lastError }}
      </NAlert>

      <div class="models-overview-metrics">
        <div class="models-metric-item">
          <NText depth="3">{{ t('pages.models.overview.metrics.providers') }}</NText>
          <div class="models-metric-value">{{ providerStats.providerCount }}</div>
        </div>
        <div class="models-metric-item">
          <NText depth="3">{{ t('pages.models.overview.metrics.modelRefs') }}</NText>
          <div class="models-metric-value">{{ providerStats.modelCount }}</div>
        </div>
        <div class="models-metric-item">
          <NText depth="3">{{ t('pages.models.overview.metrics.editing') }}</NText>
          <div class="models-metric-value">{{ providerStats.selectedProvider }}</div>
        </div>
        <div class="models-metric-item">
          <NText depth="3">{{ t('pages.models.overview.metrics.primaryModel') }}</NText>
          <div class="models-metric-value models-metric-code">{{ primaryModelDisplay }}</div>
        </div>
      </div>

    </NCard>

    <NCard :title="t('pages.models.workbench.title')" class="models-workbench-card">
      <NGrid cols="1 xl:12" responsive="screen" :x-gap="16" :y-gap="16">
        <NGridItem class="models-workbench-item" span="1 xl:12">
          <div class="models-panel">
            <NSpace justify="space-between" align="center" :size="8" class="models-panel-toolbar">
              <NInput
                v-model:value="providerSearch"
                size="small"
                :placeholder="t('pages.models.workbench.searchPlaceholder')"
                style="width: 100%; max-width: 340px;"
              />
              <NButton size="small" type="primary" @click="handleNewProvider">
                <template #icon><NIcon :component="AddOutline" /></template>
                {{ t('pages.models.actions.createProvider') }}
              </NButton>
            </NSpace>

            <NDataTable
              class="models-provider-table"
              :columns="providerColumns"
              :data="filteredProviderSummaries"
              :loading="configStore.loading"
              :bordered="false"
              :pagination="{ pageSize: 8 }"
              :row-key="(row: ProviderSummary) => row.id"
              :row-props="providerRowProps"
              striped
            />

            <NEmpty
              v-if="!configStore.loading && providerSummaries.length === 0"
              :description="t('pages.models.workbench.empty')"
              class="models-empty"
            >
              <template #extra>
                <NText depth="3">{{ t('pages.models.workbench.emptyHint') }}</NText>
              </template>
            </NEmpty>
          </div>
        </NGridItem>
      </NGrid>
    </NCard>

    <NCard :title="t('pages.models.quick.title')" class="models-quick-card">
      <NAlert type="info" :bordered="false" style="margin-bottom: 12px;">
        {{ t('pages.models.quick.hint') }}
      </NAlert>
      <div class="models-quick-grid">
        <div
          v-for="item in quickProviderList"
          :key="`quick-provider-${item.key}`"
          class="models-quick-item"
        >
          <div class="models-quick-item-header">
            <NText strong>{{ t(`pages.models.quick.providers.${item.key}.name`) }}</NText>
            <NSpace :size="6" align="center">
              <NTag v-if="quickProviderConfiguredMap[item.key]" size="small" type="primary" :bordered="false">
                {{ t('pages.models.quick.configuredTag') }}
              </NTag>
              <NTag size="small" type="success" :bordered="false">
                {{ t('pages.models.quick.latestTag') }}
              </NTag>
            </NSpace>
          </div>
          <NSpace vertical :size="6">
            <NText depth="3" class="models-quick-meta">
              {{ t('pages.models.quick.providerId') }}：<code>{{ item.providerId }}</code>
            </NText>
            <NText depth="3" class="models-quick-meta">
              {{ t('pages.models.quick.defaultModel') }}：<code>{{ item.modelId }}</code>
            </NText>
            <NText depth="3" class="models-quick-meta">
              {{ t('pages.models.quick.endpoint') }}：<code>{{ item.baseUrl }}</code>
            </NText>
            <a
              class="models-quick-doc-link"
              :href="item.docsUrl"
              target="_blank"
              rel="noreferrer"
            >
              {{ t('pages.models.quick.docs') }}
            </a>
          </NSpace>
          <NSpace vertical :size="8" style="margin-top: 10px;">
            <NInput
              v-model:value="quickProviderApiKeys[item.key]"
              type="password"
              show-password-on="click"
              :placeholder="t('pages.models.quick.keyPlaceholder')"
            />
            <NButton
              type="primary"
              :loading="quickProviderSaving[item.key]"
              :disabled="quickProviderConfiguredMap[item.key]"
              @click="handleQuickProviderSetup(item.key)"
            >
              {{ quickProviderConfiguredMap[item.key]
                ? t('pages.models.quick.configuredTag')
                : t('pages.models.quick.action') }}
            </NButton>
          </NSpace>
        </div>
      </div>
    </NCard>

    <NModal
      v-model:show="showEditProviderModal"
      preset="card"
      :title="providerEditorTitle"
      style="max-width: 760px; width: 92vw;"
      :mask-closable="false"
    >
      <template v-if="editingExistingProvider">
        <NSpace vertical :size="12">
          <NSpace v-if="selectedProviderSummary" :size="6" style="flex-wrap: wrap;">
            <NTag size="small" :bordered="false">
              {{ t('pages.models.editor.modelsCount', { count: selectedProviderSummary.modelIds.length }) }}
            </NTag>
          </NSpace>

          <NTabs v-model:value="editActiveTab" type="line" animated>
            <NTabPane name="basic" :tab="t('pages.models.tabs.basic')">
              <NForm label-placement="left" label-width="100">
                <NFormItem :label="t('pages.models.form.providerId')">
                  <NInput
                    v-model:value="providerForm.id"
                    :disabled="true"
                    :placeholder="t('pages.models.form.providerIdPlaceholder')"
                  />
                </NFormItem>
                <NFormItem :label="t('pages.models.form.apiProtocol')">
                  <NSelect v-model:value="providerForm.api" :options="apiOptions" />
                </NFormItem>
                <NFormItem :label="t('pages.models.form.baseUrl')">
                  <NInput v-model:value="providerForm.baseUrl" :placeholder="t('pages.models.form.baseUrlPlaceholder')" />
                </NFormItem>
                <NFormItem :label="t('pages.models.form.apiKey')">
                  <NSpace vertical :size="6" style="width: 100%;">
                    <NInput
                      v-model:value="providerForm.apiKey"
                      type="password"
                      show-password-on="click"
                      :placeholder="apiKeyPlaceholder"
                    />
                    <NText depth="3" style="font-size: 12px;">
                      {{ t('pages.models.form.apiKeyHint') }}
                    </NText>
                  </NSpace>
                </NFormItem>
                <NFormItem :label="t('pages.models.form.apiKeyStatus')">
                  <NTag size="small" :bordered="false" :type="selectedProviderHasKey ? 'success' : 'default'">
                    {{ selectedProviderHasKey ? t('pages.models.form.apiKeyStatusConfigured') : t('pages.models.form.apiKeyStatusNotConfigured') }}
                  </NTag>
                </NFormItem>
                <NFormItem>
                  <NSpace justify="end" style="width: 100%;">
                    <NButton @click="editActiveTab = 'models'">{{ t('pages.models.actions.nextToModels') }}</NButton>
                  </NSpace>
                </NFormItem>
              </NForm>
            </NTabPane>

            <NTabPane name="models" :tab="t('pages.models.tabs.models')">
              <NForm label-placement="left" label-width="100">
                <NFormItem :label="t('pages.models.form.models')">
                  <NSpace vertical :size="8" style="width: 100%;">
                    <NButton
                      size="small"
                      type="primary"
                      dashed
                      @click="providerForm.models.push({ id: '', input: ['text'] })"
                    >
                      {{ t('pages.models.form.addModel') }}
                    </NButton>
                    <div
                      v-for="(model, index) in providerForm.models"
                      :key="index"
                      style="display: flex; gap: 8px; align-items: center; width: 100%;"
                    >
                      <NInput
                        v-model:value="model.id"
                        :placeholder="t('pages.models.form.modelIdPlaceholder')"
                        style="flex: 1;"
                      />
                      <NSelect
                        v-model:value="model.input"
                        :options="modelInputTypeOptions"
                        multiple
                        :placeholder="t('pages.models.form.modelInputTypesPlaceholder')"
                        style="width: 160px;"
                      />
                      <NButton
                        size="small"
                        :type="getPrimaryModelStatus('edit', providerForm.id, model.id) === 'current' ? 'success' : getPrimaryModelStatus('edit', providerForm.id, model.id) === 'pending' ? 'warning' : 'default'"
                        :disabled="!model.id || getPrimaryModelStatus('edit', providerForm.id, model.id) === 'current'"
                        @click="setAsPendingPrimaryModel('edit', providerForm.id, model.id)"
                      >
                        {{ getPrimaryModelStatus('edit', providerForm.id, model.id) === 'current' ? t('pages.models.form.isDefault') : getPrimaryModelStatus('edit', providerForm.id, model.id) === 'pending' ? t('pages.models.form.pendingDefault') : t('pages.models.form.setAsDefault') }}
                      </NButton>
                      <NButton
                        size="small"
                        quaternary
                        type="error"
                        @click="providerForm.models.splice(index, 1)"
                      >
                        <template #icon>
                          <NIcon><CloseOutline /></NIcon>
                        </template>
                      </NButton>
                    </div>
                    <NText depth="3" style="font-size: 12px;">
                      {{ t('pages.models.form.modelsHint') }}
                    </NText>
                  </NSpace>
                </NFormItem>
                <NFormItem>
                  <NSpace justify="end" style="width: 100%;">
                    <NSpace>
                      <NButton @click="editActiveTab = 'basic'">{{ t('pages.models.actions.prev') }}</NButton>
                      <NButton type="primary" @click="editActiveTab = 'preview'">{{ t('pages.models.actions.nextToPreview') }}</NButton>
                    </NSpace>
                  </NSpace>
                </NFormItem>
              </NForm>
            </NTabPane>

            <NTabPane name="preview" :tab="t('pages.models.tabs.preview')">
              <NSpace vertical :size="10">
                <div class="models-preview-grid">
                  <div class="models-preview-card" :class="{ 'is-changed': editChangePreview?.apiDiff.changed }">
                    <NText depth="3" class="models-preview-label">{{ t('pages.models.preview.apiProtocol') }}</NText>
                    <div class="models-preview-diff">
                      <code>{{ editChangePreview?.apiDiff.before || '-' }}</code>
                      <span class="models-preview-arrow">→</span>
                      <code>{{ editChangePreview?.apiDiff.after || '-' }}</code>
                    </div>
                  </div>

                  <div class="models-preview-card" :class="{ 'is-changed': editChangePreview?.baseUrlDiff.changed }">
                    <NText depth="3" class="models-preview-label">Base URL</NText>
                    <div class="models-preview-diff models-preview-diff--block">
                      <code>{{ editChangePreview?.baseUrlDiff.before || '-' }}</code>
                      <span class="models-preview-arrow">→</span>
                      <code>{{ editChangePreview?.baseUrlDiff.after || '-' }}</code>
                    </div>
                  </div>

                  <div class="models-preview-card" :class="{ 'is-changed': editChangePreview?.modelDiff.changed }">
                    <NText depth="3" class="models-preview-label">{{ t('pages.models.preview.models') }}</NText>
                    <div class="models-preview-diff">
                      <code>{{ editChangePreview?.modelDiff.beforeCount || 0 }}</code>
                      <span class="models-preview-arrow">→</span>
                      <code>{{ editChangePreview?.modelDiff.afterCount || 0 }}</code>
                    </div>
                  </div>

                  <div class="models-preview-card" :class="{ 'is-changed': editChangePreview?.apiKeyAction === 'overwrite' }">
                    <NText depth="3" class="models-preview-label">API Key</NText>
                    <NTag
                      size="small"
                      :type="editChangePreview?.apiKeyAction === 'overwrite' ? 'warning' : 'default'"
                      :bordered="false"
                    >
                      {{ editChangePreview?.apiKeyAction === 'overwrite'
                        ? t('pages.models.preview.apiKeyOverwrite')
                        : t('pages.models.preview.apiKeyKeep') }}
                    </NTag>
                  </div>

                  <div class="models-preview-card" :class="{ 'is-changed': !!editChangePreview?.inferredPrimary }">
                    <NText depth="3" class="models-preview-label">{{ t('pages.models.preview.primaryModel') }}</NText>
                    <NTag size="small" :type="editChangePreview?.inferredPrimary ? 'warning' : 'default'" :bordered="false">
                      {{ editChangePreview?.inferredPrimary || t('pages.models.preview.unchanged') }}
                    </NTag>
                  </div>
                </div>

                <NCollapse v-if="editChangePreview?.modelDiff.changed">
                  <NCollapseItem
                    :title="t('pages.models.preview.modelDiffTitle', {
                      added: editChangePreview?.modelDiff.added.length || 0,
                      removed: editChangePreview?.modelDiff.removed.length || 0,
                    })"
                    name="edit-model-diff"
                  >
                    <NSpace vertical :size="8">
                      <div v-if="editChangePreview?.modelDiff.added.length">
                        <NText depth="3" style="font-size: 12px;">{{ t('pages.models.preview.addedModels') }}</NText>
                        <NSpace :size="6" style="margin-top: 6px; flex-wrap: wrap;">
                          <NTag
                            v-for="id in editChangePreview?.modelDiff.added"
                            :key="`add-${id}`"
                            type="success"
                            size="small"
                            :bordered="false"
                          >
                            + {{ id }}
                          </NTag>
                        </NSpace>
                      </div>
                      <div v-if="editChangePreview?.modelDiff.removed.length">
                        <NText depth="3" style="font-size: 12px;">{{ t('pages.models.preview.removedModels') }}</NText>
                        <NSpace :size="6" style="margin-top: 6px; flex-wrap: wrap;">
                          <NTag
                            v-for="id in editChangePreview?.modelDiff.removed"
                            :key="`remove-${id}`"
                            type="error"
                            size="small"
                            :bordered="false"
                          >
                            - {{ id }}
                          </NTag>
                        </NSpace>
                      </div>
                    </NSpace>
                  </NCollapseItem>
                </NCollapse>

                <div class="models-preview-paths">
                  <NText depth="3" style="font-size: 12px;">{{ t('pages.models.preview.patchPaths') }}</NText>
                  <NSpace :size="6" style="margin-top: 6px; flex-wrap: wrap;">
                    <NTag
                      v-for="path in editChangePreview?.patchPaths || []"
                      :key="`edit-path-${path}`"
                      size="small"
                      :bordered="false"
                    >
                      {{ path }}
                    </NTag>
                  </NSpace>
                </div>

                <NAlert v-if="editChangePreview?.warnings.length" type="warning" :bordered="false">
                  <div v-for="(warning, index) in editChangePreview?.warnings" :key="index">
                    {{ warning }}
                  </div>
                </NAlert>

                <NAlert v-if="editChangePreview && !editChangePreview.hasChanges" type="info" :bordered="false">
                  {{ t('pages.models.preview.noChangesHint') }}
                </NAlert>

                <NSpace justify="space-between">
                  <NButton @click="editActiveTab = 'models'">{{ t('pages.models.actions.prev') }}</NButton>
                  <NButton
                    type="primary"
                    :loading="configStore.saving"
                    :disabled="!editChangePreview?.hasChanges"
                    @click="handleSaveProviderClick"
                  >
                    <template #icon><NIcon :component="SaveOutline" /></template>
                    {{ providerSubmitLabel }}
                  </NButton>
                </NSpace>
              </NSpace>
            </NTabPane>
          </NTabs>

          <NCollapse v-if="selectedProviderRawText">
            <NCollapseItem :title="t('pages.models.editor.rawConfigTitle')" name="provider-raw-json">
              <NCode :code="selectedProviderRawText" language="json" style="font-size: 12px;" />
            </NCollapseItem>
          </NCollapse>
        </NSpace>
      </template>

      <NEmpty v-else :description="t('pages.models.editor.empty')">
        <template #extra>
          <NButton size="small" type="primary" @click="handleNewProvider">
            <template #icon><NIcon :component="AddOutline" /></template>
            {{ t('pages.models.actions.createProvider') }}
          </NButton>
        </template>
      </NEmpty>

      <template #footer>
        <NSpace justify="end">
          <NButton @click="handleCloseEditProviderModal">{{ t('common.cancel') }}</NButton>
        </NSpace>
      </template>
    </NModal>

    <NModal
      v-model:show="showCreateProviderModal"
      preset="card"
      :title="t('pages.models.createModal.title')"
      style="max-width: 720px; width: 92vw;"
      :mask-closable="false"
    >
      <NAlert type="default" :bordered="false" style="margin-bottom: 12px;">
        {{ t('pages.models.createModal.flowHint') }}
      </NAlert>

      <NTabs v-model:value="createActiveTab" type="line" animated>
        <NTabPane name="basic" :tab="t('pages.models.tabs.basic')">
          <NForm label-placement="left" label-width="100">
            <NFormItem :label="t('pages.models.form.providerId')">
              <NInput v-model:value="createProviderForm.id" :placeholder="t('pages.models.form.providerIdPlaceholder')" />
            </NFormItem>
            <NFormItem :label="t('pages.models.form.apiProtocol')">
              <NSelect v-model:value="createProviderForm.api" :options="apiOptions" />
            </NFormItem>
            <NFormItem :label="t('pages.models.form.baseUrl')">
              <NInput v-model:value="createProviderForm.baseUrl" :placeholder="t('pages.models.form.baseUrlPlaceholder')" />
            </NFormItem>
            <NFormItem :label="t('pages.models.form.apiKey')">
              <NInput
                v-model:value="createProviderForm.apiKey"
                type="password"
                show-password-on="click"
                :placeholder="t('pages.models.form.apiKeyPlaceholderCreateRequired')"
              />
            </NFormItem>
            <NFormItem>
              <NSpace justify="end" style="width: 100%;">
                <NButton type="primary" @click="createActiveTab = 'models'">{{ t('pages.models.actions.nextToModels') }}</NButton>
              </NSpace>
            </NFormItem>
          </NForm>
        </NTabPane>

        <NTabPane name="models" :tab="t('pages.models.tabs.models')">
          <NForm label-placement="left" label-width="100">
            <NFormItem :label="t('pages.models.form.models')">
              <NSpace vertical :size="8" style="width: 100%;">
                <NButton
                  size="small"
                  type="primary"
                  dashed
                  @click="createProviderForm.models.push({ id: '', input: ['text'] })"
                >
                  {{ t('pages.models.form.addModel') }}
                </NButton>
                <div
                  v-for="(model, index) in createProviderForm.models"
                  :key="index"
                  style="display: flex; gap: 8px; align-items: center; width: 100%;"
                >
                  <NInput
                    v-model:value="model.id"
                    :placeholder="t('pages.models.form.modelIdPlaceholder')"
                    style="flex: 1;"
                  />
                  <NSelect
                    v-model:value="model.input"
                    :options="modelInputTypeOptions"
                    multiple
                    :placeholder="t('pages.models.form.modelInputTypesPlaceholder')"
                    style="width: 160px;"
                  />
                  <NButton
                    size="small"
                    :type="getPrimaryModelStatus('create', createProviderForm.id, model.id) === 'current' ? 'success' : getPrimaryModelStatus('create', createProviderForm.id, model.id) === 'pending' ? 'warning' : 'default'"
                    :disabled="!model.id || getPrimaryModelStatus('create', createProviderForm.id, model.id) === 'current'"
                    @click="setAsPendingPrimaryModel('create', createProviderForm.id, model.id)"
                  >
                    {{ getPrimaryModelStatus('create', createProviderForm.id, model.id) === 'current' ? t('pages.models.form.isDefault') : getPrimaryModelStatus('create', createProviderForm.id, model.id) === 'pending' ? t('pages.models.form.pendingDefault') : t('pages.models.form.setAsDefault') }}
                  </NButton>
                  <NButton
                    size="small"
                    quaternary
                    type="error"
                    @click="createProviderForm.models.splice(index, 1)"
                  >
                    <template #icon>
                      <NIcon><CloseOutline /></NIcon>
                    </template>
                  </NButton>
                </div>
                <NText depth="3" style="font-size: 12px;">
                  {{ t('pages.models.form.modelsHint') }}
                </NText>
              </NSpace>
            </NFormItem>
            <NFormItem>
              <NSpace justify="space-between" style="width: 100%;">
                <NButton @click="createActiveTab = 'basic'">{{ t('pages.models.actions.prev') }}</NButton>
                <NSpace>
                  <NButton type="primary" @click="createActiveTab = 'preview'">{{ t('pages.models.actions.nextToPreview') }}</NButton>
                </NSpace>
              </NSpace>
            </NFormItem>
          </NForm>
        </NTabPane>

        <NTabPane name="preview" :tab="t('pages.models.tabs.preview')">
          <NSpace vertical :size="8">
            <div class="models-preview-grid">
              <div class="models-preview-card" :class="{ 'is-changed': !!createChangePreview.providerId }">
                <NText depth="3" class="models-preview-label">{{ t('pages.models.form.providerId') }}</NText>
                <NTag size="small" :type="createChangePreview.providerExists ? 'error' : 'info'" :bordered="false">
                  {{ createChangePreview.providerId || t('pages.models.preview.notProvided') }}
                </NTag>
              </div>

              <div class="models-preview-card">
                <NText depth="3" class="models-preview-label">{{ t('pages.models.preview.apiProtocol') }}</NText>
                <code>{{ createChangePreview.api }}</code>
              </div>

              <div class="models-preview-card" :class="{ 'is-changed': createChangePreview.baseUrl !== '-' }">
                <NText depth="3" class="models-preview-label">Base URL</NText>
                <code>{{ createChangePreview.baseUrl }}</code>
              </div>

              <div class="models-preview-card" :class="{ 'is-changed': createChangePreview.modelIds.length > 0 }">
                <NText depth="3" class="models-preview-label">{{ t('pages.models.preview.models') }}</NText>
                <code>{{ createChangePreview.modelIds.length }}</code>
              </div>

              <div class="models-preview-card" :class="{ 'is-changed': createChangePreview.hasApiKey }">
                <NText depth="3" class="models-preview-label">API Key</NText>
                <NTag size="small" :type="createChangePreview.hasApiKey ? 'warning' : 'error'" :bordered="false">
                  {{ createChangePreview.hasApiKey ? t('pages.models.preview.willWriteMasked') : t('pages.models.preview.notProvided') }}
                </NTag>
              </div>

              <div class="models-preview-card" :class="{ 'is-changed': !!createChangePreview.inferredPrimary }">
                <NText depth="3" class="models-preview-label">{{ t('pages.models.preview.primaryModel') }}</NText>
                <NTag size="small" :type="createChangePreview.inferredPrimary ? 'warning' : 'default'" :bordered="false">
                  {{ createChangePreview.inferredPrimary || t('pages.models.preview.unchanged') }}
                </NTag>
              </div>
            </div>

            <NCollapse v-if="createChangePreview.modelIds.length > 0">
              <NCollapseItem :title="t('pages.models.preview.modelsListTitle', { count: createChangePreview.modelIds.length })" name="create-model-list">
                <NSpace :size="6" style="flex-wrap: wrap;">
                  <NTag
                    v-for="id in createChangePreview.modelIds"
                    :key="`create-model-${id}`"
                    size="small"
                    :bordered="false"
                  >
                    {{ id }}
                  </NTag>
                </NSpace>
              </NCollapseItem>
            </NCollapse>

            <div class="models-preview-paths">
              <NText depth="3" style="font-size: 12px;">{{ t('pages.models.preview.patchPaths') }}</NText>
              <NSpace :size="6" style="margin-top: 6px; flex-wrap: wrap;">
                <NTag
                  v-for="path in createChangePreview.patchPaths"
                  :key="`create-path-${path}`"
                  size="small"
                  :bordered="false"
                >
                  {{ path }}
                </NTag>
              </NSpace>
            </div>

            <NAlert v-if="createChangePreview.warnings.length" type="warning" :bordered="false">
              <div v-for="(warning, index) in createChangePreview.warnings" :key="index">
                {{ warning }}
              </div>
            </NAlert>

            <NAlert v-if="!createChangePreview.ready" type="info" :bordered="false">
              {{ t('pages.models.preview.missingRequired', {
                fields: joinDisplayList(createChangePreview.missingRequired) || t('pages.models.preview.none'),
              }) }}
            </NAlert>

            <NSpace justify="space-between">
              <NButton @click="createActiveTab = 'models'">{{ t('pages.models.actions.prev') }}</NButton>
              <NButton
                type="primary"
                :loading="configStore.saving"
                :disabled="!createChangePreview.ready"
                @click="handleCreateProviderClick"
              >
                <template #icon><NIcon :component="SaveOutline" /></template>
                {{ t('pages.models.actions.createProvider') }}
              </NButton>
            </NSpace>
          </NSpace>
        </NTabPane>
      </NTabs>

      <template #footer>
        <NSpace justify="end">
          <NButton @click="showCreateProviderModal = false">{{ t('common.cancel') }}</NButton>
        </NSpace>
      </template>
    </NModal>

    <NModal
      v-model:show="showSaveConfirmModal"
      preset="card"
      :title="saveConfirmTitle"
      style="max-width: 760px; width: 92vw;"
      :mask-closable="false"
    >
      <NSpace vertical :size="12">
        <NAlert type="warning" :bordered="false">
          {{ t('pages.models.confirm.warningPrefix') }}<code>config.patch</code>{{ t('pages.models.confirm.warningSuffix') }}
        </NAlert>

        <template v-if="confirmActionType === 'edit' && editChangePreview">
          <NDescriptions bordered :column="1" size="small" label-placement="left">
            <NDescriptionsItem :label="t('pages.models.confirm.editProvider')">
              <NTag size="small" type="info" :bordered="false">
                {{ editChangePreview.providerId }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.form.apiProtocol')">
              {{ editChangePreview.apiDiff.before }} -> {{ editChangePreview.apiDiff.after }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.form.baseUrl')">
              {{ editChangePreview.baseUrlDiff.before }} -> {{ editChangePreview.baseUrlDiff.after }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.preview.models')">
              {{ editChangePreview.modelDiff.beforeCount }} -> {{ editChangePreview.modelDiff.afterCount }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.form.apiKey')">
              {{ editChangePreview.apiKeyAction === 'overwrite'
                ? t('pages.models.preview.apiKeyOverwrite')
                : t('pages.models.preview.apiKeyKeep') }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.preview.primaryModel')">
              {{ editChangePreview.inferredPrimary || t('pages.models.preview.unchanged') }}
            </NDescriptionsItem>
          </NDescriptions>

          <NCollapse v-if="editChangePreview.modelDiff.changed">
            <NCollapseItem
              :title="t('pages.models.confirm.modelDiffTitle', {
                added: editChangePreview.modelDiff.added.length,
                removed: editChangePreview.modelDiff.removed.length,
              })"
              name="confirm-edit-models"
            >
              <NSpace vertical :size="8">
                <div v-if="editChangePreview.modelDiff.added.length">
                  <NText depth="3" style="font-size: 12px;">{{ t('pages.models.preview.addedModels') }}</NText>
                  <NSpace :size="6" style="margin-top: 6px; flex-wrap: wrap;">
                    <NTag
                      v-for="id in editChangePreview.modelDiff.added"
                      :key="`confirm-add-${id}`"
                      type="success"
                      size="small"
                      :bordered="false"
                    >
                      + {{ id }}
                    </NTag>
                  </NSpace>
                </div>
                <div v-if="editChangePreview.modelDiff.removed.length">
                  <NText depth="3" style="font-size: 12px;">{{ t('pages.models.preview.removedModels') }}</NText>
                  <NSpace :size="6" style="margin-top: 6px; flex-wrap: wrap;">
                    <NTag
                      v-for="id in editChangePreview.modelDiff.removed"
                      :key="`confirm-remove-${id}`"
                      type="error"
                      size="small"
                      :bordered="false"
                    >
                      - {{ id }}
                    </NTag>
                  </NSpace>
                </div>
              </NSpace>
            </NCollapseItem>
          </NCollapse>

          <NText depth="3" style="font-size: 12px;">
            {{ t('pages.models.preview.patchPathsWithValue', { paths: editChangePreview.patchPaths.join(', ') }) }}
          </NText>
        </template>

        <template v-else>
          <NDescriptions bordered :column="1" size="small" label-placement="left">
            <NDescriptionsItem :label="t('pages.models.confirm.createProvider')">
              <NTag size="small" type="info" :bordered="false">
                {{ createChangePreview.providerId || t('pages.models.preview.notProvided') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.form.apiProtocol')">
              {{ createChangePreview.api }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.form.baseUrl')">
              {{ createChangePreview.baseUrl }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.preview.models')">
              {{ createChangePreview.modelIds.length }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.form.apiKey')">
              {{ createChangePreview.hasApiKey ? t('pages.models.preview.willWriteMasked') : t('pages.models.preview.notProvided') }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="t('pages.models.preview.primaryModel')">
              {{ createChangePreview.inferredPrimary || t('pages.models.preview.unchanged') }}
            </NDescriptionsItem>
          </NDescriptions>

          <NCollapse v-if="createChangePreview.modelIds.length > 0">
            <NCollapseItem :title="t('pages.models.preview.modelsListTitle', { count: createChangePreview.modelIds.length })" name="confirm-create-models">
              <NSpace :size="6" style="flex-wrap: wrap;">
                <NTag
                  v-for="id in createChangePreview.modelIds"
                  :key="`confirm-create-${id}`"
                  size="small"
                  :bordered="false"
                >
                  {{ id }}
                </NTag>
              </NSpace>
            </NCollapseItem>
          </NCollapse>

          <NText depth="3" style="font-size: 12px;">
            {{ t('pages.models.preview.patchPathsWithValue', { paths: createChangePreview.patchPaths.join(', ') || '-' }) }}
          </NText>
        </template>

        <NAlert v-if="confirmActionType === 'edit' && editChangePreview?.warnings.length" type="warning" :bordered="false">
          <div v-for="(warning, index) in editChangePreview?.warnings" :key="`confirm-edit-warning-${index}`">
            {{ warning }}
          </div>
        </NAlert>
        <NAlert v-if="confirmActionType === 'create' && createChangePreview.warnings.length" type="warning" :bordered="false">
          <div v-for="(warning, index) in createChangePreview.warnings" :key="`confirm-create-warning-${index}`">
            {{ warning }}
          </div>
        </NAlert>
      </NSpace>

      <template #footer>
        <NSpace justify="end">
          <NButton @click="showSaveConfirmModal = false">{{ t('common.cancel') }}</NButton>
          <NButton
            type="primary"
            :loading="configStore.saving"
            :disabled="!canConfirmSave"
            @click="handleConfirmSave"
          >
            {{ saveConfirmButtonLabel }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.models-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.models-overview-card {
  border-radius: var(--radius-lg);
  background:
    radial-gradient(circle at 86% 12%, rgba(32, 128, 240, 0.18), transparent 36%),
    linear-gradient(125deg, var(--bg-card), rgba(24, 160, 88, 0.08));
  border: 1px solid rgba(32, 128, 240, 0.16);
}

.models-overview-title {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
}

.models-overview-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.models-metric-item {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-primary);
  padding: 10px 12px;
}

.models-metric-value {
  margin-top: 4px;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.2;
}

.models-metric-code {
  font-size: 14px;
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.models-workbench-card {
  border-radius: var(--radius-lg);
}

.models-quick-card {
  border-radius: var(--radius-lg);
}

.models-quick-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.models-quick-item {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 12px;
  background:
    radial-gradient(circle at 88% 10%, rgba(24, 160, 88, 0.12), transparent 45%),
    var(--bg-primary);
}

.models-quick-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.models-quick-meta {
  font-size: 12px;
  line-height: 1.45;
}

.models-quick-meta code {
  white-space: normal;
  word-break: break-all;
}

.models-quick-doc-link {
  color: var(--primary-color);
  font-size: 12px;
  text-decoration: none;
}

.models-quick-doc-link:hover {
  text-decoration: underline;
}

.models-workbench-item {
  min-width: 0;
}

.models-panel {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 12px;
  background: var(--bg-primary);
  overflow: hidden;
}

.models-panel :deep(.n-data-table-wrapper) {
  overflow-x: auto;
}

.models-provider-table :deep(.n-data-table-th),
.models-provider-table :deep(.n-data-table-td) {
  padding: 9px 10px;
}

.models-provider-actions-wrap {
  width: 100%;
  display: flex;
  justify-content: flex-end;
}

.models-provider-actions {
  align-items: center;
  flex-wrap: nowrap;
  justify-content: flex-end;
}

.models-action-btn {
  min-width: 72px;
  height: 34px;
  padding: 0 12px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.1px;
  transition: transform 0.16s ease, box-shadow 0.16s ease;
}

.models-action-btn--active {
  min-width: 82px;
}

.models-action-btn:not(:disabled):hover {
  transform: translateY(-1px);
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.12);
}

.models-panel-toolbar {
  margin-bottom: 10px;
}

.models-editor-header {
  margin-bottom: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.models-preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.models-preview-card {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.models-preview-card.is-changed {
  border-color: rgba(24, 160, 88, 0.5);
  background: rgba(24, 160, 88, 0.08);
}

.models-preview-label {
  font-size: 12px;
}

.models-preview-card code {
  white-space: normal;
  word-break: break-all;
  font-size: 12px;
}

.models-preview-diff {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.models-preview-diff--block {
  align-items: flex-start;
}

.models-preview-arrow {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.models-preview-paths {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--bg-primary);
}

.models-empty {
  margin-top: 12px;
}

@media (max-width: 1100px) {
  .models-overview-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .models-quick-grid {
    grid-template-columns: 1fr;
  }

  .models-panel-toolbar {
    flex-direction: column;
    align-items: stretch !important;
  }
}
</style>
