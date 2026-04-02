import { OpenClawWebSocket } from './websocket'
import type {
  RPCResponse,
  Session,
  SessionDetail,
  SessionExport,
  Channel,
  ChannelAuthParams,
  PairParams,
  ChannelStatus,
  OpenClawConfig,
  ConfigPatch,
  PluginPackage,
  Skill,
  Tool,
  DeviceNode,
  NodeInvokeParams,
  AgentParams,
  AgentInfo,
  AgentsListResult,
  AgentFileEntry,
  AgentFilesListResult,
  AgentFilesGetResult,
  AgentFilesSetResult,
  SendParams,
  ChatMessage,
  ChatMessageContent,
  ChatSendParams,
  CronJob,
  CronRunLogEntry,
  CronStatus,
  CronUpsertParams,
  ModelInfo,
  SessionsUsageParams,
  SessionsUsageResult,
  CostUsageSummary,
  LogsTailParams,
  LogsTailResult,
  HealthSummary,
  StatusSummary,
  SystemPresenceEntry,
  ExecApprovalsAgent,
  ExecApprovalsDefaults,
  ExecApprovalsFile,
  ExecApprovalsSnapshot,
  UpdateRunResponse,
  UpdateRunResult,
} from './types'

let requestId = 0
function nextId(): string {
  return `rpc-${++requestId}-${Date.now()}`
}

export class RPCClient {
  private readonly ws: OpenClawWebSocket

  constructor(ws: OpenClawWebSocket) {
    this.ws = ws
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
    return {}
  }

  private asString(value: unknown, fallback = ''): string {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return fallback
  }

