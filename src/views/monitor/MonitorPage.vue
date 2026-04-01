<script setup lang="ts">
import { computed, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NFormItem,
  NGrid,
  NGridItem,
  NIcon,
  NInput,
  NInputNumber,
  NScrollbar,
  NSelect,
  NSpace,
  NSpin,
  NSwitch,
  NTabPane,
  NTabs,
  NTag,
  NText,
  useDialog,
  useMessage,
} from 'naive-ui'
import {
  AddOutline,
  DownloadOutline,
  RefreshOutline,
  SearchOutline,
  SaveOutline,
  TrashOutline,
} from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useWebSocketStore } from '@/stores/websocket'
import { useRpcSafe } from '@/composables/useRpcSafe'
import AsyncSection from '@/components/common/AsyncSection.vue'
import { formatDate, formatRelativeTime } from '@/utils/format'
import type {
  DeviceNode,
  ExecApprovalsAgent,
  ExecApprovalsDefaults,
  ExecApprovalsFile,
  ExecApprovalsSnapshot,
  HealthSummary,
  LogEntry,
  LogLevel,
  StatusSummary,
  SystemPresenceEntry,
  UpdateRunResponse,
  UpdateRunStepResult,
} from '@/api/types'

type OpsTab = 'presence' | 'logs' | 'approvals' | 'update'
type ExecTargetKind = 'gateway' | 'node'

const LOG_LEVEL_OPTIONS: Array<{ label: string; value: LogLevel }> = [
  { label: 'TRACE', value: 'trace' },
  { label: 'DEBUG', value: 'debug' },
  { label: 'INFO', value: 'info' },
  { label: 'WARN', value: 'warn' },
  { label: 'ERROR', value: 'error' },
  { label: 'FATAL', value: 'fatal' },
]
const POLICY_SECURITY_OPTIONS = [
  { label: 'deny', value: 'deny' },
  { label: 'allowlist', value: 'allowlist' },
  { label: 'full', value: 'full' },
]
const POLICY_ASK_OPTIONS = [
  { label: 'off', value: 'off' },
  { label: 'on-miss', value: 'on-miss' },
  { label: 'always', value: 'always' },
]
const LOG_BUFFER_LIMIT = 2000

const message = useMessage()
const dialog = useDialog()
const wsStore = useWebSocketStore()
const rpc = useRpcSafe()
const { t } = useI18n()

const activeTab = ref<OpsTab>('presence')

const presenceLoading = ref(false)
const presenceError = ref('')
const presenceEntries = ref<SystemPresenceEntry[]>([])
const presenceLastUpdatedAt = ref<number | null>(null)

const diagLoading = ref(false)
const healthError = ref('')
const statusError = ref('')
const healthSnapshot = ref<HealthSummary | null>(null)
const statusSnapshot = ref<StatusSummary | null>(null)
const diagLastUpdatedAt = ref<number | null>(null)
const diagLastProbeAt = ref<number | null>(null)

const logsLoading = ref(false)
const logsError = ref('')
const logsCursor = ref<number | null>(null)
const logsFile = ref('')
const logsEntries = ref<LogEntry[]>([])
const logsTruncated = ref(false)
const logsLastUpdatedAt = ref<number | null>(null)
const logsAutoFollow = ref(true)
const logsKeyword = ref('')
const logsLevelFilter = ref<LogLevel[]>(LOG_LEVEL_OPTIONS.map((item) => item.value))
const logsLimit = ref(500)
const logsMaxBytes = ref(250000)
const logScrollbarRef = ref<any>(null)

const nodesLoading = ref(false)
const nodes = ref<DeviceNode[]>([])

const approvalsLoading = ref(false)
const approvalsSaving = ref(false)
const approvalsError = ref('')
const approvalsDirty = ref(false)
const approvalsSnapshot = ref<ExecApprovalsSnapshot | null>(null)
const approvalsForm = ref<ExecApprovalsFile | null>(null)
const approvalsTargetKind = ref<ExecTargetKind>('gateway')
const approvalsTargetNodeId = ref('')
const approvalsAgentId = ref('main')
const newAgentId = ref('')
const newAllowPattern = ref('')

const updateRunning = ref(false)
const updateError = ref('')
const updateSessionKey = ref('')
const updateNote = ref('')
const updateRestartDelayMs = ref<number | null>(2000)
const updateTimeoutMs = ref<number | null>(180000)
const updateLastTriggeredAt = ref<number | null>(null)
const updateResponse = ref<UpdateRunResponse | null>(null)

// Single reactive object holding all polling timers — enables watch-based cleanup
const pollingTimers = ref<{ presence: ReturnType<typeof setInterval> | null; logs: ReturnType<typeof setInterval> | null }>({
  presence: null,
  logs: null,
})

const connectionTagType = computed<'success' | 'warning' | 'error' | 'default'>(() => {
  if (wsStore.state === 'connected') return 'success'
  if (wsStore.state === 'connecting' || wsStore.state === 'reconnecting') return 'warning'
  if (wsStore.state === 'failed') return 'error'
  return 'default'
})

const connectionLabel = computed(() => {
  if (wsStore.state === 'connected') return t('pages.monitor.connection.connected')
  if (wsStore.state === 'connecting') return t('pages.monitor.connection.connecting')
  if (wsStore.state === 'reconnecting') return t('pages.monitor.connection.reconnecting')
  if (wsStore.state === 'failed') return t('pages.monitor.connection.failed')
  return t('pages.monitor.connection.disconnected')
})

const onlinePresenceCount = computed(() => {
  const now = Date.now()
  return presenceEntries.value.filter((entry) => {
    const ts = typeof entry.ts === 'number' ? entry.ts : 0
    return ts > 0 && now - ts <= 60000
  }).length
})

const healthChannelCount = computed(() => {
  const snap = healthSnapshot.value
  if (!snap?.channels) return 0
  return Object.keys(snap.channels).length
})

const healthConfiguredChannelCount = computed(() => {
  const snap = healthSnapshot.value
  if (!snap?.channels) return 0
  return Object.values(snap.channels).filter((entry) => {
    if (!entry || typeof entry !== 'object') return false
    return (entry as { configured?: boolean }).configured === true
  }).length
})

const healthProbedAccountCount = computed(() => {
  const snap = healthSnapshot.value
  if (!snap?.channels) return 0
  let count = 0
  for (const channel of Object.values(snap.channels)) {
    if (!channel || typeof channel !== 'object') continue
    const accounts = (channel as { accounts?: Record<string, unknown> }).accounts
    const accountEntries =
      accounts && typeof accounts === 'object'
        ? Object.values(accounts).filter((row) => row && typeof row === 'object')
        : []

    if (accountEntries.length === 0) {
      const hasProbe =
        (channel as { lastProbeAt?: number | null }).lastProbeAt != null ||
        (channel as { probe?: unknown }).probe !== undefined
      if (hasProbe) count += 1
      continue
    }

    for (const entry of accountEntries) {
      const row = entry as { lastProbeAt?: number | null; probe?: unknown }
      if (row.lastProbeAt != null || row.probe !== undefined) {
        count += 1
      }
    }
  }
  return count
})

const statusHeartbeatEnabledCount = computed(() => {
  const agents = statusSnapshot.value?.heartbeat?.agents || []
  return agents.filter((agent) => agent.enabled).length
})