  private asNumber(value: unknown, fallback = 0): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
    return fallback
  }

  private asBoolean(value: unknown, fallback = false): boolean {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      if (value === 'true') return true
      if (value === 'false') return false
    }
    return fallback
  }

  private resolveCountNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return Math.floor(value)
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.floor(parsed)
      }
    }
    return undefined
  }

  private resolveSessionMessageCount(row: Record<string, unknown>): number {
    const directCandidates = [
      row.messageCount,
      row.message_count,
      row.messagesCount,
      row.messages_count,
      row.turns,
      row.turn_count,
      row.totalMessages,
      row.total_messages,
      row.count,
    ]
    for (const candidate of directCandidates) {
      const count = this.resolveCountNumber(candidate)
      if (count !== undefined) {
        return count
      }
    }

    const listCandidates = [
      row.messages,
      row.transcript,
      row.history,
      row.items,
    ]
    for (const candidate of listCandidates) {
      if (Array.isArray(candidate)) {
        return candidate.length
      }
    }

    const nestedRows = [
      this.asRecord(row.messages),
      this.asRecord(row.messageCounts),
      this.asRecord(row.message_counts),
      this.asRecord(row.stats),
      this.asRecord(row.metrics),
    ]
    for (const nested of nestedRows) {
      const count = this.resolveCountNumber(
        nested.total ??
          nested.count ??
          nested.messages ??
          nested.messageCount ??
          nested.message_count
      )
      if (count !== undefined) {
        return count
      }
    }

    const usageRow = this.asRecord(row.usage)
    const usageMessageCounts = this.asRecord(usageRow.messageCounts ?? usageRow.message_counts)
    const usageCount = this.resolveCountNumber(
      usageMessageCounts.total ??
        usageMessageCounts.count ??
        usageMessageCounts.messages ??
        usageRow.messages ??
        usageRow.messageCount ??
        usageRow.message_count
    )
    if (usageCount !== undefined) {
      return usageCount
    }

    return 0
  }

  private asText(value: unknown): string {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)

    if (Array.isArray(value)) {
      return value
        .map((item) => this.asText(item))
        .filter((item) => !!item.trim())
        .join('\n')
    }

    if (value && typeof value === 'object') {
      const row = value as Record<string, unknown>

      if ('text' in row) return this.asText(row.text)
      if ('content' in row) return this.asText(row.content)
      if ('message' in row) return this.asText(row.message)
      if ('output' in row) return this.asText(row.output)
      if ('input' in row) return this.asText(row.input)
      if ('delta' in row) return this.asText(row.delta)

      try {
        return JSON.stringify(row)
      } catch {
        return ''
      }
    }

    return ''
  }

  private pickTokenNumber(row: Record<string, unknown>, keys: string[]): number | undefined {
    for (const key of keys) {
      if (!(key in row)) continue
      const parsed = this.asNumber(row[key], Number.NaN)
      if (Number.isFinite(parsed) && parsed >= 0) return parsed
    }
    return undefined
  }

  private normalizeTokenUsage(value: unknown, depth = 0): Session['tokenUsage'] | undefined {
    if (depth > 2) return undefined
    const row = this.asRecord(value)
    if (!row) return undefined

    const input = this.pickTokenNumber(row, [
      'totalInput',
      'input',
      'inputTokens',
      'promptTokens',
      'prompt_tokens',
      'input_tokens',
    ])
    const output = this.pickTokenNumber(row, [
      'totalOutput',
      'output',
      'outputTokens',
      'completionTokens',
      'completion_tokens',
      'output_tokens',
    ])
    const total = this.pickTokenNumber(row, [
      'totalTokens',
      'tokenTotal',
      'tokensTotal',
      'total_tokens',
    ])

    if (input !== undefined || output !== undefined || total !== undefined) {
      if (input === undefined && output === undefined && total !== undefined) {
        return { totalInput: total, totalOutput: 0 }
      }
      return {
        totalInput: input ?? 0,
        totalOutput: output ?? 0,
      }
    }

    const nestedCandidates = [
      row.tokenUsage,
      row.usage,
      row.tokens,
      row.token_usage,
      row.llmUsage,
      row.modelUsage,
      row.metrics,
      row.stats,
    ]

    for (const nested of nestedCandidates) {
      const parsed = this.normalizeTokenUsage(nested, depth + 1)
      if (parsed) return parsed
    }

    return undefined
  }

  private normalizeSessionChannel(channel: string): string {
    const value = channel.trim().toLowerCase()
    if (!value) return 'main'
    if (value === 'webchat') return 'main'
    if (value === 'qq' || value === 'qqbot') return 'qqbot'
    if (value === 'feishu-china') return 'feishu'
    if (value === 'wecom-app') return 'wecom'
    return value
  }

  private isGenericSessionChannel(channel: string): boolean {
    return !channel || channel === 'main' || channel === 'unknown'
  }

  private parseSessionKeyMeta(key: string): { agentId: string; channel: string; peer: string } {
    const raw = key.trim()
    if (!raw) {
      return {
        agentId: 'main',
        channel: 'main',
        peer: '',
      }
    }

    const lowered = raw.toLowerCase()
    if (lowered === 'main') {
      return {
        agentId: 'main',
        channel: 'main',
        peer: '',
      }
    }
    if (lowered === 'global') {
      return {
        agentId: 'main',
        channel: 'global',
        peer: '',
      }
    }
    if (lowered === 'unknown') {
      return {
        agentId: 'main',
        channel: 'unknown',
        peer: '',
      }
    }

    const parts = raw.split(':').filter(Boolean)
    if (parts[0] === 'agent' && parts.length >= 3) {
      const agentId = this.asString(parts[1], 'main')
      const rest = parts.slice(2)
      const head = this.asString(rest[0]).toLowerCase()
      const second = this.asString(rest[1]).toLowerCase()
      const third = this.asString(rest[2]).toLowerCase()

      if (!head || head === 'main') {
        return {
          agentId,
          channel: 'main',
          peer: rest.slice(1).join(':'),
        }
      }

      if (head === 'direct') {
        return {
          agentId,
          channel: 'main',
          peer: rest.slice(1).join(':'),
        }
      }

      if (head === 'cron' || head === 'subagent' || head === 'acp') {
        return {
          agentId,
          channel: head,
          peer: rest.slice(1).join(':'),
        }
      }

      if (second === 'direct' || second === 'group' || second === 'channel') {
        return {
          agentId,
          channel: this.normalizeSessionChannel(head),
          peer: rest.slice(2).join(':'),
        }
      }

      if (third === 'direct' || third === 'group' || third === 'channel') {
        return {
          agentId,
          channel: this.normalizeSessionChannel(head),
          peer: rest.slice(3).join(':'),
        }
      }

      return {
        agentId,
        channel: this.normalizeSessionChannel(head),
        peer: rest.slice(1).join(':'),
      }
    }

    if (parts[0] === 'cron') {
      return {
        agentId: 'main',
        channel: 'cron',
        peer: parts.slice(1).join(':'),
      }
    }

    if (parts[0] === 'direct') {
      return {
        agentId: 'main',
        channel: 'main',
        peer: parts.slice(1).join(':'),
      }
    }

    if (parts.length >= 2) {
      return {
        agentId: parts[0] || 'main',
        channel: this.normalizeSessionChannel(parts[1] || 'main'),
        peer: parts.slice(2).join(':'),
      }
    }

    return {
      agentId: 'main',
      channel: 'main',
      peer: '',
    }
  }

  private resolveSessionChannel(params: { primary: string; fallback: string }): string {
    const primary = this.normalizeSessionChannel(params.primary)
    const fallback = this.normalizeSessionChannel(params.fallback)

    // Session key usually encodes a concrete channel; prefer it over generic "main".
    if (!this.isGenericSessionChannel(fallback) && this.isGenericSessionChannel(primary)) {
      return fallback
    }

    if (primary && primary !== 'unknown') return primary

    if (fallback) return fallback

    return primary || 'main'
  }

  private normalizeSessionItem(value: unknown): Session {
    const row = this.asRecord(value)
    const key = this.asString(row.key || row.sessionKey || row.id)
    const parsed = this.parseSessionKeyMeta(key)
    const deliveryContext = this.asRecord(row.deliveryContext)
    const deliveryChannel = this.asString(
      deliveryContext.channel || deliveryContext.provider || deliveryContext.surface
    )
    const primaryChannel = this.asString(
      row.channel || row.lastChannel || deliveryChannel || row.platform
    )
    const channel = this.resolveSessionChannel({
      primary: primaryChannel,
      fallback: parsed.channel,
    })
    const tokenUsage =
      this.normalizeTokenUsage(row.tokenUsage) ||
      this.normalizeTokenUsage(row.usage) ||
      this.normalizeTokenUsage(row.tokens)
    return {
      key,
      agentId: this.asString(row.agentId || row.agent || parsed.agentId, 'main'),
      channel,
      peer: this.asString(row.peer || row.user || row.recipient || row.subject || parsed.peer),
      messageCount: this.resolveSessionMessageCount(row),
      lastActivity: this.asString(row.lastActivity || row.updatedAt || row.lastSeen),
      model: this.asString(row.model || row.modelName) || undefined,
      label: this.asString(row.label || row.displayName) || undefined,
      tokenUsage,
    }
  }

  private normalizeChannelItem(value: unknown): Channel {
    const row = this.asRecord(value)
    const statusRaw = this.asString(row.status || row.state, this.asBoolean(row.connected) ? 'connected' : 'disconnected')
    const status: ChannelStatus =
      statusRaw === 'connected' ||
      statusRaw === 'disconnected' ||
      statusRaw === 'authenticating' ||
      statusRaw === 'error'
        ? statusRaw
        : 'disconnected'
    const dmPolicyRaw = this.asString(row.dmPolicy || row.policy, 'pairing')
    const dmPolicy: Channel['dmPolicy'] =
      dmPolicyRaw === 'pairing' ||
      dmPolicyRaw === 'allowlist' ||
      dmPolicyRaw === 'open' ||
      dmPolicyRaw === 'disabled'
        ? dmPolicyRaw
        : 'pairing'

    const groupsRaw = row.groups
    const groups = Array.isArray(groupsRaw) ? groupsRaw : undefined
    const groupAllowFromRaw = row.groupAllowFrom || row.allowFrom
    const groupAllowFrom = Array.isArray(groupAllowFromRaw)
      ? groupAllowFromRaw
          .map((item) => this.asString(item))
          .filter((item) => !!item.trim())
      : undefined
    const requireMention = 'requireMention' in row
      ? this.asBoolean(row.requireMention, false)
      : undefined
    const groupPolicy = this.asString(row.groupPolicy)
    const channelKey = this.asString(row.channelKey || row.channel || row.platform || row.type || row.kind || row.id)
    const accountId = this.asString(
      row.accountId ||
        row.account ||
        row.accountName ||
        row.botId ||
        row.selfId ||
        row.userId
    )
    const id = this.asString(
      row.id ||
        row.channelId ||
        row.name ||
        (channelKey && accountId ? `${channelKey}:${accountId}` : channelKey),
      'unknown'
    )

    return {
      id,
      platform: this.asString(row.platform || channelKey || row.id, 'unknown'),
      channelKey: channelKey || undefined,
      accountId: accountId || undefined,
      enabled: this.asBoolean(row.enabled, true),
      status,
      accountName: this.asString(row.accountName || row.account || row.name) || undefined,
      memberCount: this.asNumber(row.memberCount, 0) || undefined,
      dmPolicy,
      groupPolicy: groupPolicy || undefined,
      requireMention,
      groupAllowFrom,
      groups: groups as Channel['groups'],
    }
  }

  private normalizeChannelStatusFromSnapshot(params: {
    connected?: boolean
    running?: boolean
    linked?: boolean
    configured?: boolean
    hasConnected?: boolean
    hasRunning?: boolean
    hasLinked?: boolean
    lastError?: string
  }): ChannelStatus {
    const connectedKnown = params.hasConnected ?? params.connected !== undefined
    const runningKnown = params.hasRunning ?? params.running !== undefined
    const linkedKnown = params.hasLinked ?? params.linked !== undefined
    const connected = connectedKnown && params.connected === true
    const running = runningKnown && params.running === true
    const linked = linkedKnown && params.linked === true
    const explicitlyUnlinked = linkedKnown && params.linked === false
    const lastError = (params.lastError || '').trim().toLowerCase()
    const benignErrors = new Set([
      '',
      'disabled',
      'not configured',
      'unconfigured',
      'not linked',
      'disconnected',
      'offline',
    ])

    if (connected) return 'connected'
    if (lastError && !benignErrors.has(lastError)) return 'error'
    if (running && explicitlyUnlinked) return 'authenticating'

    if (connectedKnown && params.connected === false) {
      if (running && !explicitlyUnlinked) return 'disconnected'
      if (linked) return 'disconnected'
      return params.configured === true ? 'disconnected' : 'disconnected'
    }

    if (running || linked) return 'connected'
    if (params.configured === true) return 'disconnected'
    return 'disconnected'
  }

  private normalizeChannelAccountEntries(
    accountsRaw: unknown,
    defaultAccountId: string
  ): Array<Record<string, unknown>> {
    if (Array.isArray(accountsRaw)) {
      return accountsRaw
        .map((accountRaw) => this.asRecord(accountRaw))
        .filter((account) => Object.keys(account).length > 0)
    }

    const accountMap = this.asRecord(accountsRaw)
    const entries: Array<Record<string, unknown>> = []
    for (const [key, accountRaw] of Object.entries(accountMap)) {
      const account = this.asRecord(accountRaw)
      if (Object.keys(account).length === 0) continue
      const accountId = this.asString(account.accountId || account.id, key || defaultAccountId)
      entries.push({
        ...account,
        accountId,
      })
    }
    return entries
  }

  private normalizeChannelsStatusPayload(payload: unknown): Channel[] {
    const row = this.asRecord(payload)
    const channelAccounts = this.asRecord(row.channelAccounts)
    const channelsSummary = this.asRecord(row.channels)
    const defaultAccountIdMap = this.asRecord(row.channelDefaultAccountId)
    const result: Channel[] = []
    const seen = new Set<string>()

    const pushChannel = (value: Record<string, unknown>) => {
      const normalized = this.normalizeChannelItem(value)
      if (!normalized.id || seen.has(normalized.id)) return
      seen.add(normalized.id)
      result.push(normalized)
    }

    for (const [channelKey, accountsRaw] of Object.entries(channelAccounts)) {
      const summary = this.asRecord(channelsSummary[channelKey])
      const defaultAccountId = this.asString(defaultAccountIdMap[channelKey], 'default')
      const accountEntries = this.normalizeChannelAccountEntries(accountsRaw, defaultAccountId)

      if (accountEntries.length > 0) {
        for (const account of accountEntries) {
          const accountId = this.asString(account.accountId || account.id, defaultAccountId)
          const hasConnected = 'connected' in account || 'connected' in summary
          const hasRunning = 'running' in account || 'running' in summary
          const hasLinked = 'linked' in account || 'linked' in summary
          const status = this.normalizeChannelStatusFromSnapshot({
            connected: 'connected' in account
              ? this.asBoolean(account.connected, false)
              : 'connected' in summary
                ? this.asBoolean(summary.connected, false)
                : undefined,
            running: 'running' in account
              ? this.asBoolean(account.running, false)
              : 'running' in summary
                ? this.asBoolean(summary.running, false)
                : undefined,
            linked: 'linked' in account
              ? this.asBoolean(account.linked, false)
              : 'linked' in summary
                ? this.asBoolean(summary.linked, false)
                : undefined,
            configured: 'configured' in account
              ? this.asBoolean(account.configured, false)
              : 'configured' in summary
                ? this.asBoolean(summary.configured, false)
                : undefined,
            hasConnected,
            hasRunning,
            hasLinked,
            lastError: this.asString(account.lastError || summary.lastError),
          })
          pushChannel({
            ...summary,
            ...account,
            id: `${channelKey}:${accountId}`,
            channel: channelKey,
            platform: channelKey,
            channelKey,
            accountId,
            status,
          })
        }
        continue
      }

      if (Object.keys(summary).length > 0) {
        const hasConnected = 'connected' in summary
        const hasRunning = 'running' in summary
        const hasLinked = 'linked' in summary
        const hasConfigured = 'configured' in summary
        const status = this.normalizeChannelStatusFromSnapshot({
          connected: hasConnected ? this.asBoolean(summary.connected, false) : undefined,
          running: hasRunning ? this.asBoolean(summary.running, false) : undefined,
          linked: hasLinked ? this.asBoolean(summary.linked, false) : undefined,
          configured: hasConfigured ? this.asBoolean(summary.configured, false) : undefined,
          hasConnected,
          hasRunning,
          hasLinked,
          lastError: this.asString(summary.lastError),
        })
        pushChannel({
          ...summary,
          id: `${channelKey}:${defaultAccountId}`,
          channel: channelKey,
          platform: channelKey,
          channelKey,
          accountId: defaultAccountId,
          status,
        })
      }
    }

    if (result.length > 0) return result

    for (const [channelKey, summaryRaw] of Object.entries(channelsSummary)) {
      const summary = this.asRecord(summaryRaw)
      const defaultAccountId = this.asString(defaultAccountIdMap[channelKey], 'default')
      const hasConnected = 'connected' in summary
      const hasRunning = 'running' in summary
      const hasLinked = 'linked' in summary
      const hasConfigured = 'configured' in summary
      const status = this.normalizeChannelStatusFromSnapshot({
        connected: hasConnected ? this.asBoolean(summary.connected, false) : undefined,
        running: hasRunning ? this.asBoolean(summary.running, false) : undefined,
        linked: hasLinked ? this.asBoolean(summary.linked, false) : undefined,
        configured: hasConfigured ? this.asBoolean(summary.configured, false) : undefined,
        hasConnected,
        hasRunning,
        hasLinked,
        lastError: this.asString(summary.lastError),
      })
      pushChannel({
        ...summary,
        id: `${channelKey}:${defaultAccountId}`,
        channel: channelKey,
        platform: channelKey,
        channelKey,
        accountId: defaultAccountId,
        status,
      })
    }

    return result
  }

  private normalizeSkillItem(value: unknown): Skill {
    const row = this.asRecord(value)
    const source = this.normalizeSkillSource(row)
    return {
      name: this.asString(row.name || row.id),
      description: this.asString(row.description) || undefined,
      version: this.asString(row.version) || undefined,
      source,
      installed: this.asBoolean(row.installed, source !== 'bundled'),
      eligible: this.asBoolean(row.eligible, true),
      disabled: this.asBoolean(row.disabled, false),
      bundled: this.asBoolean(row.bundled, source === 'bundled'),
      skillKey: this.asString(row.skillKey) || undefined,
      hasUpdate: this.asBoolean(row.hasUpdate, false) || undefined,
    }
  }

  private normalizePluginItem(value: unknown): PluginPackage {
    const row = this.asRecord(value)
    const name = this.asString(
      row.name || row.id || row.package || row.packageName || row.plugin || row.key
    )

    const status = this.asString(row.status || row.state || row.health)
    const installed =
      'installed' in row
        ? this.asBoolean(row.installed, false)
        : !(
            status.toLowerCase() === 'missing' ||
            status.toLowerCase() === 'not-installed' ||
            status.toLowerCase() === 'uninstalled'
          )

    return {
      name,
      installed,
      version: this.asString(row.version || row.ver) || undefined,
      enabled: 'enabled' in row ? this.asBoolean(row.enabled, true) : undefined,
      status: status || undefined,
    }
  }

  private normalizePluginList(payload: unknown): PluginPackage[] {
    const listByCandidates = this.normalizeList<unknown>(payload, [
      'plugins',
      'items',
      'list',
      'data',
      'entries',
    ])
      .map((item) => this.normalizePluginItem(item))
      .filter((item) => !!item.name)

    if (listByCandidates.length > 0) {
      return listByCandidates
    }

    const row = this.asRecord(payload)
    const pluginsRaw = this.asRecord(row.plugins || row.items || row.data)
    const entriesSource =
      Object.keys(pluginsRaw).length > 0
        ? pluginsRaw
        : row

    const fallback: PluginPackage[] = []
    for (const [key, value] of Object.entries(entriesSource)) {
      if (Array.isArray(value)) continue
      if (value && typeof value === 'object') {
        const parsed = this.normalizePluginItem({ key, ...(value as Record<string, unknown>) })
        if (parsed.name) fallback.push(parsed)
        continue
      }
      if (typeof value === 'boolean') {
        fallback.push({ name: key, installed: value })
        continue
      }
      if (typeof value === 'string' && value.trim()) {
        fallback.push({ name: key, installed: true, version: value.trim() })
      }
    }

    return fallback.filter((item) => !!item.name)
  }

  private normalizeSkillSource(row: Record<string, unknown>): Skill['source'] {
    const sourceRaw = this.asString(
      row.source || row.location || row.origin || row.scope || row.kind
    )
      .trim()
      .toLowerCase()

    if (!sourceRaw && this.asBoolean(row.bundled, false)) {
      return 'bundled'
    }

    const source = sourceRaw.replace(/^openclaw-/, '')
    if (source === 'workspace') return 'workspace'
    if (source === 'managed') return 'managed'
    if (source === 'bundled' || source === 'built-in' || source === 'builtin') return 'bundled'
    if (source === 'extra') return 'extra'

    if (sourceRaw.includes('workspace')) return 'workspace'
    if (sourceRaw.includes('managed')) return 'managed'
    if (sourceRaw.includes('bundled') || sourceRaw.includes('builtin')) return 'bundled'
    if (sourceRaw.includes('extra')) return 'extra'

    const filePath = this.asString(row.filePath || row.path).toLowerCase()
    if (/\.openclaw[\\/]+skills/.test(filePath)) return 'managed'
    if (/[\\/]+skills[\\/]/.test(filePath)) return 'workspace'

    return 'bundled'
  }

  private normalizeToolItem(value: unknown): Tool {
    const row = this.asRecord(value)
    return {
      name: this.asString(row.name || row.id),
      description: this.asString(row.description),
      category: this.asString(row.category || row.group, 'general'),
      enabled: this.asBoolean(row.enabled, true),
    }
  }

  private normalizeNodeItem(value: unknown): DeviceNode {
    const row = this.asRecord(value)
    const capabilities = Array.isArray(row.capabilities)
      ? row.capabilities.map((c) => this.asString(c)).filter(Boolean)
      : []

    return {
      id: this.asString(row.id || row.nodeId),
      name: this.asString(row.name || row.id, 'node'),
      platform: this.asString(row.platform || row.os, 'unknown'),
      connected: this.asBoolean(row.connected, false),
      capabilities,
      lastSeen: this.asString(row.lastSeen || row.updatedAt) || undefined,
    }
  }

  private normalizeAgentItem(value: unknown): AgentInfo {
    const row = this.asRecord(value)
    const identityRow = this.asRecord(row.identity)
    const id = this.asString(row.id || row.agentId || row.name)
    
    let model: string | undefined
    if (row.model) {
      if (typeof row.model === 'string') {
        model = this.asString(row.model)
      } else {
        const modelObj = this.asRecord(row.model)
        model = this.asString(modelObj.primary)
      }
    }
    
    return {
      id,
      name: this.asString(row.name) || undefined,
      identity: Object.keys(identityRow).length
        ? {
            name: this.asString(identityRow.name) || undefined,
            theme: this.asString(identityRow.theme) || undefined,
            emoji: this.asString(identityRow.emoji) || undefined,
            avatar: this.asString(identityRow.avatar) || undefined,
            avatarUrl: this.asString(identityRow.avatarUrl) || undefined,
          }
        : undefined,
      model,
    }
  }

  private normalizeAgentFileEntry(value: unknown): AgentFileEntry {
    const row = this.asRecord(value)
    const size = this.asNumber(row.size, Number.NaN)
    const updatedAtMs = this.asNumber(row.updatedAtMs || row.updatedAt || row.mtimeMs, Number.NaN)
    const isDirectory = this.asBoolean(row.isDirectory || row.is_dir || row.isDir, false)
    const type = this.asString(row.type) || (isDirectory ? 'directory' : 'file')
    return {
      name: this.asString(row.name),
      path: this.asString(row.path || row.filePath || row.file),
      missing: this.asBoolean(row.missing, false),
      size: Number.isFinite(size) && size >= 0 ? Math.floor(size) : undefined,
      updatedAtMs: Number.isFinite(updatedAtMs) && updatedAtMs >= 0 ? Math.floor(updatedAtMs) : undefined,
      content: 'content' in row ? this.asString(row.content) : undefined,
      type: type as 'file' | 'directory' | undefined,
      isDirectory,
    }
  }

  private normalizeAgentsListResult(payload: unknown): AgentsListResult {
    const row = this.asRecord(payload)
    const agents = this.normalizeList<unknown>(payload, ['agents', 'items', 'list', 'data'])
      .map((item) => this.normalizeAgentItem(item))
      .filter((item) => !!item.id)
    return {
      defaultId: this.asString(row.defaultId || row.defaultAgentId) || undefined,
      mainKey: this.asString(row.mainKey) || undefined,
      scope: this.asString(row.scope) || undefined,
      agents,
    }
  }

  private normalizeChatMessageItem(value: unknown): ChatMessage {
    const row = this.asRecord(value)
    const roleRaw = this.asString(row.role || row.type, 'assistant')
    const role: ChatMessage['role'] =
      roleRaw === 'user' ||
      roleRaw === 'assistant' ||
      roleRaw === 'tool' ||
      roleRaw === 'system' ||
      roleRaw === 'toolResult'
        ? (roleRaw === 'toolResult' ? 'tool' : roleRaw)
        : 'assistant'

    const rawContent = row.content
    let contentText = ''
    let rawContentArray: ChatMessage['rawContent'] | undefined

    if (Array.isArray(rawContent)) {
      rawContentArray = rawContent.map((item) => {
        const itemRow = this.asRecord(item) || {}
        const itemType = this.asString(itemRow.type) as ChatMessageContent['type'] || 'text'
        const baseContent = {
          type: itemType,
          text: this.asString(itemRow.text),
          thinking: this.asString(itemRow.thinking),
          id: this.asString(itemRow.id),
          name: this.asString(itemRow.name),
          arguments: this.asRecord(itemRow.arguments),
          content: itemRow.content,
          isError: itemRow.isError === true,
        }
        if (itemType === 'image') {
          return {
            ...baseContent,
            mimeType: this.asString(itemRow.mimeType || itemRow.mime_type),
            bytes: typeof itemRow.bytes === 'number' ? itemRow.bytes : undefined,
            data: this.asString(itemRow.data),
            mediaPath: this.asString(itemRow.mediaPath || itemRow.media_path),
          }
        }
        return baseContent
      })
      contentText = rawContent
        .map((item) => {
          const itemRow = this.asRecord(item) || {}
          if (itemRow.type === 'text') return this.asString(itemRow.text)
          if (itemRow.type === 'thinking') return this.asString(itemRow.thinking)
          if (itemRow.type === 'tool_call') {
            try {
              return JSON.stringify(itemRow.arguments, null, 2)
            } catch {
              return ''
            }
          }
          if (itemRow.type === 'tool_result') {
            const c = itemRow.content
            if (typeof c === 'string') return c
            try {
              return JSON.stringify(c, null, 2)
            } catch {
              return ''
            }
          }
          if (itemRow.type === 'image') {
            return '[图片]'
          }
          return ''
        })
        .filter(Boolean)
        .join('\n')
    } else {
      contentText = this.asText(
        rawContent ||
          row.text ||
          row.message ||
          row.output ||
          row.input ||
          row.delta ||
          (row.payload as unknown)
      )
    }

    return {
      id: this.asString(row.id || row.messageId || row.seq) || undefined,
      role,
      content: contentText,
      timestamp: this.asString(row.timestamp || row.createdAt || row.time) || undefined,
      name: this.asString(row.name || row.model) || undefined,
      model: this.asString(row.model) || undefined,
      provider: this.asString(row.provider) || undefined,
      stopReason: this.asString(row.stopReason) || undefined,
      toolCallId: this.asString(row.toolCallId || row.tool_call_id) || undefined,
      toolName: this.asString(row.toolName || row.tool_name) || undefined,
      isError: row.isError === true,
      rawContent: rawContentArray,
    }
  }

  private normalizeCronItem(value: unknown): CronJob {
    const row = this.asRecord(value)
    const scheduleObjRaw = this.normalizeCronSchedule(row.schedule)
    const scheduleTextRaw = this.asString(row.schedule || row.cron || row.expression || row.expr)
    const inferredSchedule = scheduleObjRaw || this.inferCronScheduleFromText(scheduleTextRaw, this.asString(row.timezone || row.tz) || undefined)
    const scheduleText = inferredSchedule ? this.formatCronSchedule(inferredSchedule) : (scheduleTextRaw || '* * * * *')
    const sessionTargetRaw = this.asString(row.sessionTarget)
    const sessionTarget: CronJob['sessionTarget'] =
      sessionTargetRaw === 'main' || sessionTargetRaw === 'isolated'
        ? sessionTargetRaw
        : undefined
    const wakeModeRaw = this.asString(row.wakeMode || row.wake)
    const wakeMode: CronJob['wakeMode'] =
      wakeModeRaw === 'now' || wakeModeRaw === 'next-heartbeat'
        ? wakeModeRaw
        : undefined
    const payload = this.normalizeCronPayload(row.payload)
    const delivery = this.normalizeCronDelivery(row.delivery) || this.normalizeCronDelivery(
      payload && payload.kind === 'agentTurn'
        ? {
            mode: payload.deliver === false ? 'none' : (payload.channel || payload.to || payload.deliver === true ? 'announce' : undefined),
            channel: payload.channel,
            to: payload.to,
            bestEffort: payload.bestEffortDeliver,
          }
        : undefined
    )
    const state = this.normalizeCronState(row.state)
    const nextRunAtMs = state?.nextRunAtMs || this.asNumber(row.nextRunAtMs || row.nextAtMs || row.nextTimeMs, 0)
    const lastRunAtMs = state?.lastRunAtMs || this.asNumber(row.lastRunAtMs || row.lastAtMs || row.lastTimeMs, 0)
    const nextRun = this.asString(row.nextRun || row.nextAt || row.nextTime) || (nextRunAtMs > 0 ? new Date(nextRunAtMs).toISOString() : undefined)
    const lastRun = this.asString(row.lastRun || row.lastAt || row.lastTime) || (lastRunAtMs > 0 ? new Date(lastRunAtMs).toISOString() : undefined)
    const deleteAfterRun = 'deleteAfterRun' in row ? this.asBoolean(row.deleteAfterRun, false) : undefined
    const createdAtMs = this.asNumber(row.createdAtMs, 0)
    const updatedAtMs = this.asNumber(row.updatedAtMs, 0)
    const timezone = inferredSchedule?.kind === 'cron'
      ? inferredSchedule.tz
      : (this.asString(row.timezone || row.tz) || undefined)

    return {
      id: this.asString(row.id || row.jobId || row.taskId || row.name, ''),
      agentId: this.asString(row.agentId || row.agent) || undefined,
      name: this.asString(row.name || row.title || row.id, 'unnamed'),
      description: this.asString(row.description) || undefined,
      enabled: this.asBoolean(row.enabled, !this.asBoolean(row.disabled, false)),
      deleteAfterRun,
      createdAtMs: createdAtMs > 0 ? createdAtMs : undefined,
      updatedAtMs: updatedAtMs > 0 ? updatedAtMs : undefined,
      scheduleObj: inferredSchedule,
      sessionTarget,
      wakeMode,
      payload,
      delivery,
      state,
      schedule: scheduleText,
      command: this.asString(row.command || row.cmd || row.script) || undefined,
      timezone,
      nextRun,
      lastRun,
    }
  }

  private normalizeCronSchedule(value: unknown): CronJob['scheduleObj'] {
    const row = this.asRecord(value)
    const kind = this.asString(row.kind).trim()

    if (kind === 'at') {
      const at = this.asString(row.at).trim()
      return at ? { kind: 'at', at } : undefined
    }

    if (kind === 'every') {
      const everyMs = this.asNumber(row.everyMs, 0)
      if (everyMs <= 0) return undefined
      const anchorMs = this.asNumber(row.anchorMs, 0)
      return {
        kind: 'every',
        everyMs,
        anchorMs: anchorMs > 0 ? anchorMs : undefined,
      }
    }

    if (kind === 'cron') {
      const expr = this.asString(row.expr || row.cron || row.expression).trim()
      if (!expr) return undefined
      const tz = this.asString(row.tz || row.timezone).trim()
      return {
        kind: 'cron',
        expr,
        tz: tz || undefined,
      }
    }

    return undefined
  }

  private inferCronScheduleFromText(exprText: string, tz?: string): CronJob['scheduleObj'] {
    const expr = exprText.trim()
    if (!expr) return undefined
    const parts = expr.split(/\s+/)
    if (parts.length !== 5) return undefined
    return {
      kind: 'cron',
      expr,
      tz,
    }
  }

  private formatCronSchedule(schedule: NonNullable<CronJob['scheduleObj']>): string {
    if (schedule.kind === 'cron') {
      return schedule.tz ? `${schedule.expr} (${schedule.tz})` : schedule.expr
    }

    if (schedule.kind === 'at') {
      return `at ${schedule.at}`
    }

    const everyMs = schedule.everyMs
    if (everyMs % 86_400_000 === 0) {
      return `every ${everyMs / 86_400_000} day(s)`
    }
    if (everyMs % 3_600_000 === 0) {
      return `every ${everyMs / 3_600_000} hour(s)`
    }
    if (everyMs % 60_000 === 0) {
      return `every ${everyMs / 60_000} minute(s)`
    }
    return `every ${everyMs} ms`
  }

  private normalizeCronPayload(value: unknown): CronJob['payload'] {
    const row = this.asRecord(value)
    const kind = this.asString(row.kind).trim()

    if (kind === 'systemEvent') {
      const text = this.asString(row.text || row.message).trim()
      return text ? { kind: 'systemEvent', text } : undefined
    }

    if (kind === 'agentTurn' || ('message' in row && typeof row.message === 'string')) {
      const message = this.asString(row.message || row.text).trim()
      if (!message) return undefined

      const timeoutSeconds = this.asNumber(row.timeoutSeconds, 0)
      return {
        kind: 'agentTurn',
        message,
        model: this.asString(row.model).trim() || undefined,
        thinking: this.asString(row.thinking).trim() || undefined,
        timeoutSeconds: timeoutSeconds > 0 ? timeoutSeconds : undefined,
        allowUnsafeExternalContent: 'allowUnsafeExternalContent' in row
          ? this.asBoolean(row.allowUnsafeExternalContent, false)
          : undefined,
        deliver: 'deliver' in row ? this.asBoolean(row.deliver, true) : undefined,
        channel: this.asString(row.channel).trim() || undefined,
        to: this.asString(row.to).trim() || undefined,
        bestEffortDeliver: 'bestEffortDeliver' in row
          ? this.asBoolean(row.bestEffortDeliver, false)
          : undefined,
      }
    }

    return undefined
  }

  private normalizeCronDelivery(value: unknown): CronJob['delivery'] {
    const row = this.asRecord(value)
    const modeRaw = this.asString(row.mode).trim()
    const mode: 'none' | 'announce' | undefined =
      modeRaw === 'none' || modeRaw === 'announce'
        ? modeRaw
        : undefined
    const channel = this.asString(row.channel).trim() || undefined
    const to = this.asString(row.to).trim() || undefined
    const bestEffort = 'bestEffort' in row ? this.asBoolean(row.bestEffort, false) : undefined

    if (!mode && !channel && !to && bestEffort === undefined) {
      return undefined
    }

    return {
      mode: mode || 'announce',
      channel,
      to,
      bestEffort,
    }
  }

  private normalizeCronState(value: unknown): CronJob['state'] {
    const row = this.asRecord(value)
    const nextRunAtMs = this.asNumber(row.nextRunAtMs, 0)
    const runningAtMs = this.asNumber(row.runningAtMs, 0)
    const lastRunAtMs = this.asNumber(row.lastRunAtMs, 0)
    const lastDurationMs = this.asNumber(row.lastDurationMs, 0)
    const consecutiveErrors = this.asNumber(row.consecutiveErrors, 0)
    const lastStatusRaw = this.asString(row.lastStatus).trim()
    const lastStatus: 'ok' | 'error' | 'skipped' | undefined =
      lastStatusRaw === 'ok' || lastStatusRaw === 'error' || lastStatusRaw === 'skipped'
        ? lastStatusRaw
        : undefined
    const lastError = this.asString(row.lastError).trim() || undefined

    if (
      !nextRunAtMs &&
      !runningAtMs &&
      !lastRunAtMs &&
      !lastStatus &&
      !lastError &&
      !lastDurationMs &&
      !consecutiveErrors
    ) {
      return undefined
    }

    return {
      nextRunAtMs: nextRunAtMs > 0 ? nextRunAtMs : undefined,
      runningAtMs: runningAtMs > 0 ? runningAtMs : undefined,
      lastRunAtMs: lastRunAtMs > 0 ? lastRunAtMs : undefined,
      lastStatus,
      lastError,
      lastDurationMs: lastDurationMs > 0 ? lastDurationMs : undefined,
      consecutiveErrors: consecutiveErrors > 0 ? consecutiveErrors : undefined,
    }
  }

  private normalizeCronStatus(payload: unknown): CronStatus {
    const row = this.asRecord(payload)
    const enabled = this.asBoolean(row.enabled, true)
    const jobs = this.asNumber(row.jobs || row.jobCount || row.total, 0)
    const running = this.asNumber(row.running || row.runningJobs, 0)
    const nextWakeAtMs = this.asNumber(row.nextWakeAtMs || row.nextWake || row.nextTickAtMs, 0)
    return {
      enabled,
      jobs,
      running: running > 0 ? running : undefined,
      nextWakeAtMs: nextWakeAtMs > 0 ? nextWakeAtMs : undefined,
    }
  }

  private normalizeCronRunItem(value: unknown): CronRunLogEntry {
    const row = this.asRecord(value)
    const statusRaw = this.asString(row.status).trim()
    const status: CronRunLogEntry['status'] =
      statusRaw === 'ok' || statusRaw === 'error' || statusRaw === 'skipped'
        ? statusRaw
        : undefined
    const action = this.asString(row.action).trim() === 'finished' ? 'finished' : undefined

    return {
      ts: this.asNumber(row.ts || row.timestamp || row.time, Date.now()),
      jobId: this.asString(row.jobId || row.id || row.taskId),
      action,
      status,
      error: this.asString(row.error) || undefined,
      summary: this.asString(row.summary || row.message) || undefined,
      sessionId: this.asString(row.sessionId) || undefined,
      sessionKey: this.asString(row.sessionKey || row.key) || undefined,
      runAtMs: this.asNumber(row.runAtMs, 0) || undefined,
      durationMs: this.asNumber(row.durationMs || row.duration, 0) || undefined,
      nextRunAtMs: this.asNumber(row.nextRunAtMs, 0) || undefined,
    }
  }

  private normalizeModelItem(value: unknown): ModelInfo {
    const row = this.asRecord(value)
    const capabilities = Array.isArray(row.capabilities)
      ? row.capabilities.map((cap) => this.asString(cap)).filter(Boolean)
      : undefined
    const contextWindow = this.asNumber(
      row.contextWindow || row.context_length || row.context || row.maxContext,
      0
    )

    return {
      id: this.asString(row.id || row.model || row.name, ''),
      label: this.asString(row.label || row.displayName || row.name || row.model) || undefined,
      provider: this.asString(row.provider || row.vendor) || undefined,
      family: this.asString(row.family || row.type) || undefined,
      enabled: this.asBoolean(row.enabled, true),
      available: this.asBoolean(row.available, this.asBoolean(row.enabled, true)),
      description: this.asString(row.description) || undefined,
      contextWindow: contextWindow > 0 ? contextWindow : undefined,
      capabilities,
    }
  }

  private normalizeUsageTotals(value: unknown): SessionsUsageResult['totals'] {
    const row = this.asRecord(value)
    return {
      input: this.asNumber(row.input, 0),
      output: this.asNumber(row.output, 0),
      cacheRead: this.asNumber(row.cacheRead, 0),
      cacheWrite: this.asNumber(row.cacheWrite, 0),
      totalTokens: this.asNumber(row.totalTokens || row.tokens || row.total, 0),
      totalCost: this.asNumber(row.totalCost || row.cost, 0),
      inputCost: this.asNumber(row.inputCost, 0),
      outputCost: this.asNumber(row.outputCost, 0),
      cacheReadCost: this.asNumber(row.cacheReadCost, 0),
      cacheWriteCost: this.asNumber(row.cacheWriteCost, 0),
      missingCostEntries: this.asNumber(row.missingCostEntries, 0),
    }
  }

  private normalizeSessionsUsageSession(value: unknown): SessionsUsageResult['sessions'][number] {
    const row = this.asRecord(value)
    const usageRow = this.asRecord(row.usage)
    const messageCountsRow = this.asRecord(usageRow.messageCounts)
    const toolUsageRow = this.asRecord(usageRow.toolUsage)
    const toolList = Array.isArray(toolUsageRow.tools)
      ? toolUsageRow.tools.map((tool) => {
          const toolRow = this.asRecord(tool)
          return {
            name: this.asString(toolRow.name || toolRow.tool || toolRow.id, 'unknown'),
            count: this.asNumber(toolRow.count || toolRow.calls, 0),
          }
        })
      : []
    const dailyBreakdown = this.normalizeList<{ date: string; tokens: number; cost: number }>(
      usageRow.dailyBreakdown,
      ['daily', 'days', 'items', 'list', 'data']
    )
      .map((item) => {
        const day = this.asRecord(item)
        return {
          date: this.asString(day.date, ''),
          tokens: this.asNumber(day.tokens, 0),
          cost: this.asNumber(day.cost, 0),
        }
      })
      .filter((item) => !!item.date)

    return {
      key: this.asString(row.key || row.sessionKey || row.id, ''),
      label: this.asString(row.label) || undefined,
      sessionId: this.asString(row.sessionId || row.id) || undefined,
      updatedAt: this.asNumber(row.updatedAt, 0) || undefined,
      agentId: this.asString(row.agentId || row.agent) || undefined,
      channel: this.asString(row.channel) || undefined,
      chatType: this.asString(row.chatType) || undefined,
      modelProvider: this.asString(row.modelProvider || row.providerOverride || row.provider) || undefined,
      model: this.asString(row.model || row.modelOverride) || undefined,
      usage: usageRow && Object.keys(usageRow).length > 0
        ? {
            input: this.asNumber(usageRow.input, 0),
            output: this.asNumber(usageRow.output, 0),
            cacheRead: this.asNumber(usageRow.cacheRead, 0),
            cacheWrite: this.asNumber(usageRow.cacheWrite, 0),
            totalTokens: this.asNumber(usageRow.totalTokens || usageRow.tokens || usageRow.total, 0),
            totalCost: this.asNumber(usageRow.totalCost || usageRow.cost, 0),
            messageCounts: messageCountsRow && Object.keys(messageCountsRow).length > 0
              ? {
                  total: this.asNumber(messageCountsRow.total, 0),
                  user: this.asNumber(messageCountsRow.user, 0),
                  assistant: this.asNumber(messageCountsRow.assistant, 0),
                  toolCalls: this.asNumber(messageCountsRow.toolCalls, 0),
                  toolResults: this.asNumber(messageCountsRow.toolResults, 0),
                  errors: this.asNumber(messageCountsRow.errors, 0),
                }
              : undefined,
            toolUsage: toolUsageRow && Object.keys(toolUsageRow).length > 0
              ? {
                  totalCalls: this.asNumber(toolUsageRow.totalCalls || toolUsageRow.calls, 0),
                  uniqueTools: this.asNumber(toolUsageRow.uniqueTools || toolUsageRow.unique, 0),
                  tools: toolList,
                }
              : undefined,
            dailyBreakdown,
          }
        : null,
    }
  }

  private normalizeSessionsUsageResult(payload: unknown): SessionsUsageResult {
    const row = this.asRecord(payload)
    const sessions = this.normalizeList<unknown>(payload, ['sessions', 'items', 'list', 'data'])
      .map((item) => this.normalizeSessionsUsageSession(item))
      .filter((item) => !!item.key)

    const daily = this.normalizeList<unknown>(row.aggregates ? this.asRecord(row.aggregates).daily : row.daily, ['daily', 'items', 'list', 'data'])
      .map((item) => {
        const day = this.asRecord(item)
        return {
          date: this.asString(day.date, ''),
          tokens: this.asNumber(day.tokens, 0),
          cost: this.asNumber(day.cost, 0),
          messages: this.asNumber(day.messages, 0),
          toolCalls: this.asNumber(day.toolCalls, 0),
          errors: this.asNumber(day.errors, 0),
        }
      })
      .filter((item) => !!item.date)

    const aggregatesRow = this.asRecord(row.aggregates)
    const byModel = this.normalizeList<unknown>(aggregatesRow.byModel, ['byModel', 'items', 'list', 'data'])
      .map((item) => {
        const entry = this.asRecord(item)
        return {
          provider: this.asString(entry.provider) || undefined,
          model: this.asString(entry.model) || undefined,
          count: this.asNumber(entry.count, 0),
          totals: this.normalizeUsageTotals(entry.totals),
        }
      })
      .filter((item) => item.count > 0 || item.totals.totalTokens > 0 || item.totals.totalCost > 0)

    const byProvider = this.normalizeList<unknown>(aggregatesRow.byProvider, ['byProvider', 'items', 'list', 'data'])
      .map((item) => {
        const entry = this.asRecord(item)
        return {
          provider: this.asString(entry.provider) || undefined,
          model: this.asString(entry.model) || undefined,
          count: this.asNumber(entry.count, 0),
          totals: this.normalizeUsageTotals(entry.totals),
        }
      })
      .filter((item) => item.count > 0 || item.totals.totalTokens > 0 || item.totals.totalCost > 0)

    const byAgent = this.normalizeList<unknown>(aggregatesRow.byAgent, ['byAgent', 'items', 'list', 'data'])
      .map((item) => {
        const entry = this.asRecord(item)
        return {
          agentId: this.asString(entry.agentId || entry.agent, ''),
          totals: this.normalizeUsageTotals(entry.totals),
        }
      })
      .filter((item) => !!item.agentId)

    const byChannel = this.normalizeList<unknown>(aggregatesRow.byChannel, ['byChannel', 'items', 'list', 'data'])
      .map((item) => {
        const entry = this.asRecord(item)
        return {
          channel: this.asString(entry.channel, ''),
          totals: this.normalizeUsageTotals(entry.totals),
        }
      })
      .filter((item) => !!item.channel)

    const messagesRow = this.asRecord(aggregatesRow.messages)
    const toolsRow = this.asRecord(aggregatesRow.tools)
    const toolItems = Array.isArray(toolsRow.tools)
      ? toolsRow.tools.map((tool) => {
          const toolRow = this.asRecord(tool)
          return {
            name: this.asString(toolRow.name || toolRow.tool || toolRow.id, 'unknown'),
            count: this.asNumber(toolRow.count || toolRow.calls, 0),
          }
        })
      : []

    return {
      updatedAt: this.asNumber(row.updatedAt, Date.now()),
      startDate: this.asString(row.startDate, ''),
      endDate: this.asString(row.endDate, ''),
      sessions,
      totals: this.normalizeUsageTotals(row.totals),
      aggregates: {
        messages: {
          total: this.asNumber(messagesRow.total, 0),
          user: this.asNumber(messagesRow.user, 0),
          assistant: this.asNumber(messagesRow.assistant, 0),
          toolCalls: this.asNumber(messagesRow.toolCalls, 0),
          toolResults: this.asNumber(messagesRow.toolResults, 0),
          errors: this.asNumber(messagesRow.errors, 0),
        },
        tools: {
          totalCalls: this.asNumber(toolsRow.totalCalls || toolsRow.calls, 0),
          uniqueTools: this.asNumber(toolsRow.uniqueTools || toolsRow.unique, 0),
          tools: toolItems,
        },
        byModel,
        byProvider,
        byAgent,
        byChannel,
        daily,
      },
    }
  }

  private normalizeCostUsageSummary(payload: unknown): CostUsageSummary {
    const row = this.asRecord(payload)
    const daily = this.normalizeList<unknown>(payload, ['daily', 'items', 'list', 'data'])
      .map((item) => {
        const entry = this.asRecord(item)
        return {
          date: this.asString(entry.date, ''),
          ...this.normalizeUsageTotals(entry),
        }
      })
      .filter((item) => !!item.date)

    return {
      updatedAt: this.asNumber(row.updatedAt, Date.now()),
      days: this.asNumber(row.days, daily.length),
      totals: this.normalizeUsageTotals(row.totals),
      daily,
    }
  }

  private normalizeStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined
    const list = value
      .map((item) => this.asString(item).trim())
      .filter(Boolean)
    return list.length > 0 ? list : undefined
  }

  private normalizePresenceEntry(value: unknown): SystemPresenceEntry {
    const row = this.asRecord(value)
    const tsNumber = this.asNumber(row.ts, Number.NaN)
    const lastInputSeconds = this.asNumber(row.lastInputSeconds, Number.NaN)
    return {
      instanceId: this.asString(row.instanceId || row.id) || undefined,
      host: this.asString(row.host) || undefined,
      ip: this.asString(row.ip) || undefined,
      version: this.asString(row.version) || undefined,
      platform: this.asString(row.platform) || undefined,
      deviceFamily: this.asString(row.deviceFamily) || undefined,
      modelIdentifier: this.asString(row.modelIdentifier) || undefined,
      mode: this.asString(row.mode) || undefined,
      reason: this.asString(row.reason) || undefined,
      text: this.asString(row.text) || undefined,
      deviceId: this.asString(row.deviceId) || undefined,
      roles: this.normalizeStringArray(row.roles) || undefined,
      scopes: this.normalizeStringArray(row.scopes) || undefined,
      tags: this.normalizeStringArray(row.tags) || undefined,
      ts: Number.isFinite(tsNumber) && tsNumber >= 0 ? Math.floor(tsNumber) : undefined,
      lastInputSeconds: Number.isFinite(lastInputSeconds) && lastInputSeconds >= 0
        ? Math.floor(lastInputSeconds)
        : undefined,
    }
  }

  private normalizeLogsTailResult(payload: unknown): LogsTailResult {
    const row = this.asRecord(payload)
    const cursor = this.asNumber(row.cursor, 0)
    const size = this.asNumber(row.size, 0)
    const file = this.asString(row.file, '')
    const lines = Array.isArray(row.lines)
      ? row.lines
          .map((line) => this.asString(line))
          .filter((line) => typeof line === 'string')
      : []
    return {
      file,
      cursor: Number.isFinite(cursor) && cursor >= 0 ? Math.floor(cursor) : 0,
      size: Number.isFinite(size) && size >= 0 ? Math.floor(size) : 0,
      lines,
      truncated: 'truncated' in row ? this.asBoolean(row.truncated, false) : undefined,
      reset: 'reset' in row ? this.asBoolean(row.reset, false) : undefined,
    }
  }

  private normalizeExecApprovalsFile(value: unknown): ExecApprovalsFile {
    const normalizeSecurity = (input: unknown): ExecApprovalsDefaults['security'] | undefined => {
      const value = this.asString(input).trim()
      if (value === 'deny' || value === 'allowlist' || value === 'full') {
        return value
      }
      return undefined
    }

    const normalizeAsk = (input: unknown): ExecApprovalsDefaults['ask'] | undefined => {
      const value = this.asString(input).trim()
      if (value === 'off' || value === 'on-miss' || value === 'always') {
        return value
      }
      return undefined
    }

    const row = this.asRecord(value)
    const defaultsRaw = this.asRecord(row.defaults)
    const socketRaw = this.asRecord(row.socket)
    const agentsRaw = this.asRecord(row.agents)
    const agents: Record<string, ExecApprovalsAgent> = {}

    for (const [agentId, agentRaw] of Object.entries(agentsRaw)) {
      const agentRow = this.asRecord(agentRaw)
      const allowlistRaw = Array.isArray(agentRow.allowlist) ? agentRow.allowlist : []
      const allowlist = allowlistRaw
        .map((entryRaw) => {
          const entry = this.asRecord(entryRaw)
          const pattern = this.asString(entry.pattern).trim()
          if (!pattern) return null
          const lastUsedAt = this.asNumber(entry.lastUsedAt, Number.NaN)
          return {
            id: this.asString(entry.id) || undefined,
            pattern,
            lastUsedAt: Number.isFinite(lastUsedAt) && lastUsedAt >= 0 ? Math.floor(lastUsedAt) : undefined,
            lastUsedCommand: this.asString(entry.lastUsedCommand) || undefined,
            lastResolvedPath: this.asString(entry.lastResolvedPath) || undefined,
          }
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

      agents[agentId] = {
        security: normalizeSecurity(agentRow.security),
        ask: normalizeAsk(agentRow.ask),
        askFallback: normalizeSecurity(agentRow.askFallback),
        autoAllowSkills: 'autoAllowSkills' in agentRow
          ? this.asBoolean(agentRow.autoAllowSkills, false)
          : undefined,
        allowlist: allowlist.length > 0 ? allowlist : undefined,
      }
    }

    return {
      version: 1,
      socket: {
        path: this.asString(socketRaw.path) || undefined,
        token: this.asString(socketRaw.token) || undefined,
      },
      defaults: {
        security: normalizeSecurity(defaultsRaw.security),
        ask: normalizeAsk(defaultsRaw.ask),
        askFallback: normalizeSecurity(defaultsRaw.askFallback),
        autoAllowSkills: 'autoAllowSkills' in defaultsRaw
          ? this.asBoolean(defaultsRaw.autoAllowSkills, false)
          : undefined,
      },
      agents: Object.keys(agents).length > 0 ? agents : undefined,
    }
  }

  private normalizeExecApprovalsSnapshot(payload: unknown): ExecApprovalsSnapshot {
    const row = this.asRecord(payload)
    return {
      path: this.asString(row.path),
      exists: this.asBoolean(row.exists, false),
      hash: this.asString(row.hash),
      file: this.normalizeExecApprovalsFile(row.file),
    }
  }

  private normalizeUpdateRunResult(payload: unknown): UpdateRunResult {
    const row = this.asRecord(payload)
    const statusRaw = this.asString(row.status, 'error')
    const modeRaw = this.asString(row.mode, 'unknown')
    const durationMs = this.asNumber(row.durationMs, 0)
    const steps = Array.isArray(row.steps)
      ? row.steps.map((stepRaw) => {
          const step = this.asRecord(stepRaw)
          const stepDurationMs = this.asNumber(step.durationMs, Number.NaN)
          const exitCode = this.asNumber(step.exitCode, Number.NaN)
          return {
            name: this.asString(step.name, 'step'),
            command: this.asString(step.command, ''),
            cwd: this.asString(step.cwd) || undefined,
            durationMs: Number.isFinite(stepDurationMs) ? Math.floor(stepDurationMs) : undefined,
            exitCode: Number.isFinite(exitCode) ? Math.floor(exitCode) : null,
            stdoutTail: this.asString(step.stdoutTail) || null,
            stderrTail: this.asString(step.stderrTail) || null,
          }
        })
      : []

    return {
      status: statusRaw === 'ok' || statusRaw === 'skipped' ? statusRaw : 'error',
      mode: modeRaw === 'git' || modeRaw === 'pnpm' || modeRaw === 'bun' || modeRaw === 'npm'
        ? modeRaw
        : 'unknown',
      root: this.asString(row.root) || undefined,
      reason: this.asString(row.reason) || undefined,
      before: Object.keys(this.asRecord(row.before)).length > 0 ? {
        sha: this.asString(this.asRecord(row.before).sha) || null,
        version: this.asString(this.asRecord(row.before).version) || null,
      } : null,
      after: Object.keys(this.asRecord(row.after)).length > 0 ? {
        sha: this.asString(this.asRecord(row.after).sha) || null,
        version: this.asString(this.asRecord(row.after).version) || null,
      } : null,
      steps,
      durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs)) : 0,
    }
  }

  private normalizeUpdateRunResponse(payload: unknown): UpdateRunResponse {
    const row = this.asRecord(payload)
    const restartRow = this.asRecord(row.restart)
    const sentinelRow = this.asRecord(row.sentinel)
    return {
      ok: this.asBoolean(row.ok, true),
      result: row.result ? this.normalizeUpdateRunResult(row.result) : undefined,
      restart: Object.keys(restartRow).length > 0
        ? {
            ok: 'ok' in restartRow ? this.asBoolean(restartRow.ok, false) : undefined,
            delayMs: 'delayMs' in restartRow ? this.asNumber(restartRow.delayMs, 0) : undefined,
            pid: 'pid' in restartRow ? this.asNumber(restartRow.pid, 0) : undefined,
            reason: this.asString(restartRow.reason) || undefined,
            error: this.asString(restartRow.error) || undefined,
          }
        : null,
      sentinel: Object.keys(sentinelRow).length > 0
        ? {
            path: this.asString(sentinelRow.path) || null,
            payload: (sentinelRow.payload && typeof sentinelRow.payload === 'object')
              ? (sentinelRow.payload as Record<string, unknown>)
              : null,
          }
        : null,
    }
  }

  private looksLikeConfigRoot(value: unknown): value is OpenClawConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const row = value as Record<string, unknown>
    const keys = [
      'agents',
      'channels',
      'bindings',
      'tools',
      'session',
      'gateway',
      'models',
    ]
    return keys.some((key) => key in row)
  }

  private normalizeConfigPayload(payload: unknown): OpenClawConfig {
    if (this.looksLikeConfigRoot(payload)) {
      return payload
    }

    const row = this.asRecord(payload)
    const candidates = [row.config, row.data, row.value, row.payload, row.result]
    for (const candidate of candidates) {
      if (this.looksLikeConfigRoot(candidate)) {
        return candidate
      }
    }

    return row as OpenClawConfig
  }

  private cloneJsonValue<T>(value: T): T {
    if (value === undefined) return value
    return JSON.parse(JSON.stringify(value)) as T
  }

  private splitConfigPatchPath(path: string): string[] {
    return path
      .split('.')
      .map((segment) => segment.trim())
      .filter(Boolean)
  }

  private setMergePatchValue(
    target: Record<string, unknown>,
    pathSegments: string[],
    value: unknown
  ): void {
    if (pathSegments.length === 0) return

    let cursor = target
    for (let index = 0; index < pathSegments.length - 1; index += 1) {
      const key = pathSegments[index]
      if (!key) continue
      const current = cursor[key]
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        cursor[key] = {}
      }
      cursor = cursor[key] as Record<string, unknown>
    }

    const leafKey = pathSegments[pathSegments.length - 1]
    if (!leafKey) return
    cursor[leafKey] = value === undefined ? null : this.cloneJsonValue(value)
  }

  private buildConfigPatchRaw(patches: ConfigPatch[]): string {
    const payload: Record<string, unknown> = {}
    for (const patch of patches) {
      const path = this.asString(patch.path).trim()
      if (!path) continue
      const segments = this.splitConfigPatchPath(path)
      this.setMergePatchValue(payload, segments, patch.value)
    }
    return JSON.stringify(payload)
  }

  private resolveConfigSnapshotMeta(payload: unknown): {
    exists: boolean
    hash: string | null
    raw: string | null
  } {
    const row = this.asRecord(payload)
    const candidates = [row, this.asRecord(row.payload), this.asRecord(row.data), this.asRecord(row.result)]

    let exists = true
    let hash: string | null = null
    let raw: string | null = null

    for (const candidate of candidates) {
      if ('exists' in candidate) {
        exists = this.asBoolean(candidate.exists, exists)
      }

      const candidateHash = this.asString(candidate.hash).trim()
      if (candidateHash) {
        hash = candidateHash
      }

      const candidateRaw = typeof candidate.raw === 'string' ? candidate.raw : ''
      if (candidateRaw.trim()) {
        raw = candidateRaw
      }

      if (hash) {
        break
      }
    }

    return {
      exists,
      hash,
      raw,
    }
  }

  private async hashTextSha256(text: string): Promise<string | null> {
    if (!text.trim()) return null

    const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
    if (!cryptoApi?.subtle || typeof TextEncoder === 'undefined') {
      return null
    }

    try {
      const bytes = new TextEncoder().encode(text)
      const digest = await cryptoApi.subtle.digest('SHA-256', bytes)
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
    } catch {
      return null
    }
  }

  private shouldFallbackToLegacyConfigPatch(message: string): boolean {
    const normalized = message.toLowerCase()
    if (!normalized.includes('config.patch')) return false

    return (
      normalized.includes("required property 'patches'") ||
      normalized.includes('required property "patches"') ||
      normalized.includes("unexpected property 'raw'") ||
      normalized.includes('unexpected property "raw"') ||
      normalized.includes('must not have additional properties')
    )
  }

  private normalizeChatHistoryPayload(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload
    if (!payload || typeof payload !== 'object') return []

    const candidateArrayKeys = [
      'messages',
      'history',
      'transcript',
      'items',
      'list',
      'data',
      'events',
      'turns',
    ]
    const queue: unknown[] = [payload]
    const visited = new Set<unknown>()

    while (queue.length > 0) {
      const current = queue.shift()
      if (!current || typeof current !== 'object') continue
      if (visited.has(current)) continue
      visited.add(current)

      if (Array.isArray(current)) {
        return current
      }

      const record = current as Record<string, unknown>
      for (const key of candidateArrayKeys) {
        const value = record[key]
        if (Array.isArray(value)) {
          return value
        }
      }

      for (const value of Object.values(record)) {
        if (value && typeof value === 'object') {
          queue.push(value)
        }
      }
    }

    return this.normalizeList<unknown>(payload, candidateArrayKeys)
  }

  private shouldFallbackOnError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return (
      /unknown method/i.test(message) ||
      /method not found/i.test(message) ||
      /invalid params/i.test(message) ||
      /missing required property/i.test(message) ||
      /must have required property/i.test(message) ||
      /unexpected property/i.test(message) ||
      /must match a schema/i.test(message) ||
      /must be equal to constant/i.test(message)
    )
  }

  private async callWithFallback<T>(
    methods: string[],
    params?: Record<string, unknown>,
    timeout = 0
  ): Promise<T> {
    let lastError: unknown
    for (const method of methods) {
      try {
        return await this.call<T>(method, params, timeout)
      } catch (error) {
        lastError = error
        if (!this.shouldFallbackOnError(error)) {
          throw error
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('RPC call failed')
  }

  private async callWithMethodAndParamsFallback<T>(
    methods: string[],
    paramsList: Array<Record<string, unknown> | undefined>,
    timeout = 0
  ): Promise<T> {
    let lastError: unknown
    for (const params of paramsList) {
      try {
        return await this.callWithFallback<T>(methods, params, timeout)
      } catch (error) {
        lastError = error
        if (!this.shouldFallbackOnError(error)) {
          throw error
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('RPC call failed')
  }

  private normalizeList<T>(payload: unknown, candidateKeys: string[]): T[] {
    if (Array.isArray(payload)) {
      return payload as T[]
    }
    if (!payload || typeof payload !== 'object') {
      return []
    }

    const record = payload as Record<string, unknown>
    for (const key of candidateKeys) {
      const value = record[key]
      if (Array.isArray(value)) {
        return value as T[]
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const entries = Object.entries(value as Record<string, unknown>)
        if (
          entries.length > 0 &&
          entries.every(([, item]) => item && typeof item === 'object' && !Array.isArray(item))
        ) {
          return entries.map(([id, item]) =>
            ({ id, ...(item as Record<string, unknown>) } as unknown as T)
          )
        }
      }
    }

    const entries = Object.entries(record)
    if (
      entries.length > 0 &&
      entries.every(([, item]) => item && typeof item === 'object' && !Array.isArray(item))
    ) {
      return entries.map(([id, item]) => ({ id, ...(item as Record<string, unknown>) } as unknown as T))
    }

    return []
  }

  private call<T>(method: string, params?: Record<string, unknown>, timeout = 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = nextId()
      let timer: ReturnType<typeof setTimeout> | null = null
      let settled = false

      const cleanup = this.ws.on(`rpc:${id}`, (response: unknown) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        cleanup()
        const res = response as RPCResponse<T>
        if (res.ok) {
          resolve(res.payload as T)
        } else {
          reject(new Error(res.error?.message ?? 'RPC call failed'))
        }
      })

      if (timeout > 0) {
        timer = setTimeout(() => {
          if (settled) return
          settled = true
          cleanup()
          reject(new Error(`RPC call "${method}" timed out after ${timeout}ms`))
        }, timeout)
      }

      this.ws.send({ type: 'req', id, method, params }).catch((err) => {
        if (settled) return
        settled = true
        if (timer !== null) clearTimeout(timer)
        cleanup()
        reject(err)
      })
    })
  }

  // --- Config ---
  getConfig(): Promise<OpenClawConfig> {
    return this.call<unknown>('config.get').then((payload) => this.normalizeConfigPayload(payload))
  }

  async patchConfig(patches: ConfigPatch[]): Promise<void> {
    const normalized = patches
      .map((item) => ({
        path: this.asString(item.path).trim(),
        value: item.value,
      }))
      .filter((item) => !!item.path)

    if (normalized.length === 0) {
      return
    }

    const snapshotPayload = await this.call<unknown>('config.get', {})
    const snapshotMeta = this.resolveConfigSnapshotMeta(snapshotPayload)
    let baseHash = snapshotMeta.hash
    if (!baseHash && snapshotMeta.raw) {
      baseHash = await this.hashTextSha256(snapshotMeta.raw)
    }

    const params: Record<string, unknown> = {
      raw: this.buildConfigPatchRaw(normalized),
    }

    if (snapshotMeta.exists && baseHash) {
      params.baseHash = baseHash
    }

    try {
      await this.call('config.patch', params)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (this.shouldFallbackToLegacyConfigPatch(reason)) {
        await this.call('config.patch', { patches: normalized })
        return
      }
      throw error
    }
  }

  applyConfig(): Promise<void> {
    return this.call('config.apply')
  }

  async setConfig(config: OpenClawConfig): Promise<void> {
    const snapshotPayload = await this.call<unknown>('config.get', {})
    const snapshotMeta = this.resolveConfigSnapshotMeta(snapshotPayload)
    let baseHash = snapshotMeta.hash
    if (!baseHash && snapshotMeta.raw) {
      baseHash = await this.hashTextSha256(snapshotMeta.raw)
    }

    const params: Record<string, unknown> = {
      raw: JSON.stringify(config, null, 2),
    }

    if (snapshotMeta.exists && baseHash) {
      params.baseHash = baseHash
    }

    await this.call('config.set', params)
  }

  // --- Sessions ---
  listSessions(): Promise<Session[]> {
    return this.callWithFallback<unknown>(['sessions.list', 'session.list']).then((payload) =>
      this.normalizeList<unknown>(payload, ['sessions', 'items', 'list', 'data'])
        .map((item) => this.normalizeSessionItem(item))
        .filter((item) => !!item.key)
    )
  }

  getSession(key: string): Promise<SessionDetail> {
    return this.callWithFallback(['sessions.get', 'session.get'], { key })
  }

  resetSession(key: string): Promise<void> {
    return this.callWithMethodAndParamsFallback(
      ['sessions.reset', 'session.reset'],
      [{ key, reason: 'reset' }, { key }]
    )
  }

  newSession(key: string): Promise<void> {
    return this.callWithMethodAndParamsFallback(
      ['sessions.reset', 'session.reset'],
      [{ key, reason: 'new' }, { key }]
    )
  }

  deleteSession(key: string): Promise<void> {
    return this.callWithFallback(['sessions.delete', 'session.delete'], { key })
  }

  spawnSession(params: {
    agentId?: string
    channel?: string
    peer?: string
    label?: string
    initialMessage?: string
    mode?: string
    thread?: boolean
    timeoutSeconds?: number
  }): Promise<{ sessionKey: string }> {
    const normalized: Record<string, unknown> = {}
    if (params.agentId) normalized.agentId = params.agentId
    if (params.channel) normalized.channel = params.channel
    if (params.peer) normalized.peer = params.peer
    if (params.label) normalized.label = params.label
    if (params.initialMessage) normalized.initialMessage = params.initialMessage
    if (params.mode) normalized.mode = params.mode
    if (params.thread !== undefined) normalized.thread = params.thread
    if (params.timeoutSeconds !== undefined) normalized.timeoutSeconds = params.timeoutSeconds

    return this.callWithFallback<{ sessionKey?: string; key?: string }>(
      ['sessions.spawn', 'session.spawn'],
      normalized
    ).then((result) => {
      const sessionKey = result?.sessionKey || result?.key
      if (!sessionKey) {
        const agentId = params.agentId || 'main'
        const channel = params.channel || 'main'
        const peer = params.peer || `webchat-${Date.now()}`
        return { sessionKey: `agent:${agentId}:${channel}:dm:${peer}` }
      }
      return { sessionKey }
    })
  }

  sendToSession(sessionKey: string, message: string): Promise<void> {
    return this.callWithFallback(
      ['sessions.send', 'session.send'],
      { sessionKey, message }
    )
  }

  getSessionHistory(sessionKey: string, limit?: number): Promise<unknown[]> {
    const params: Record<string, unknown> = { sessionKey }
    if (limit !== undefined && limit > 0) {
      params.limit = limit
    }

    return this.callWithFallback<unknown>(
      ['sessions.history', 'session.history'],
      params
    ).then((result) => {
      if (Array.isArray(result)) {
        return result
      }

      if (result && typeof result === 'object') {
        const record = result as Record<string, unknown>
        const candidates = ['messages', 'history', 'items', 'list', 'data']
        for (const key of candidates) {
          if (Array.isArray(record[key])) {
            return record[key] as unknown[]
          }
        }
      }

      return []
    })
  }

  patchSession(params: {
    sessionKey: string
    label?: string
    model?: string
    thinkingLevel?: string
    sendPolicy?: string
    elevated?: boolean
  }): Promise<void> {
    const normalized: Record<string, unknown> = {
      key: params.sessionKey,
    }

    if (params.label !== undefined) normalized.label = params.label
    if (params.model !== undefined) normalized.model = params.model
    if (params.thinkingLevel !== undefined) normalized.thinkingLevel = params.thinkingLevel
    if (params.sendPolicy !== undefined) normalized.sendPolicy = params.sendPolicy
    if (params.elevated !== undefined) normalized.elevated = params.elevated

    return this.call('sessions.patch', normalized)
  }

  exportSession(key: string): Promise<SessionExport> {
    return this.callWithFallback(['sessions.export', 'session.export'], { key })
  }

  getSessionsUsage(params?: SessionsUsageParams): Promise<SessionsUsageResult> {
    const normalized: Record<string, unknown> = {}
    if (params?.key?.trim()) normalized.key = params.key.trim()
    if (params?.startDate?.trim()) normalized.startDate = params.startDate.trim()
    if (params?.endDate?.trim()) normalized.endDate = params.endDate.trim()
    if (typeof params?.limit === 'number' && Number.isFinite(params.limit) && params.limit > 0) {
      normalized.limit = Math.floor(params.limit)
    }
    if (typeof params?.includeContextWeight === 'boolean') {
      normalized.includeContextWeight = params.includeContextWeight
    }

    return this.callWithMethodAndParamsFallback<unknown>(
      ['sessions.usage', 'usage.sessions'],
      [normalized, {}],
      60000
    ).then((payload) => this.normalizeSessionsUsageResult(payload))
  }

  getUsageCost(params?: { startDate?: string; endDate?: string; days?: number }): Promise<CostUsageSummary> {
    const normalized: Record<string, unknown> = {}
    if (params?.startDate?.trim()) normalized.startDate = params.startDate.trim()
    if (params?.endDate?.trim()) normalized.endDate = params.endDate.trim()
    if (typeof params?.days === 'number' && Number.isFinite(params.days) && params.days > 0) {
      normalized.days = Math.floor(params.days)
    }

    return this.callWithMethodAndParamsFallback<unknown>(
      ['usage.cost', 'cost.usage'],
      [normalized, {}],
      45000
    ).then((payload) => this.normalizeCostUsageSummary(payload))
  }

  // --- Channels ---
  listChannels(): Promise<Channel[]> {
    return this.callWithFallback<unknown>(['channels.status', 'channels.list', 'channel.list']).then((payload) => {
      const statusSnapshot = this.normalizeChannelsStatusPayload(payload)
      if (statusSnapshot.length > 0) {
        return statusSnapshot.filter((item) => !!item.id)
      }

      return this.normalizeList<unknown>(payload, ['channels', 'items', 'list', 'data', 'status'])
        .map((item) => this.normalizeChannelItem(item))
        .filter((item) => !!item.id)
    })
  }

  authChannel(params: ChannelAuthParams): Promise<unknown> {
    const rawParams = params as unknown as Record<string, unknown>
    return this.callWithFallback(['channel.auth', 'channels.auth', 'web.login.start'], rawParams)
  }

  pairChannel(params: PairParams): Promise<void> {
    return this.callWithFallback(
      ['channel.pair', 'channels.pair'],
      params as unknown as Record<string, unknown>
    )
  }

  getChannelStatus(channelId: string): Promise<ChannelStatus> {
    return this.callWithFallback(['channel.status', 'channels.status'], { channelId })
  }

  // --- Plugins ---
  listPlugins(): Promise<PluginPackage[]> {
    return this.callWithMethodAndParamsFallback<unknown>(
      ['plugins.list', 'plugin.list', 'plugins.status', 'plugin.status'],
      [{}, undefined]
    ).then((payload) => this.normalizePluginList(payload))
  }

  installPlugin(name: string): Promise<void> {
    return this.callWithMethodAndParamsFallback(
      ['plugins.install', 'plugin.install'],
      [
        { name },
        { package: name },
        { plugin: name },
        { id: name },
      ],
      180000
    )
  }

  // --- Skills ---
  listSkills(): Promise<Skill[]> {
    return this.callWithFallback<unknown>(['skills.status', 'skills.list'], {}).then((payload) =>
      this.normalizeList<unknown>(payload, ['skills', 'items', 'list', 'data', 'entries'])
        .map((item) => this.normalizeSkillItem(item))
        .filter((item) => !!item.name)
    )
  }

  installSkill(name: string): Promise<void> {
    return this.callWithFallback(['skills.install'], { name })
  }

  updateSkills(): Promise<void> {
    return this.callWithFallback(['skills.update'])
  }

  // --- Tools ---
  listTools(): Promise<Tool[]> {
    return this.callWithFallback<unknown>(['tools.list']).then((payload) =>
      this.normalizeList<unknown>(payload, ['tools', 'items', 'list', 'data'])
        .map((item) => this.normalizeToolItem(item))
        .filter((item) => !!item.name)
    )
  }

  // --- Nodes ---
  listNodes(): Promise<DeviceNode[]> {
    return this.callWithFallback<unknown>(['node.list']).then((payload) =>
      this.normalizeList<unknown>(payload, ['nodes', 'items', 'list', 'data'])
        .map((item) => this.normalizeNodeItem(item))
        .filter((item) => !!item.id)
    )
  }

  invokeNode(params: NodeInvokeParams): Promise<unknown> {
    return this.call('node.invoke', params as unknown as Record<string, unknown>)
  }

  requestNodePairing(nodeId: string): Promise<void> {
    return this.call('node.pair.request', { nodeId })
  }

  approveNodePairing(nodeId: string, code: string): Promise<void> {
    return this.call('node.pair.approve', { nodeId, code })
  }

  // --- Ops ---
  getHealth(params?: { probe?: boolean }): Promise<HealthSummary> {
    const payload: Record<string, unknown> = {}
    if (params?.probe === true) {
      payload.probe = true
    }

    return this.callWithMethodAndParamsFallback<HealthSummary>(
      ['health'],
      [payload, {}, undefined],
      params?.probe ? 60000 : 30000
    )
  }

  getStatus(): Promise<StatusSummary> {
    return this.callWithMethodAndParamsFallback<StatusSummary>(
      ['status'],
      [{}, undefined],
      30000
    )
  }

  getSystemPresence(): Promise<SystemPresenceEntry[]> {
    return this.callWithMethodAndParamsFallback<unknown>(
      ['system-presence'],
      [{}, undefined]
    ).then((payload) => {
      const entries = Array.isArray(payload)
        ? payload
        : this.normalizeList<unknown>(payload, ['presence', 'items', 'list', 'data'])
      return entries
        .map((item) => this.normalizePresenceEntry(item))
        .filter((item) => !!item.host || !!item.instanceId || !!item.deviceId)
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    })
  }

  tailLogs(params?: LogsTailParams): Promise<LogsTailResult> {
    const normalized: Record<string, unknown> = {}
    if (typeof params?.cursor === 'number' && Number.isFinite(params.cursor) && params.cursor >= 0) {
      normalized.cursor = Math.floor(params.cursor)
    }
    if (typeof params?.limit === 'number' && Number.isFinite(params.limit) && params.limit > 0) {
      normalized.limit = Math.floor(params.limit)
    }
    if (typeof params?.maxBytes === 'number' && Number.isFinite(params.maxBytes) && params.maxBytes > 0) {
      normalized.maxBytes = Math.floor(params.maxBytes)
    }

    return this.callWithMethodAndParamsFallback<unknown>(
      ['logs.tail'],
      [normalized, {}]
    ).then((payload) => this.normalizeLogsTailResult(payload))
  }

  getExecApprovals(target?: { nodeId?: string }): Promise<ExecApprovalsSnapshot> {
    const nodeId = target?.nodeId?.trim()
    if (nodeId) {
      return this.callWithFallback<unknown>(['exec.approvals.node.get'], { nodeId })
        .then((payload) => this.normalizeExecApprovalsSnapshot(payload))
    }
    return this.callWithFallback<unknown>(['exec.approvals.get'], {})
      .then((payload) => this.normalizeExecApprovalsSnapshot(payload))
  }

  setExecApprovals(params: {
    file: ExecApprovalsFile
    baseHash: string
    nodeId?: string
  }): Promise<ExecApprovalsSnapshot> {
    const nodeId = params.nodeId?.trim()
    const payload = {
      file: this.normalizeExecApprovalsFile(params.file),
      baseHash: params.baseHash,
    }

    if (nodeId) {
      return this.callWithFallback<unknown>(
        ['exec.approvals.node.set'],
        { nodeId, ...payload }
      ).then((res) => this.normalizeExecApprovalsSnapshot(res))
    }

    return this.callWithFallback<unknown>(
      ['exec.approvals.set'],
      payload
    ).then((res) => this.normalizeExecApprovalsSnapshot(res))
  }

  runUpdate(params?: {
    sessionKey?: string
    note?: string
    restartDelayMs?: number
    timeoutMs?: number
    version?: string
  }): Promise<UpdateRunResponse> {
    const payload: Record<string, unknown> = {}
    if (params?.sessionKey?.trim()) payload.sessionKey = params.sessionKey.trim()
    if (params?.note?.trim()) payload.note = params.note.trim()
    if (
      typeof params?.restartDelayMs === 'number' &&
      Number.isFinite(params.restartDelayMs) &&
      params.restartDelayMs >= 0
    ) {
      payload.restartDelayMs = Math.floor(params.restartDelayMs)
    }
    if (
      typeof params?.timeoutMs === 'number' &&
      Number.isFinite(params.timeoutMs) &&
      params.timeoutMs >= 1000
    ) {
      payload.timeoutMs = Math.floor(params.timeoutMs)
    }
    if (params?.version?.trim()) payload.version = params.version.trim()

    return this.callWithMethodAndParamsFallback<unknown>(
      ['update.run'],
      [payload, {}],
      (params?.timeoutMs && Number.isFinite(params.timeoutMs))
        ? Math.max(5000, Math.floor(params.timeoutMs) + 15000)
        : 240000
    ).then((res) => this.normalizeUpdateRunResponse(res))
  }

  // --- Agents ---
  async listAgents(): Promise<AgentsListResult> {
    const config = await this.getConfig()
    const configured = Array.isArray(config.agents?.list) ? config.agents.list : []
    
    try {
      const payload = await this.callWithFallback<unknown>(['agents.list', 'agent.list'], {})
      const result = this.normalizeAgentsListResult(payload)
      
      if (result.agents.length > 0) {
        const mergedAgents = result.agents.map((agent) => {
          const configuredAgent = configured.find((a) => a.id === agent.id)
          const modelValue = configuredAgent?.model
          let model: string | undefined
          if (modelValue) {
            if (typeof modelValue === 'string') {
              model = this.asString(modelValue)
            } else if (typeof modelValue === 'object' && modelValue !== null && 'primary' in modelValue) {
              model = this.asString(modelValue.primary)
            }
          }
          return {
            ...agent,
            name: this.asString((configuredAgent as Record<string, unknown> | undefined)?.name) || agent.name,
            model: model || agent.model,
            tools: configuredAgent?.tools,
          }
        })
        return {
          ...result,
          agents: mergedAgents,
        }
      }
      throw new Error('agents list is empty')
    } catch (error) {
      if (!this.shouldFallbackOnError(error)) {
        throw error
      }
      const ids = Array.from(
        new Set(
          ['main', ...configured.map((item) => this.asString((item as unknown as Record<string, unknown>)?.id)).filter(Boolean)]
        )
      )
      const agents = ids.map((id) => {
        const configuredAgent = configured.find((a) => a.id === id)
        const modelValue = configuredAgent?.model
        let model: string | undefined
        if (modelValue) {
          if (typeof modelValue === 'string') {
            model = this.asString(modelValue)
          } else if (typeof modelValue === 'object' && modelValue !== null && 'primary' in modelValue) {
            model = this.asString(modelValue.primary)
          }
        }
        return {
          id,
          name: this.asString((configuredAgent as Record<string, unknown> | undefined)?.name),
          identity: configuredAgent?.identity,
          model,
          tools: configuredAgent?.tools,
        }
      })
      return {
        defaultId: 'main',
        mainKey: 'main',
        agents,
      }
    }
  }

  createAgent(params: { name: string; workspace: string }): Promise<{ agentId: string; name: string; workspace: string }> {
    return this.call('agents.create', {
      name: params.name,
      workspace: params.workspace,
    })
  }

  updateAgent(params: {
    agentId: string
    workspace?: string
    model?: string
    name?: string
    subagents?: {
      allowAgents?: string[]
      denyAgents?: string[]
    }
    tools?: {
      allow?: string[]
      deny?: string[]
    }
    identity?: {
      name?: string
      emoji?: string
    }
  }): Promise<{ agentId: string }> {
    const payload: Record<string, unknown> = {
      agentId: params.agentId,
    }
    if (params.workspace !== undefined) payload.workspace = params.workspace
    if (params.model !== undefined) payload.model = params.model
    if (params.name !== undefined) payload.name = params.name
    if (params.subagents !== undefined) payload.subagents = params.subagents
    if (params.tools !== undefined) payload.tools = params.tools
    if (params.identity !== undefined) payload.identity = params.identity
    return this.call('agents.update', payload)
  }

  deleteAgent(agentId: string): Promise<{ agentId: string; removedBindings: number }> {
    return this.call('agents.delete', { agentId })
  }

  listAgentFiles(agentId: string): Promise<AgentFilesListResult> {
    return this.callWithMethodAndParamsFallback<unknown>(
      ['agents.files.list', 'agent.files.list'],
      [{ agentId }, { id: agentId }, { agent: agentId }]
    ).then((payload) => {
      const row = this.asRecord(payload)
      const files = this.normalizeList<unknown>(payload, ['files', 'items', 'list', 'data'])
        .map((item) => this.normalizeAgentFileEntry(item))
        .filter((item) => !!item.name)
      return {
        agentId: this.asString(row.agentId || row.id, agentId),
        workspace: this.asString(row.workspace || row.dir || row.path),
        files,
      }
    })
  }

  getAgentFile(agentId: string, name: string): Promise<AgentFilesGetResult> {
    return this.callWithMethodAndParamsFallback<unknown>(
      ['agents.files.get', 'agent.files.get'],
      [{ agentId, name }, { id: agentId, name }, { agent: agentId, name }]
    ).then((payload) => {
      const row = this.asRecord(payload)
      const filePayload = row.file && typeof row.file === 'object' ? row.file : payload
      const parsed = this.normalizeAgentFileEntry(filePayload)
      const file: AgentFileEntry = {
        ...parsed,
        name: parsed.name || name,
        path: parsed.path || `${this.asString(row.workspace)}/${name}`,
      }
      return {
        agentId: this.asString(row.agentId || row.id, agentId),
        workspace: this.asString(row.workspace || row.dir || row.path),
        file,
      }
    })
  }

  setAgentFile(agentId: string, name: string, content: string): Promise<AgentFilesSetResult> {
    return this.callWithMethodAndParamsFallback<unknown>(
      ['agents.files.set', 'agent.files.set'],
      [
        { agentId, name, content },
        { id: agentId, name, content },
        { agent: agentId, name, content },
      ]
    ).then((payload) => {
      const row = this.asRecord(payload)
      const filePayload = row.file && typeof row.file === 'object' ? row.file : payload
      const parsed = this.normalizeAgentFileEntry(filePayload)
      const file: AgentFileEntry = {
        ...parsed,
        name: parsed.name || name,
        path: parsed.path || `${this.asString(row.workspace)}/${name}`,
        missing: false,
        content,
      }
      return {
        ok: this.asBoolean(row.ok, true),
        agentId: this.asString(row.agentId || row.id, agentId),
        workspace: this.asString(row.workspace || row.dir || row.path),
        file,
      }
    })
  }

  // --- Agent ---
  callAgent(params: AgentParams): Promise<unknown> {
    return this.call('agent', params as unknown as Record<string, unknown>, 120000)
  }

  abortAgent(runId: string): Promise<void> {
    return this.call('agent.abort', { runId })
  }

  setAgentModel(sessionKey: string, model: string): Promise<void> {
    return this.call('agent.model.set', { sessionKey, model })
  }

  // --- Chat ---
  listChatHistory(sessionKey: string): Promise<ChatMessage[]> {
    return this.callWithMethodAndParamsFallback<unknown>(
      ['chat.history', 'sessions.history', 'session.history', 'sessions.get', 'session.get'],
      [{ sessionKey }, { key: sessionKey }, { session: sessionKey }]
    ).then((payload) =>
      this.normalizeChatHistoryPayload(payload)
        .map((item) => this.normalizeChatMessageItem(item))
        .filter((item) => !!item.content)
    )
  }

  sendChatMessage(params: ChatSendParams): Promise<unknown> {
    const idempotencyKey = params.idempotencyKey || `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const model = params.model?.trim()
    const chatSendCandidates: Array<Record<string, unknown>> = [
      {
        sessionKey: params.sessionKey,
        message: params.message,
        idempotencyKey,
      },
      {
        sessionKey: params.sessionKey,
        input: params.message,
        idempotencyKey,
      },
      {
        key: params.sessionKey,
        message: params.message,
        idempotencyKey,
      },
      {
        session: params.sessionKey,
        message: params.message,
        idempotencyKey,
      },
      {
        sessionKey: params.sessionKey,
        text: params.message,
        idempotencyKey,
      },
      {
        sessionKey: params.sessionKey,
        content: params.message,
        idempotencyKey,
      },
    ]

    if (model) {
      chatSendCandidates.unshift(
        {
          sessionKey: params.sessionKey,
          message: params.message,
          modelRef: model,
          idempotencyKey,
        },
        {
          sessionKey: params.sessionKey,
          message: params.message,
          modelOverride: model,
          idempotencyKey,
        },
        {
          sessionKey: params.sessionKey,
          message: params.message,
          model,
          idempotencyKey,
        },
        {
          sessionKey: params.sessionKey,
          input: params.message,
          modelOverride: model,
          idempotencyKey,
        }
      )
    }

    return this.callWithMethodAndParamsFallback(
      ['chat.send'],
      chatSendCandidates,
      120000
    ).catch((error) => {
      if (!this.shouldFallbackOnError(error)) {
        throw error
      }
      return this.callWithMethodAndParamsFallback(
        ['agent'],
        [
          {
            sessionKey: params.sessionKey,
            input: params.message,
            ...(model ? { modelOverride: model } : {}),
            idempotencyKey,
          },
          {
            sessionKey: params.sessionKey,
            message: params.message,
            ...(model ? { modelOverride: model } : {}),
            idempotencyKey,
          },
          {
            key: params.sessionKey,
            input: params.message,
            ...(model ? { modelOverride: model } : {}),
            idempotencyKey,
          },
          {
            key: params.sessionKey,
            message: params.message,
            ...(model ? { modelOverride: model } : {}),
            idempotencyKey,
          },
          {
            input: params.message,
            ...(model ? { modelOverride: model } : {}),
            idempotencyKey,
          },
          {
            message: params.message,
            ...(model ? { modelOverride: model } : {}),
            idempotencyKey,
          },
        ],
        120000
      )
    })
  }

  abortChat(runId?: string, sessionKey?: string): Promise<void> {
    const paramsList: Array<Record<string, unknown>> = []
    if (runId) paramsList.push({ runId })
    if (sessionKey) {
      paramsList.push({ sessionKey })
      paramsList.push({ key: sessionKey })
    }
    if (paramsList.length === 0) {
      paramsList.push({})
    }
    return this.callWithMethodAndParamsFallback(['chat.abort', 'agent.abort'], paramsList)
  }

  // --- Cron ---
  listCrons(): Promise<CronJob[]> {
    return this.callWithMethodAndParamsFallback<unknown>(
      ['cron.list', 'crons.list', 'schedule.list', 'schedules.list'],
      [{ includeDisabled: true }, {}]
    ).then(
      (payload) =>
        this.normalizeList<unknown>(payload, ['items', 'list', 'data', 'jobs', 'tasks', 'crons', 'schedules'])
          .map((item) => this.normalizeCronItem(item))
          .filter((item) => !!item.id)
    )
  }

  getCronStatus(): Promise<CronStatus> {
    return this.callWithFallback<unknown>(
      ['cron.status', 'crons.status', 'schedule.status', 'schedules.status'],
      {}
    ).then((payload) => this.normalizeCronStatus(payload))
  }

  listCronRuns(jobId: string, limit = 50): Promise<CronRunLogEntry[]> {
    return this.callWithMethodAndParamsFallback<unknown>(
      ['cron.runs', 'crons.runs', 'cron.history', 'crons.history'],
      [{ id: jobId, limit }, { jobId, limit }, { taskId: jobId, limit }]
    ).then((payload) =>
      this.normalizeList<unknown>(payload, ['entries', 'items', 'list', 'data', 'runs', 'history'])
        .map((item) => this.normalizeCronRunItem(item))
        .filter((item) => !!item.jobId)
    )
  }

  createCron(params: CronUpsertParams): Promise<void> {
    const raw = params as unknown as Record<string, unknown>
    return this.callWithMethodAndParamsFallback(
      ['cron.add', 'cron.create', 'crons.add', 'crons.create'],
      [raw, { job: raw }, { task: raw }]
    )
  }

  updateCron(id: string, params: Partial<CronUpsertParams>): Promise<void> {
    const patch = params as Record<string, unknown>
    return this.callWithMethodAndParamsFallback(
      ['cron.update', 'crons.update', 'schedule.update', 'schedules.update'],
      [{ id, ...patch }, { id, patch }, { jobId: id, ...patch }, { taskId: id, ...patch }]
    )
  }

  deleteCron(id: string): Promise<void> {
    return this.callWithMethodAndParamsFallback(
      ['cron.remove', 'cron.delete', 'crons.remove', 'crons.delete', 'schedule.delete', 'schedules.delete'],
      [{ id }, { jobId: id }, { taskId: id }]
    )
  }

  runCron(id: string, mode: 'force' | 'due' = 'force'): Promise<void> {
    return this.callWithMethodAndParamsFallback(
      ['cron.run', 'crons.run', 'cron.trigger', 'crons.trigger'],
      [{ id, mode }, { jobId: id, mode }, { taskId: id, mode }, { id }, { jobId: id }, { taskId: id }],
      160000
    )
  }

  // --- Models ---
  listModels(): Promise<ModelInfo[]> {
    return this.callWithFallback<unknown>(['models.list', 'model.list']).then((payload) =>
      this.normalizeList<unknown>(payload, ['models', 'items', 'list', 'data', 'entries'])
        .map((item) => this.normalizeModelItem(item))
        .filter((item) => !!item.id)
    )
  }

  // --- Messaging ---
  sendMessage(params: SendParams): Promise<void> {
    return this.call('send', params as unknown as Record<string, unknown>)
  }

  // --- Remote Desktop ---
  async listDesktopSessions(): Promise<import('./types').RemoteDesktopListResult> {
    const payload = await this.callWithFallback<unknown>(
      ['desktop.list', 'remote-desktop.list', 'vnc.list'],
      {}
    )
    const sessions = this.normalizeList<unknown>(payload, ['sessions', 'items', 'list', 'data'])
      .map((item) => this.normalizeDesktopSession(item))
    return { sessions }
  }

  async createDesktopSession(params: import('./types').RemoteDesktopCreateParams): Promise<import('./types').RemoteDesktopCreateResult> {
    const payload = await this.callWithFallback<unknown>(
      ['desktop.create', 'remote-desktop.create', 'vnc.create'],
      {
        nodeId: params.nodeId,
        width: params.width || 1024,
        height: params.height || 768,
        depth: params.depth || 24,
        timeout: params.timeout,
      }
    )
    const row = this.asRecord(payload)
    return {
      sessionId: this.asString(row.sessionId || row.id),
      success: this.asBoolean(row.success, true),
      message: this.asString(row.message || row.error),
      vncPort: this.asNumber(row.vncPort || row.port),
      websocketPort: this.asNumber(row.websocketPort || row.wsPort),
      password: this.asString(row.password),
    }
  }

  async destroyDesktopSession(sessionId: string): Promise<void> {
    return this.callWithMethodAndParamsFallback(
      ['desktop.destroy', 'remote-desktop.destroy', 'vnc.destroy'],
      [{ sessionId }, { id: sessionId }, { session: sessionId }]
    )
  }

  async resizeDesktop(params: import('./types').RemoteDesktopResizeParams): Promise<void> {
    return this.callWithMethodAndParamsFallback(
      ['desktop.resize', 'remote-desktop.resize', 'vnc.resize'],
      [{ sessionId: params.sessionId, width: params.width, height: params.height }],
      10000
    )
  }

  private normalizeDesktopSession(item: unknown): import('./types').RemoteDesktopSession {
    const row = this.asRecord(item)
    return {
      id: this.asString(row.id || row.sessionId),
      nodeId: this.asString(row.nodeId || row.node),
      nodeName: this.asString(row.nodeName || row.name),
      platform: this.normalizeDesktopPlatform(row.platform),
      status: this.normalizeDesktopStatus(row.status),
      width: this.asNumber(row.width, 1024),
      height: this.asNumber(row.height, 768),
      depth: this.asNumber(row.depth, 24),
      vncPort: this.asNumber(row.vncPort || row.port),
      websocketPort: this.asNumber(row.websocketPort || row.wsPort),
      password: this.asString(row.password),
      createdAt: this.asNumber(row.createdAt || row.created, Date.now()),
      lastActivityAt: this.asNumber(row.lastActivityAt || row.lastActivity, Date.now()),
      error: this.asString(row.error),
    }
  }

  private normalizeDesktopPlatform(value: unknown): import('./types').RemoteDesktopPlatform {
    const str = this.asString(value).toLowerCase()
    if (str === 'linux') return 'linux'
    if (str === 'windows' || str === 'win') return 'windows'
    return 'unknown'
  }

  private normalizeDesktopStatus(value: unknown): import('./types').RemoteDesktopStatus {
    const str = this.asString(value).toLowerCase()
    if (str === 'creating') return 'creating'
    if (str === 'ready') return 'ready'
    if (str === 'connected') return 'connected'
    if (str === 'disconnected') return 'disconnected'
    if (str === 'error') return 'error'
    if (str === 'destroyed') return 'destroyed'
    return 'disconnected'
  }
}