const methodUnknown = computed(() => wsStore.gatewayMethods.length === 0)
const supportsPresence = computed(
  () => methodUnknown.value || wsStore.supportsAnyMethod(['system-presence'])
)
const supportsHealth = computed(() => methodUnknown.value || wsStore.supportsAnyMethod(['health']))
const supportsStatus = computed(() => methodUnknown.value || wsStore.supportsAnyMethod(['status']))
const supportsLogs = computed(
  () => methodUnknown.value || wsStore.supportsAnyMethod(['logs.tail'])
)
const supportsExecApprovals = computed(() => {
  if (methodUnknown.value) return true
  if (approvalsTargetKind.value === 'node') {
    return wsStore.supportsAnyMethod(['exec.approvals.node.get', 'exec.approvals.node.set'])
  }
  return wsStore.supportsAnyMethod(['exec.approvals.get', 'exec.approvals.set'])
})
const supportsUpdate = computed(
  () => methodUnknown.value || wsStore.supportsAnyMethod(['update.run'])
)

const logLevelOptions = computed(() => LOG_LEVEL_OPTIONS)
const logsFilteredEntries = computed(() => {
  const query = logsKeyword.value.trim().toLowerCase()
  const levelSet = new Set(logsLevelFilter.value)
  return logsEntries.value.filter((entry) => {
    if (entry.level && !levelSet.has(entry.level)) return false
    if (!query) return true
    return [entry.message, entry.subsystem, entry.raw]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query)
  })
})

const nodeOptions = computed(() =>
  nodes.value.map((node) => ({
    label: `${node.name} (${node.id})`,
    value: node.id,
  }))
)

const approvalsAgentOptions = computed(() => {
  const agents = approvalsForm.value?.agents || {}
  const keys = Object.keys(agents)
  if (!keys.includes('main')) keys.unshift('main')
  return keys.map((id) => ({ label: id, value: id }))
})

const currentApprovalsAgent = computed<ExecApprovalsAgent | null>(() => {
  const form = approvalsForm.value
  if (!form?.agents) return null
  return form.agents[approvalsAgentId.value] || null
})

const currentAllowlist = computed(() => currentApprovalsAgent.value?.allowlist || [])
const updateResult = computed(() => updateResponse.value?.result || null)
const updateSteps = computed(() => updateResult.value?.steps || [])
const updateRestartInfo = computed(() => updateResponse.value?.restart || null)
const updateStatusTagType = computed<'success' | 'error' | 'warning' | 'default'>(() => {
  const status = updateResult.value?.status
  if (status === 'ok') return 'success'
  if (status === 'error') return 'error'
  if (status === 'skipped') return 'warning'
  return 'default'
})

function methodNotReadyLabel(methodLabel: string): string {
  return t('pages.monitor.methodNotSupported', { method: methodLabel })
}

function asErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function formatDuration(durationMs?: number | null): string {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return '-'
  if (durationMs < 1000) return `${Math.floor(durationMs)}ms`
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`
  return `${(durationMs / 60000).toFixed(1)}m`
}

function resolveStepStatusType(step: UpdateRunStepResult): 'success' | 'error' | 'warning' | 'default' {
  if (step.exitCode === 0) return 'success'
  if (typeof step.exitCode === 'number' && step.exitCode > 0) return 'error'
  if (step.stderrTail || step.stdoutTail) return 'warning'
  return 'default'
}

function ensureApprovalsForm(): ExecApprovalsFile {
  if (!approvalsForm.value) {
    approvalsForm.value = {
      version: 1,
      defaults: {},
      agents: {},
    }
  }
  if (!approvalsForm.value.agents) approvalsForm.value.agents = {}
  approvalsForm.value.version = 1
  return approvalsForm.value
}

function parseMaybeJsonString(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function parseLogLine(line: string): LogEntry {
  if (!line.trim()) {
    return { raw: line, message: line }
  }
  try {
    const obj = JSON.parse(line) as Record<string, unknown>
    const meta =
      obj && typeof obj._meta === 'object' && obj._meta !== null
        ? (obj._meta as Record<string, unknown>)
        : null

    const levelRaw =
      typeof meta?.logLevelName === 'string'
        ? meta.logLevelName
        : (typeof meta?.level === 'string' ? meta.level : '')
    const levelLower = levelRaw.toLowerCase()
    const level = LOG_LEVEL_OPTIONS.some((item) => item.value === levelLower as LogLevel)
      ? (levelLower as LogLevel)
      : null
    const time =
      typeof obj.time === 'string'
        ? obj.time
        : (typeof meta?.date === 'string' ? meta.date : null)
    const contextCandidate =
      typeof obj['0'] === 'string'
        ? obj['0']
        : (typeof meta?.name === 'string' ? meta.name : null)
    const contextObject = parseMaybeJsonString(contextCandidate)

    let subsystem: string | null = null
    if (contextObject) {
      if (typeof contextObject.subsystem === 'string') {
        subsystem = contextObject.subsystem
      } else if (typeof contextObject.module === 'string') {
        subsystem = contextObject.module
      }
    } else if (contextCandidate && contextCandidate.length < 120) {
      subsystem = contextCandidate
    }

    let text: string | null = null
    if (typeof obj['1'] === 'string') {
      text = obj['1']
    } else if (!contextObject && typeof obj['0'] === 'string') {
      text = obj['0']
    } else if (typeof obj.message === 'string') {
      text = obj.message
    }

    return {
      raw: line,
      time,
      level,
      subsystem,
      message: text || line,
      meta: meta || undefined,
    }
  } catch {
    return { raw: line, message: line }
  }
}

function scrollLogsToBottom() {
  nextTick(() => {
    logScrollbarRef.value?.scrollTo({ top: Number.MAX_SAFE_INTEGER })
  })
}

async function loadNodes() {
  if (nodesLoading.value) return
  nodesLoading.value = true
  try {
    nodes.value = await rpc.call(() => wsStore.rpc.listNodes(), {
      label: 'listNodes', timeout: 10000, retries: 0,
    })
  } catch {
    nodes.value = []
  } finally {
    nodesLoading.value = false
  }
}

async function loadHealthStatus(opts?: { probe?: boolean }) {
  if (diagLoading.value) return

  const wantsProbe = opts?.probe === true
  diagLoading.value = true
  healthError.value = ''
  statusError.value = ''

  let updated = false

  if (!supportsHealth.value) {
    healthError.value = methodNotReadyLabel('health')
  } else {
    try {
      healthSnapshot.value = await rpc.call(
        () => wsStore.rpc.getHealth({ probe: wantsProbe }),
        { label: 'getHealth', timeout: 15000, retries: 0 }
      )
      updated = true
      if (wantsProbe) {
        diagLastProbeAt.value = Date.now()
      }
    } catch (error) {
      healthError.value = asErrorMessage(error, t('pages.monitor.errors.healthFailed'))
    }
  }

  if (!supportsStatus.value) {
    statusError.value = methodNotReadyLabel('status')
  } else {
    try {
      statusSnapshot.value = await rpc.call(() => wsStore.rpc.getStatus(), {
        label: 'getStatus', timeout: 12000, retries: 0,
      })
      updated = true
    } catch (error) {
      statusError.value = asErrorMessage(error, t('pages.monitor.errors.statusFailed'))
    }
  }

  if (updated) {
    diagLastUpdatedAt.value = Date.now()
  }

  diagLoading.value = false
}

async function loadPresence(quiet = false) {
  if (!supportsPresence.value) {
    presenceError.value = methodNotReadyLabel('system-presence')
    return
  }
  if (presenceLoading.value) return
  if (!quiet) presenceLoading.value = true
  presenceError.value = ''
  try {
    presenceEntries.value = await rpc.call(() => wsStore.rpc.getSystemPresence(), {
      label: 'getSystemPresence', timeout: 12000, retries: 1,
    })
    presenceLastUpdatedAt.value = Date.now()
  } catch (error) {
    presenceError.value = asErrorMessage(error, t('pages.monitor.errors.presenceFailed'))
  } finally {
    if (!quiet) presenceLoading.value = false
  }
}

async function loadLogs(opts?: { reset?: boolean; quiet?: boolean }) {
  if (!supportsLogs.value) {
    logsError.value = methodNotReadyLabel('logs.tail')
    return
  }
  if (logsLoading.value) return

  if (!opts?.quiet) logsLoading.value = true
  logsError.value = ''
  try {
    const result = await rpc.call(
      () =>
        wsStore.rpc.tailLogs({
          cursor: opts?.reset ? undefined : (logsCursor.value ?? undefined),
          limit: Math.max(1, Math.floor(logsLimit.value || 500)),
          maxBytes: Math.max(1, Math.floor(logsMaxBytes.value || 250000)),
        }),
      { label: 'tailLogs', timeout: 20000, retries: 0 }
    )

    const parsed = result.lines.map((line) => parseLogLine(line))
    const shouldReset = Boolean(opts?.reset || result.reset || logsCursor.value == null)
    logsEntries.value = shouldReset
      ? parsed
      : [...logsEntries.value, ...parsed].slice(-LOG_BUFFER_LIMIT)
    logsCursor.value = result.cursor
    logsFile.value = result.file
    logsTruncated.value = Boolean(result.truncated)
    logsLastUpdatedAt.value = Date.now()

    if (logsAutoFollow.value && activeTab.value === 'logs') {
      scrollLogsToBottom()
    }
  } catch (error) {
    logsError.value = asErrorMessage(error, t('pages.monitor.errors.logsFailed'))
  } finally {
    if (!opts?.quiet) logsLoading.value = false
  }
}

function clearLogs() {
  logsEntries.value = []
  logsCursor.value = null
  logsFile.value = ''
  logsTruncated.value = false
}

function exportFilteredLogs() {
  if (logsFilteredEntries.value.length === 0) return
  const text = logsFilteredEntries.value.map((entry) => entry.raw).join('\n')
  const blob = new Blob([`${text}\n`], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `openclaw-logs-${Date.now()}.log`
  link.click()
  URL.revokeObjectURL(url)
}

function applyApprovalsSnapshot(snapshot: ExecApprovalsSnapshot) {
  approvalsSnapshot.value = snapshot
  approvalsForm.value = cloneJson(snapshot.file || { version: 1, defaults: {}, agents: {} })
  approvalsDirty.value = false

  const options = approvalsAgentOptions.value
  if (options.length === 0) {
    approvalsAgentId.value = 'main'
    return
  }
  if (!options.some((item) => item.value === approvalsAgentId.value)) {
    approvalsAgentId.value = options[0]?.value || 'main'
  }
}

async function loadApprovals() {
  if (!supportsExecApprovals.value) {
    approvalsError.value = methodNotReadyLabel('exec.approvals.*')
    return
  }
  if (approvalsLoading.value) return

  if (approvalsTargetKind.value === 'node' && !approvalsTargetNodeId.value.trim()) {
    approvalsError.value = t('pages.monitor.approvals.errors.selectNodeBeforeLoad')
    return
  }

  approvalsLoading.value = true
  approvalsError.value = ''
  try {
    const snapshot = await rpc.call(
      () =>
        wsStore.rpc.getExecApprovals({
          nodeId: approvalsTargetKind.value === 'node' ? approvalsTargetNodeId.value : undefined,
        }),
      { label: 'getExecApprovals', timeout: 10000, retries: 0 }
    )
    applyApprovalsSnapshot(snapshot)
  } catch (error) {
    approvalsError.value = asErrorMessage(error, t('pages.monitor.approvals.errors.loadFailed'))
  } finally {
    approvalsLoading.value = false
  }
}

async function saveApprovals() {
  if (!approvalsSnapshot.value?.hash) {
    approvalsError.value = t('pages.monitor.approvals.errors.missingBaseHash')
    return
  }
  if (approvalsTargetKind.value === 'node' && !approvalsTargetNodeId.value.trim()) {
    approvalsError.value = t('pages.monitor.approvals.errors.selectNodeBeforeSave')
    return
  }

  approvalsSaving.value = true
  approvalsError.value = ''
  try {
    const form = ensureApprovalsForm()
    const baseHash = approvalsSnapshot.value!.hash
    const snapshot = await rpc.call(
      () =>
        wsStore.rpc.setExecApprovals({
          file: cloneJson(form),
          baseHash,
          nodeId: approvalsTargetKind.value === 'node' ? approvalsTargetNodeId.value : undefined,
        }),
      { label: 'setExecApprovals', timeout: 12000, retries: 1 }
    )
    applyApprovalsSnapshot(snapshot)
    message.success(t('pages.monitor.approvals.saved'))
  } catch (error) {
    approvalsError.value = asErrorMessage(error, t('pages.monitor.approvals.errors.saveFailed'))
  } finally {
    approvalsSaving.value = false
  }
}

function updateDefaults(patch: Partial<ExecApprovalsDefaults>) {
  const form = ensureApprovalsForm()
  form.defaults = {
    ...(form.defaults || {}),
    ...patch,
  }
  approvalsDirty.value = true
}

function updateCurrentAgent(patch: Partial<ExecApprovalsAgent>) {
  const form = ensureApprovalsForm()
  const agentId = approvalsAgentId.value.trim() || 'main'
  if (!form.agents) form.agents = {}
  form.agents[agentId] = {
    ...(form.agents[agentId] || {}),
    ...patch,
  }
  approvalsDirty.value = true
}

function addAgent() {
  const id = newAgentId.value.trim()
  if (!id) {
    message.warning(t('pages.monitor.approvals.errors.agentIdRequired'))
    return
  }
  const form = ensureApprovalsForm()
  if (!form.agents) form.agents = {}
  if (form.agents[id]) {
    message.warning(t('pages.monitor.approvals.errors.agentExists', { id }))
    return
  }

  form.agents[id] = {
    security: 'allowlist',
    ask: 'on-miss',
    askFallback: 'deny',
    autoAllowSkills: false,
    allowlist: [],
  }
  approvalsAgentId.value = id
  newAgentId.value = ''
  approvalsDirty.value = true
}

function removeCurrentAgent() {
  const form = ensureApprovalsForm()
  const target = approvalsAgentId.value.trim()
  if (!target || target === 'main') {
    message.warning(t('pages.monitor.approvals.errors.cannotDeleteMain'))
    return
  }
  if (!form.agents || !form.agents[target]) return
  delete form.agents[target]
  const next = approvalsAgentOptions.value[0]?.value || 'main'
  approvalsAgentId.value = next
  approvalsDirty.value = true
}

function addAllowPattern() {
  const pattern = newAllowPattern.value.trim()
  if (!pattern) {
    message.warning(t('pages.monitor.approvals.errors.allowlistPatternRequired'))
    return
  }
  const allowlist = [...currentAllowlist.value]
  allowlist.push({
    id: `rule-${Date.now()}`,
    pattern,
  })
  updateCurrentAgent({ allowlist })
  newAllowPattern.value = ''
}

function updateAllowPattern(index: number, pattern: string) {
  const allowlist = [...currentAllowlist.value]
  if (!allowlist[index]) return
  allowlist[index] = {
    ...allowlist[index],
    pattern,
  }
  updateCurrentAgent({ allowlist })
}

function removeAllowPattern(index: number) {
  const allowlist = [...currentAllowlist.value]
  if (!allowlist[index]) return
  allowlist.splice(index, 1)
  updateCurrentAgent({ allowlist: allowlist.length > 0 ? allowlist : undefined })
}

function resetUpdateResult() {
  updateResponse.value = null
  updateError.value = ''
  updateLastTriggeredAt.value = null
}

async function runUpdate() {
  if (!supportsUpdate.value) {
    updateError.value = methodNotReadyLabel('update.run')
    return
  }

  updateRunning.value = true
  updateError.value = ''
  try {
    const response = await rpc.call(
      () =>
        wsStore.rpc.runUpdate({
          sessionKey: updateSessionKey.value.trim() || undefined,
          note: updateNote.value.trim() || undefined,
          restartDelayMs: typeof updateRestartDelayMs.value === 'number' ? updateRestartDelayMs.value : undefined,
          timeoutMs: typeof updateTimeoutMs.value === 'number' ? updateTimeoutMs.value : undefined,
        }),
      { label: 'runUpdate', timeout: 60000, retries: 0 }
    )
    updateResponse.value = response
    updateLastTriggeredAt.value = Date.now()

    if (response.result?.status === 'ok') {
      message.success(t('pages.monitor.update.messages.ok'))
    } else if (response.result?.status === 'skipped') {
      message.warning(t('pages.monitor.update.messages.skipped'))
    } else {
      message.error(t('pages.monitor.update.messages.failed', { reason: response.result?.reason || t('pages.monitor.update.messages.unknownReason') }))
    }
  } catch (error) {
    updateError.value = asErrorMessage(error, t('pages.monitor.update.errors.runFailed'))
  } finally {
    updateRunning.value = false
  }
}

function confirmRunUpdate() {
  dialog.warning({
    title: t('pages.monitor.update.confirm.title'),
    content: () => h('div', { style: 'line-height: 1.75;' }, [
      h('div', t('pages.monitor.update.confirm.lines.action')),
      h('div', t('pages.monitor.update.confirm.lines.scope')),
      h('div', t('pages.monitor.update.confirm.lines.risk')),
      h('div', { style: 'margin-top: 8px; font-weight: 600;' }, t('pages.monitor.update.confirm.lines.confirm')),
    ]),
    positiveText: t('pages.monitor.update.confirm.positive'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => runUpdate(),
  })
}

async function refreshOpsData() {
  // Run all data loads concurrently — no sequential blocking
  await Promise.allSettled([
    loadHealthStatus(),
    loadPresence(),
    loadLogs({ reset: true }),
    loadNodes(),
    activeTab.value === 'approvals' ? loadApprovals() : Promise.resolve(),
  ])
}

watch(
  () => wsStore.state,
  (state) => {
    if (state !== 'connected') return
    if (activeTab.value === 'presence') {
      void loadHealthStatus()
      void loadPresence()
    }
    if (activeTab.value === 'logs') {
      void loadLogs({ reset: true })
    }
    if (activeTab.value === 'approvals') {
      void loadApprovals()
    }
    void loadNodes()
  }
)

watch(activeTab, (tab) => {
  if (tab === 'presence' && presenceEntries.value.length === 0) {
    void loadPresence()
  }
  if (tab === 'presence' && !healthSnapshot.value && !statusSnapshot.value) {
    void loadHealthStatus()
  }
  if (tab === 'logs' && logsEntries.value.length === 0) {
    void loadLogs({ reset: true })
  }
  if (tab === 'approvals' && !approvalsSnapshot.value) {
    void loadApprovals()
  }
})

watch([approvalsTargetKind, approvalsTargetNodeId], () => {
  approvalsSnapshot.value = null
  approvalsForm.value = null
  approvalsDirty.value = false
  approvalsError.value = ''
})

function startPresencePolling() {
  stopPresencePolling()
  pollingTimers.value.presence = setInterval(() => {
    if (activeTab.value !== 'presence') return
    void loadPresence(true)
  }, 8000)
}

function startLogsPolling() {
  stopLogsPolling()
  if (logsAutoFollow.value && activeTab.value === 'logs') {
    pollingTimers.value.logs = setInterval(() => {
      if (!logsAutoFollow.value || activeTab.value !== 'logs') return
      void loadLogs({ quiet: true })
    }, 2000)
  }
}

function stopPresencePolling() {
  if (pollingTimers.value.presence) {
    clearInterval(pollingTimers.value.presence)
    pollingTimers.value.presence = null
  }
}

function stopLogsPolling() {
  if (pollingTimers.value.logs) {
    clearInterval(pollingTimers.value.logs)
    pollingTimers.value.logs = null
  }
}

onMounted(() => {
  void refreshOpsData()
  startPresencePolling()
  startLogsPolling()
})

onUnmounted(() => {
  stopPresencePolling()
  stopLogsPolling()
})

// Start/stop the correct timer when user switches tabs — avoids wasteful background polling
watch(activeTab, (tab) => {
  if (tab === 'presence') {
    startPresencePolling()
  } else {
    stopPresencePolling()
  }
  if (tab === 'logs') {
    startLogsPolling()
  } else {
    stopLogsPolling()
  }
})

// Restart logs polling when auto-follow toggles
watch(logsAutoFollow, () => {
  startLogsPolling()
})

onUnmounted(() => {
  stopPresencePolling()
  stopLogsPolling()
})
</script>

<template>
  <NSpace vertical :size="16">
    <NCard :title="t('routes.monitor')" class="app-card ops-top-card">
      <template #header-extra>
        <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" @click="refreshOpsData">
          <template #icon><NIcon :component="RefreshOutline" /></template>
          {{ t('pages.monitor.actions.refreshAll') }}
        </NButton>
      </template>

      <NSpace :size="12" align="center" style="flex-wrap: wrap;">
        <NTag :type="connectionTagType" :bordered="false" round>{{ connectionLabel }}</NTag>
        <NTag type="success" :bordered="false" round>
          {{ t('pages.monitor.summary.presence', { online: onlinePresenceCount, total: presenceEntries.length }) }}
        </NTag>
        <NTag type="info" :bordered="false" round>
          {{ t('pages.monitor.summary.logs', { count: logsFilteredEntries.length }) }}
        </NTag>
        <NText depth="3" style="font-size: 12px;">
          {{
            t('pages.monitor.summary.lastSync', {
              time: logsLastUpdatedAt ? formatRelativeTime(logsLastUpdatedAt) : t('pages.monitor.summary.neverSynced'),
            })
          }}
        </NText>
      </NSpace>
      <NText depth="3" class="ops-top-subtitle">
        {{ t('pages.monitor.subtitle') }}
      </NText>
    </NCard>

    <NTabs v-model:value="activeTab" type="line" animated>
      <NTabPane name="presence" :tab="t('pages.monitor.tabs.presence')">
        <NCard :title="t('pages.monitor.presence.title')" class="app-card">
          <template #header-extra>
            <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" @click="loadPresence()">
              <template #icon><NIcon :component="RefreshOutline" /></template>
              {{ t('pages.monitor.presence.refresh') }}
            </NButton>
          </template>

          <NAlert
            v-if="!supportsPresence"
            type="warning"
            :bordered="false"
            style="margin-bottom: 12px;"
          >
            {{ t('pages.monitor.presence.notSupported') }}
          </NAlert>
          <NAlert
            v-else-if="presenceError"
            type="error"
            :bordered="false"
            style="margin-bottom: 12px;"
          >
            {{ presenceError }}
          </NAlert>
          <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 10px;">
            {{ t('pages.monitor.presence.hint') }}
          </NText>

          <NCard size="small" embedded class="ops-inner-card" :title="t('pages.monitor.diag.title')">
            <template #header-extra>
              <NSpace :size="8" align="center">
                <NButton size="small" :loading="diagLoading" @click="loadHealthStatus()">
                  <template #icon><NIcon :component="RefreshOutline" /></template>
                  {{ t('common.refresh') }}
                </NButton>
                <NButton size="small" type="warning" :loading="diagLoading" @click="loadHealthStatus({ probe: true })">
                  <template #icon><NIcon :component="SearchOutline" /></template>
                  Probe
                </NButton>
              </NSpace>
            </template>

            <NAlert
              v-if="!supportsHealth || !supportsStatus"
              type="warning"
              :bordered="false"
              style="margin-bottom: 12px;"
            >
              {{ t('pages.monitor.diag.notSupported') }}
            </NAlert>
            <NAlert
              v-if="healthError"
              type="error"
              :bordered="false"
              style="margin-bottom: 12px;"
            >
              {{ t('pages.monitor.diag.healthError', { error: healthError }) }}
            </NAlert>
            <NAlert
              v-if="statusError"
              type="error"
              :bordered="false"
              style="margin-bottom: 12px;"
            >
              {{ t('pages.monitor.diag.statusError', { error: statusError }) }}
            </NAlert>

            <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 10px;">
              {{ t('pages.monitor.diag.hint') }}
            </NText>

            <AsyncSection
              :loading="diagLoading"
              :error="healthError || null"
              error-label="诊断信息加载失败"
              skeleton-height="180px"
              @retry="loadHealthStatus()"
            >
              <template #skeleton>
                <div class="diag-skeleton-grid">
                  <div v-for="n in 6" :key="n" class="diag-skeleton-item">
                    <div class="skeleton-label" style="width: 60px;" />
                    <div class="skeleton-value" style="width: 80px;" />
                  </div>
                </div>
              </template>
              <NGrid cols="1 s:2 m:3" responsive="screen" :x-gap="12" :y-gap="10">
                <NGridItem>
                  <div class="ops-meta-item">
                    <div class="muted">Health</div>
                    <div>
                      <NTag v-if="healthSnapshot?.ok" type="success" :bordered="false" round>OK</NTag>
                      <span v-else>-</span>
                      <span class="muted" style="margin-left: 8px;">
                        {{ formatDuration(healthSnapshot?.durationMs) }}
                      </span>
                    </div>
                  </div>
                </NGridItem>
                <NGridItem>
                  <div class="ops-meta-item">
                    <div class="muted">Channels</div>
                    <div>
                      {{ healthChannelCount }}
                      <span class="muted">（configured {{ healthConfiguredChannelCount }}）</span>
                    </div>
                  </div>
                </NGridItem>
                <NGridItem>
                  <div class="ops-meta-item">
                    <div class="muted">{{ t('pages.monitor.diag.probeResult') }}</div>
                    <div>{{ t('pages.monitor.diag.probeAccounts', { count: healthProbedAccountCount }) }}</div>
                  </div>
                </NGridItem>
                <NGridItem>
                  <div class="ops-meta-item">
                    <div class="muted">Sessions</div>
                    <div>
                      {{ healthSnapshot?.sessions?.count ?? '-' }}
                      <span v-if="healthSnapshot?.defaultAgentId" class="muted">
                        {{ t('pages.monitor.diag.defaultAgent', { id: healthSnapshot.defaultAgentId }) }}
                      </span>
                    </div>
                  </div>
                </NGridItem>
                <NGridItem>
                  <div class="ops-meta-item">
                    <div class="muted">Heartbeat</div>
                    <div>
                      {{ statusHeartbeatEnabledCount }}/{{ statusSnapshot?.heartbeat?.agents?.length ?? 0 }}
                      <span class="muted">{{ t('pages.monitor.diag.enabled') }}</span>
                    </div>
                  </div>
                </NGridItem>
                <NGridItem>
                  <div class="ops-meta-item">
                    <div class="muted">System Events</div>
                    <div>{{ statusSnapshot?.queuedSystemEvents?.length ?? '-' }}</div>
                  </div>
                </NGridItem>
              </NGrid>

              <NText v-if="healthSnapshot?.ts" depth="3" style="font-size: 12px; display: block; margin-top: 8px;">
                {{ t('pages.monitor.diag.healthUpdatedAt', { time: formatRelativeTime(healthSnapshot.ts) }) }}
                <span v-if="diagLastProbeAt">{{ t('pages.monitor.diag.lastProbeAt', { time: formatRelativeTime(diagLastProbeAt) }) }}</span>
              </NText>
              <NText v-else-if="diagLastUpdatedAt" depth="3" style="font-size: 12px; display: block; margin-top: 8px;">
                {{ t('pages.monitor.diag.diagUpdatedAt', { time: formatRelativeTime(diagLastUpdatedAt) }) }}
                <span v-if="diagLastProbeAt">{{ t('pages.monitor.diag.lastProbeAt', { time: formatRelativeTime(diagLastProbeAt) }) }}</span>
              </NText>
            </AsyncSection>
          </NCard>

          <AsyncSection
            :loading="presenceLoading"
            :error="presenceError || null"
            error-label="系统状态加载失败"
            @retry="loadPresence()"
          >
            <div class="presence-list">
              <div
                v-for="(entry, index) in presenceEntries"
                :key="entry.instanceId || entry.deviceId || `${entry.host}-${index}`"
                class="presence-item"
              >
                <div class="presence-main">
                  <div class="presence-title">
                    {{ entry.host || entry.instanceId || entry.deviceId || 'unknown-host' }}
                  </div>
                  <div class="presence-sub">
                    {{ entry.text || entry.reason || t('common.noDescription') }}
                  </div>
                  <NSpace :size="6" style="margin-top: 8px; flex-wrap: wrap;">
                    <NTag v-if="entry.mode" size="small" :bordered="false" round>{{ entry.mode }}</NTag>
                    <NTag v-if="entry.platform" size="small" :bordered="false" round>{{ entry.platform }}</NTag>
                    <NTag v-if="entry.deviceFamily" size="small" :bordered="false" round>{{ entry.deviceFamily }}</NTag>
                    <NTag v-if="entry.version" size="small" :bordered="false" round>{{ entry.version }}</NTag>
                    <NTag
                      v-for="role in entry.roles || []"
                      :key="`role-${role}`"
                      size="small"
                      type="info"
                      :bordered="false"
                      round
                    >
                      {{ role }}
                    </NTag>
                  </NSpace>
                </div>
                <div class="presence-meta">
                  <div>{{ entry.ts ? formatRelativeTime(entry.ts) : '-' }}</div>
                  <div class="muted">last input: {{ entry.lastInputSeconds ?? '-' }}s</div>
                  <div class="muted">{{ entry.ip || '-' }}</div>
                </div>
              </div>

              <NEmpty
                v-if="!presenceLoading && presenceEntries.length === 0"
                :description="t('pages.monitor.presence.empty')"
                style="padding: 48px 0;"
              />
            </div>
          </AsyncSection>

          <NText v-if="presenceLastUpdatedAt" depth="3" style="font-size: 12px;">
            {{ t('pages.monitor.presence.updatedAt', { time: formatDate(presenceLastUpdatedAt) }) }}
          </NText>
        </NCard>
      </NTabPane>

      <NTabPane name="logs" :tab="t('pages.monitor.tabs.logs')">
        <NCard :title="t('pages.monitor.logs.title')" class="app-card">
          <template #header-extra>
            <NSpace :size="8" align="center" class="app-toolbar">
              <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" @click="loadLogs({ reset: true })">
                <template #icon><NIcon :component="RefreshOutline" /></template>
                {{ t('common.refresh') }}
              </NButton>
              <NButton
                size="small"
                class="app-toolbar-btn app-toolbar-btn--refresh"
                :disabled="logsFilteredEntries.length === 0"
                @click="exportFilteredLogs"
              >
                <template #icon><NIcon :component="DownloadOutline" /></template>
                {{ t('common.export') }}
              </NButton>
              <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" @click="clearLogs">
                <template #icon><NIcon :component="TrashOutline" /></template>
                {{ t('common.clear') }}
              </NButton>
            </NSpace>
          </template>

          <NAlert
            v-if="!supportsLogs"
            type="warning"
            :bordered="false"
            style="margin-bottom: 12px;"
          >
            {{ t('pages.monitor.logs.notSupportedPrefix') }}<code>logs.tail</code>{{ t('pages.monitor.logs.notSupportedSuffix') }}
          </NAlert>
          <NAlert
            v-else-if="logsError"
            type="error"
            :bordered="false"
            style="margin-bottom: 12px;"
          >
            {{ logsError }}
          </NAlert>
          <NAlert
            v-if="logsTruncated"
            type="warning"
            :bordered="false"
            style="margin-bottom: 12px;"
          >
            {{ t('pages.monitor.logs.truncatedHint') }}
          </NAlert>
          <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 10px;">
            {{ t('pages.monitor.logs.hintPrefix') }}<code>logs.tail</code>{{ t('pages.monitor.logs.hintSuffix') }}
          </NText>

          <NGrid cols="1 s:2 m:4" responsive="screen" :x-gap="12" :y-gap="10" style="margin-bottom: 12px;">
            <NGridItem>
              <NFormItem :label="t('pages.monitor.logs.keyword')">
                <NInput v-model:value="logsKeyword" :placeholder="t('pages.monitor.logs.keywordPlaceholder')" clearable />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem :label="t('pages.monitor.logs.level')">
                <NSelect
                  v-model:value="logsLevelFilter"
                  :options="logLevelOptions"
                  multiple
                  clearable
                  max-tag-count="responsive"
                />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem label="limit">
                <NInputNumber v-model:value="logsLimit" :min="1" :max="5000" style="width: 100%;" />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem label="maxBytes">
                <NInputNumber v-model:value="logsMaxBytes" :min="1" :max="1000000" style="width: 100%;" />
              </NFormItem>
            </NGridItem>
          </NGrid>

          <NSpace align="center" :size="8" style="margin-bottom: 12px;">
            <NText depth="3" style="font-size: 12px;">{{ t('pages.monitor.logs.autoFollow') }}</NText>
            <NSwitch v-model:value="logsAutoFollow" size="small" />
            <NText depth="3" style="font-size: 12px;">
              {{ t('pages.monitor.logs.file', { file: logsFile || '-' }) }}
            </NText>
          </NSpace>

          <AsyncSection
            :loading="logsLoading"
            :error="logsError || null"
            error-label="日志加载失败"
            @retry="loadLogs({ reset: true })"
          >
            <NScrollbar ref="logScrollbarRef" class="logs-scroll">
              <div v-if="logsFilteredEntries.length === 0" class="logs-empty">
                <NEmpty :description="t('pages.monitor.logs.empty')" />
              </div>
              <div v-else>
                <div
                  v-for="(entry, index) in logsFilteredEntries"
                  :key="`${entry.time || 'no-time'}-${index}`"
                  class="log-row"
                >
                  <div class="log-time">{{ entry.time ? formatDate(entry.time) : '-' }}</div>
                  <NTag size="small" :bordered="false" :type="entry.level === 'error' || entry.level === 'fatal' ? 'error' : entry.level === 'warn' ? 'warning' : 'default'">
                    {{ (entry.level || 'raw').toUpperCase() }}
                  </NTag>
                  <div class="log-subsystem">{{ entry.subsystem || '-' }}</div>
                  <pre class="log-message">{{ entry.message || entry.raw }}</pre>
                </div>
              </div>
            </NScrollbar>
          </AsyncSection>
        </NCard>
      </NTabPane>

      <NTabPane name="approvals" :tab="t('pages.monitor.tabs.approvals')">
        <NCard :title="t('pages.monitor.approvals.title')" class="app-card">
          <template #header-extra>
            <NSpace :size="8" align="center" class="app-toolbar">
              <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" :loading="approvalsLoading" @click="loadApprovals">
                <template #icon><NIcon :component="RefreshOutline" /></template>
                {{ t('pages.monitor.approvals.reload') }}
              </NButton>
              <NButton
                type="primary"
                size="small"
                class="app-toolbar-btn app-toolbar-btn--save"
                :loading="approvalsSaving"
                :disabled="!approvalsDirty || !approvalsSnapshot"
                @click="saveApprovals"
              >
                <template #icon><NIcon :component="SaveOutline" /></template>
                {{ t('pages.monitor.approvals.save') }}
              </NButton>
            </NSpace>
          </template>

          <NGrid cols="1 s:2 m:3" responsive="screen" :x-gap="12" :y-gap="10" style="margin-bottom: 8px;">
            <NGridItem>
              <NFormItem :label="t('pages.monitor.approvals.target')">
                <NSelect
                  v-model:value="approvalsTargetKind"
                  :options="[
                    { label: 'Gateway', value: 'gateway' },
                    { label: 'Node', value: 'node' },
                  ]"
                />
              </NFormItem>
            </NGridItem>
            <NGridItem v-if="approvalsTargetKind === 'node'">
              <NFormItem :label="t('pages.monitor.approvals.node')">
                <NSelect
                  v-model:value="approvalsTargetNodeId"
                  :options="nodeOptions"
                  :loading="nodesLoading"
                  :placeholder="t('pages.monitor.approvals.nodePlaceholder')"
                  clearable
                  filterable
                />
              </NFormItem>
            </NGridItem>
          </NGrid>

          <NAlert
            v-if="!supportsExecApprovals"
            type="warning"
            :bordered="false"
            style="margin-bottom: 12px;"
          >
            {{ t('pages.monitor.approvals.notSupportedPrefix') }}<code>exec.approvals.*</code>{{ t('pages.monitor.approvals.notSupportedSuffix') }}
          </NAlert>
          <NAlert
            v-else-if="approvalsError"
            type="error"
            :bordered="false"
            style="margin-bottom: 12px;"
          >
            {{ approvalsError }}
          </NAlert>
          <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 10px;">
            {{ t('pages.monitor.approvals.hintPrefix') }}<code>exec.approvals.*</code>{{ t('pages.monitor.approvals.hintSuffix') }}
          </NText>

          <div v-if="approvalsSnapshot" class="approvals-meta">
            <div><strong>{{ t('pages.monitor.approvals.meta.file') }}</strong>{{ approvalsSnapshot.path }}</div>
            <div><strong>Hash：</strong>{{ approvalsSnapshot.hash }}</div>
            <div>
              <strong>{{ t('pages.monitor.approvals.meta.status') }}</strong>
              {{ approvalsSnapshot.exists ? t('pages.monitor.approvals.meta.exists') : t('pages.monitor.approvals.meta.created') }}
            </div>
          </div>

          <AsyncSection
            :loading="approvalsLoading"
            :error="approvalsError || null"
            error-label="审批配置加载失败"
            @retry="loadApprovals()"
          >
            <template v-if="approvalsForm">
              <NGrid cols="1 s:2 m:4" responsive="screen" :x-gap="12" :y-gap="10">
                <NGridItem>
                  <NFormItem :label="t('pages.monitor.approvals.defaults.security')">
                    <NSelect
                      :value="approvalsForm.defaults?.security || null"
                      :options="POLICY_SECURITY_OPTIONS"
                      clearable
                      @update:value="(value) => updateDefaults({ security: value || undefined })"
                    />
                  </NFormItem>
                </NGridItem>
                <NGridItem>
                  <NFormItem :label="t('pages.monitor.approvals.defaults.ask')">
                    <NSelect
                      :value="approvalsForm.defaults?.ask || null"
                      :options="POLICY_ASK_OPTIONS"
                      clearable
                      @update:value="(value) => updateDefaults({ ask: value || undefined })"
                    />
                  </NFormItem>
                </NGridItem>
                <NGridItem>
                  <NFormItem :label="t('pages.monitor.approvals.defaults.askFallback')">
                    <NSelect
                      :value="approvalsForm.defaults?.askFallback || null"
                      :options="POLICY_SECURITY_OPTIONS"
                      clearable
                      @update:value="(value) => updateDefaults({ askFallback: value || undefined })"
                    />
                  </NFormItem>
                </NGridItem>
                <NGridItem>
                  <NFormItem label="autoAllowSkills">
                    <NSwitch
                      :value="Boolean(approvalsForm.defaults?.autoAllowSkills)"
                      @update:value="(value) => updateDefaults({ autoAllowSkills: value })"
                    />
                  </NFormItem>
                </NGridItem>
              </NGrid>

              <div class="approvals-divider" />

              <NGrid cols="1 s:2 m:3" responsive="screen" :x-gap="12" :y-gap="10" style="margin-bottom: 10px;">
                <NGridItem>
                  <NFormItem :label="t('pages.monitor.approvals.agent.current')">
                    <NSelect
                      v-model:value="approvalsAgentId"
                      :options="approvalsAgentOptions"
                      :placeholder="t('pages.monitor.approvals.agent.currentPlaceholder')"
                    />
                  </NFormItem>
                </NGridItem>
                <NGridItem>
                  <NFormItem :label="t('pages.monitor.approvals.agent.new')">
                    <NInput v-model:value="newAgentId" :placeholder="t('pages.monitor.approvals.agent.newPlaceholder')" />
                  </NFormItem>
                </NGridItem>
                <NGridItem>
                  <NFormItem :label="t('pages.monitor.approvals.agent.actions')">
                    <NSpace :size="8">
                      <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" @click="addAgent">
                        <template #icon><NIcon :component="AddOutline" /></template>
                        {{ t('pages.monitor.approvals.agent.add') }}
                      </NButton>
                      <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" @click="removeCurrentAgent">
                        <template #icon><NIcon :component="TrashOutline" /></template>
                        {{ t('pages.monitor.approvals.agent.remove') }}
                      </NButton>
                    </NSpace>
                  </NFormItem>
                </NGridItem>
              </NGrid>

              <template v-if="currentApprovalsAgent">
                <NGrid cols="1 s:2 m:4" responsive="screen" :x-gap="12" :y-gap="10">
                  <NGridItem>
                    <NFormItem label="Agent security">
                      <NSelect
                        :value="currentApprovalsAgent.security || null"
                        :options="POLICY_SECURITY_OPTIONS"
                        clearable
                        @update:value="(value) => updateCurrentAgent({ security: value || undefined })"
                      />
                    </NFormItem>
                  </NGridItem>
                  <NGridItem>
                    <NFormItem label="Agent ask">
                      <NSelect
                        :value="currentApprovalsAgent.ask || null"
                        :options="POLICY_ASK_OPTIONS"
                        clearable
                        @update:value="(value) => updateCurrentAgent({ ask: value || undefined })"
                      />
                    </NFormItem>
                  </NGridItem>
                  <NGridItem>
                    <NFormItem label="Agent askFallback">
                      <NSelect
                        :value="currentApprovalsAgent.askFallback || null"
                        :options="POLICY_SECURITY_OPTIONS"
                        clearable
                        @update:value="(value) => updateCurrentAgent({ askFallback: value || undefined })"
                      />
                    </NFormItem>
                  </NGridItem>
                  <NGridItem>
                    <NFormItem label="Agent autoAllowSkills">
                      <NSwitch
                        :value="Boolean(currentApprovalsAgent.autoAllowSkills)"
                        @update:value="(value) => updateCurrentAgent({ autoAllowSkills: value })"
                      />
                    </NFormItem>
                  </NGridItem>
                </NGrid>

                <div class="allowlist-editor">
                  <div class="allowlist-head">
                    <NText strong>Allowlist</NText>
                    <NText depth="3">{{ t('pages.monitor.approvals.allowlist.count', { count: currentAllowlist.length }) }}</NText>
                  </div>
                  <NSpace :size="8" align="center" style="margin-top: 8px;">
                    <NInput
                      v-model:value="newAllowPattern"
                      :placeholder="t('pages.monitor.approvals.allowlist.newPlaceholder')"
                      style="max-width: 420px;"
                    />
                    <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" @click="addAllowPattern">
                      <template #icon><NIcon :component="AddOutline" /></template>
                      {{ t('pages.monitor.approvals.allowlist.add') }}
                    </NButton>
                  </NSpace>

                  <div v-if="currentAllowlist.length === 0" class="allowlist-empty">
                    <NText depth="3">{{ t('pages.monitor.approvals.allowlist.empty') }}</NText>
                  </div>

                  <div
                    v-for="(entry, index) in currentAllowlist"
                    :key="entry.id || `${index}-${entry.pattern}`"
                    class="allowlist-item"
                  >
                    <NInput
                      :value="entry.pattern"
                      @update:value="(value) => updateAllowPattern(index, value)"
                      :placeholder="t('pages.monitor.approvals.allowlist.rulePlaceholder')"
                    />
                    <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" @click="removeAllowPattern(index)">
                      <template #icon><NIcon :component="TrashOutline" /></template>
                      {{ t('common.delete') }}
                    </NButton>
                  </div>
                </div>
              </template>
            </template>

            <NEmpty
              v-else
              :description="t('pages.monitor.approvals.empty')"
              style="padding: 40px 0;"
            />
          </AsyncSection>
        </NCard>
      </NTabPane>

      <NTabPane name="update" :tab="t('pages.monitor.tabs.update')">
        <NCard :title="t('pages.monitor.update.title')" class="app-card">
          <template #header-extra>
            <NSpace :size="8" align="center" class="app-toolbar">
              <NButton
                type="primary"
                size="small"
                class="app-toolbar-btn app-toolbar-btn--save"
                :loading="updateRunning"
                @click="confirmRunUpdate"
              >
                <template #icon><NIcon :component="DownloadOutline" /></template>
                {{ t('pages.monitor.update.actions.run') }}
              </NButton>
              <NButton
                size="small"
                class="app-toolbar-btn app-toolbar-btn--refresh"
                :disabled="updateRunning"
                @click="resetUpdateResult"
              >
                <template #icon><NIcon :component="TrashOutline" /></template>
                {{ t('common.clear') }}
              </NButton>
            </NSpace>
          </template>

          <NAlert
            v-if="!supportsUpdate"
            type="warning"
            :bordered="false"
            style="margin-bottom: 12px;"
          >
            {{ t('pages.monitor.update.notSupportedPrefix') }}<code>update.run</code>{{ t('pages.monitor.update.notSupportedSuffix') }}
          </NAlert>
          <NAlert
            v-else-if="updateError"
            type="error"
            :bordered="false"
            style="margin-bottom: 12px;"
          >
            {{ updateError }}
          </NAlert>
          <NAlert type="warning" :bordered="false" style="margin-bottom: 12px;">
            {{ t('pages.monitor.update.restartWarning') }}
          </NAlert>

          <NCard size="small" embedded class="ops-inner-card" :title="t('pages.monitor.update.params.title')">
            <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 10px;">
              {{ t('pages.monitor.update.params.hint') }}
            </NText>
            <NGrid cols="1 s:2 m:2" responsive="screen" :x-gap="12" :y-gap="10">
              <NGridItem>
                <NFormItem :label="t('pages.monitor.update.params.sessionKey')">
                  <NInput
                    v-model:value="updateSessionKey"
                    :placeholder="t('pages.monitor.update.params.sessionKeyPlaceholder')"
                  />
                </NFormItem>
              </NGridItem>
              <NGridItem>
                <NFormItem :label="t('pages.monitor.update.params.note')">
                  <NInput
                    v-model:value="updateNote"
                    :placeholder="t('pages.monitor.update.params.notePlaceholder')"
                  />
                </NFormItem>
              </NGridItem>
              <NGridItem>
                <NFormItem :label="t('pages.monitor.update.params.restartDelayMs')">
                  <NInputNumber
                    v-model:value="updateRestartDelayMs"
                    :min="0"
                    :step="500"
                    :show-button="false"
                    style="width: 100%;"
                  />
                </NFormItem>
              </NGridItem>
              <NGridItem>
                <NFormItem :label="t('pages.monitor.update.params.timeoutMs')">
                  <NInputNumber
                    v-model:value="updateTimeoutMs"
                    :min="1000"
                    :step="1000"
                    :show-button="false"
                    style="width: 100%;"
                  />
                </NFormItem>
              </NGridItem>
            </NGrid>
          </NCard>

          <div v-if="updateResult || updateRestartInfo || updateLastTriggeredAt" class="update-result-box">
            <div class="update-result-head">
              <NTag :type="updateStatusTagType" :bordered="false" round>
                {{ updateResult?.status || t('pages.monitor.update.statusUnknown') }}
              </NTag>
              <NText depth="3" style="font-size: 12px;">
                {{ t('pages.monitor.update.triggeredAt', { time: updateLastTriggeredAt ? formatDate(updateLastTriggeredAt) : '-' }) }}
              </NText>
              <NText depth="3" style="font-size: 12px;">
                {{ t('pages.monitor.update.duration', { duration: formatDuration(updateResult?.durationMs) }) }}
              </NText>
            </div>

            <NGrid cols="1 s:2 m:3" responsive="screen" :x-gap="12" :y-gap="10" style="margin-top: 10px;">
              <NGridItem>
                <div class="ops-meta-item">
                  <div class="muted">{{ t('pages.monitor.update.meta.mode') }}</div>
                  <div>{{ updateResult?.mode || '-' }}</div>
                </div>
              </NGridItem>
              <NGridItem>
                <div class="ops-meta-item">
                  <div class="muted">{{ t('pages.monitor.update.meta.restart') }}</div>
                  <div>
                    {{
                      updateRestartInfo?.ok
                        ? `OK (${updateRestartInfo.delayMs ?? '-'}ms)`
                        : (updateRestartInfo?.error || t('pages.monitor.update.meta.noResponse'))
                    }}
                  </div>
                </div>
              </NGridItem>
              <NGridItem>
                <div class="ops-meta-item">
                  <div class="muted">{{ t('pages.monitor.update.meta.reason') }}</div>
                  <div>{{ updateResult?.reason || '-' }}</div>
                </div>
              </NGridItem>
            </NGrid>

            <div class="muted" style="margin-top: 8px; font-size: 12px;">
              {{ t('pages.monitor.update.sentinel', { path: updateResponse?.sentinel?.path || '-' }) }}
            </div>

            <div v-if="updateResult?.before || updateResult?.after" class="update-before-after">
              <div><strong>Before:</strong> {{ updateResult?.before?.version || '-' }} / {{ updateResult?.before?.sha || '-' }}</div>
              <div><strong>After:</strong> {{ updateResult?.after?.version || '-' }} / {{ updateResult?.after?.sha || '-' }}</div>
            </div>

            <div v-if="updateSteps.length > 0" class="update-steps">
              <div class="update-steps-title">{{ t('pages.monitor.update.stepsTitle', { count: updateSteps.length }) }}</div>
              <div
                v-for="(step, index) in updateSteps"
                :key="`${step.name}-${index}`"
                class="update-step-item"
              >
                <div class="update-step-head">
                  <NTag size="small" :type="resolveStepStatusType(step)" :bordered="false">
                    #{{ index + 1 }} {{ step.name }}
                  </NTag>
                  <NText depth="3" style="font-size: 12px;">
                    exit={{ step.exitCode ?? 'null' }} · {{ formatDuration(step.durationMs) }}
                  </NText>
                </div>
                <div class="update-step-cmd">{{ step.command || '-' }}</div>
                <div v-if="step.cwd" class="muted" style="font-size: 12px;">cwd: {{ step.cwd }}</div>
                <pre v-if="step.stdoutTail" class="update-step-log update-step-log--stdout">{{ step.stdoutTail }}</pre>
                <pre v-if="step.stderrTail" class="update-step-log update-step-log--stderr">{{ step.stderrTail }}</pre>
              </div>
            </div>
          </div>
        </NCard>
      </NTabPane>
    </NTabs>
  </NSpace>
</template>

<style scoped>
.ops-top-card :deep(.n-card-header) {
  align-items: flex-start;
}

.ops-top-subtitle {
  margin-top: 6px;
  font-size: 12px;
}

.presence-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.presence-item {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.presence-main {
  flex: 1;
  min-width: 0;
}

.presence-title {
  font-weight: 700;
  font-size: 14px;
}

.presence-sub {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 12px;
}

.presence-meta {
  min-width: 180px;
  text-align: right;
  color: var(--text-secondary);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.muted {
  color: var(--text-secondary);
}

.logs-scroll {
  max-height: calc(100vh - 370px);
}

.logs-empty {
  padding: 40px 0;
}

.log-row {
  display: grid;
  grid-template-columns: minmax(170px, 220px) 90px minmax(140px, 200px) minmax(320px, 1fr);
  gap: 10px;
  align-items: flex-start;
  border-bottom: 1px solid var(--border-color);
  padding: 8px 10px;
  font-size: 12px;
}

.log-time {
  color: var(--text-secondary);
}

.log-subsystem {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-message {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  line-height: 1.4;
}

.approvals-meta {
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px dashed var(--border-color);
  border-radius: 10px;
  color: var(--text-secondary);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.approvals-divider {
  margin: 4px 0 12px;
  border-top: 1px solid var(--border-color);
}

.allowlist-editor {
  margin-top: 8px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
}

.allowlist-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.allowlist-empty {
  margin-top: 10px;
}

.allowlist-item {
  margin-top: 8px;
  display: grid;
  grid-template-columns: minmax(300px, 1fr) auto;
  gap: 8px;
}

.ops-inner-card {
  margin-bottom: 12px;
  border-radius: 12px;
}

.update-result-box {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-primary);
}

.update-result-head {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.ops-meta-item {
  padding: 10px;
  border: 1px dashed var(--border-color);
  border-radius: 10px;
  min-height: 62px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.update-before-after {
  margin-top: 10px;
  padding: 10px;
  border-radius: 10px;
  background: var(--bg-secondary);
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.update-steps {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.update-steps-title {
  font-size: 13px;
  font-weight: 700;
}

.update-step-item {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 10px;
}

.update-step-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.update-step-cmd {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-primary);
  word-break: break-all;
}

.update-step-log {
  margin-top: 8px;
  margin-bottom: 0;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  max-height: 260px;
  overflow: auto;
}

.update-step-log--stdout {
  background: rgba(22, 163, 74, 0.08);
}

.update-step-log--stderr {
  background: rgba(239, 68, 68, 0.08);
}

@media (max-width: 900px) {
  .presence-item {
    flex-direction: column;
  }

  .presence-meta {
    min-width: 0;
    text-align: left;
  }

  .log-row {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .allowlist-item {
    grid-template-columns: 1fr;
  }
}
</style>
