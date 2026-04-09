<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NEmpty,
  NForm,
  NFormItem,
  NIcon,
  NInput,
  NModal,
  NPopconfirm,
  NScrollbar,
  NSpace,
  NSpin,
  NSwitch,
  NTag,
  NText,
  NTooltip,
  useMessage,
} from 'naive-ui'
import {
  ContractOutline,
  CopyOutline,
  ExpandOutline,
  SendOutline,
  StopCircleOutline,
  TimeOutline,
} from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useOfficeStore } from '@/stores/office'
import { useChatStore } from '@/stores/chat'
import { useWebSocketStore } from '@/stores/websocket'
import { useConfigStore } from '@/stores/config'
import { useSkillStore } from '@/stores/skill'
import { useSessionStore } from '@/stores/session'
import { formatDate, formatRelativeTime, truncate } from '@/utils/format'
import { renderSimpleMarkdown } from '@/utils/markdown'
import type { ChatMessage, ChatMessageContent, AgentInstance, Skill, SessionsUsageSession } from '@/api/types'

const props = withDefaults(
  defineProps<{
    title?: string
  }>(),
  {
    title: '',
  }
)

const message = useMessage()
const { t, locale } = useI18n()
const officeStore = useOfficeStore()
const chatStore = useChatStore()
const wsStore = useWebSocketStore()
const configStore = useConfigStore()
const skillStore = useSkillStore()
const sessionStore = useSessionStore()

const draft = ref('')
const scrollRef = ref<InstanceType<typeof NScrollbar> | null>(null)
const expandedScrollRef = ref<InstanceType<typeof NScrollbar> | null>(null)
const showExpandedModal = ref(false)
const autoFollowBottom = ref(true)
const aborting = ref(false)
const nowMs = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | null = null

const quickReplySearch = ref('')
const showQuickReplyModal = ref(false)
const quickReplyModalMode = ref<'create' | 'edit'>('create')
const editingQuickReplyId = ref('')
const quickReplyForm = reactive({
  title: '',
  content: '',
})

const QUICK_REPLY_STORAGE_KEY = 'openclaw_chat_quick_replies_v1'
const quickReplies = ref<Array<{
  id: string
  title: string
  content: string
  updatedAt: number
}>>([])

type SessionTokenUsage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
}

const sessionTokenUsage = ref<SessionTokenUsage | null>(null)
const sessionTokenUsageLoading = ref(false)
let sessionTokenUsageRequestId = 0

function normalizeTokenValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value))
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.round(parsed))
    }
  }
  return 0
}

function createSessionTokenUsage(params: {
  input: unknown
  output: unknown
  cacheRead?: unknown
  cacheWrite?: unknown
  total?: unknown
}): SessionTokenUsage {
  const inputValue = normalizeTokenValue(params.input)
  const outputValue = normalizeTokenValue(params.output)
  const cacheReadValue = normalizeTokenValue(params.cacheRead)
  const cacheWriteValue = normalizeTokenValue(params.cacheWrite)
  const totalFromParts = inputValue + outputValue + cacheReadValue + cacheWriteValue
  const totalValue = params.total === undefined
    ? totalFromParts
    : normalizeTokenValue(params.total)

  return {
    input: inputValue,
    output: outputValue,
    cacheRead: cacheReadValue,
    cacheWrite: cacheWriteValue,
    total: totalValue,
  }
}

const sessionTokenUsageFromList = computed<SessionTokenUsage | null>(() => {
  const tokenUsage = selectedSession.value?.tokenUsage
  if (!tokenUsage) return null
  return createSessionTokenUsage({
    input: tokenUsage.totalInput,
    output: tokenUsage.totalOutput,
    total: tokenUsage.totalInput + tokenUsage.totalOutput,
  })
})

const currentSessionTokenUsage = computed<SessionTokenUsage | null>(() =>
  sessionTokenUsage.value || sessionTokenUsageFromList.value
)

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }).format(Math.max(0, value))
}

const sessionTokenMetricTags = computed(() => {
  const usage = currentSessionTokenUsage.value
  if (!usage) return []

  return [
    { key: 'total', label: t('pages.chat.tokens.total'), value: formatTokenCount(usage.total), highlight: true },
    { key: 'input', label: t('pages.chat.tokens.input'), value: formatTokenCount(usage.input), highlight: false },
    { key: 'output', label: t('pages.chat.tokens.output'), value: formatTokenCount(usage.output), highlight: false },
    { key: 'cacheRead', label: t('pages.chat.tokens.cacheRead'), value: formatTokenCount(usage.cacheRead), highlight: false },
    { key: 'cacheWrite', label: t('pages.chat.tokens.cacheWrite'), value: formatTokenCount(usage.cacheWrite), highlight: false },
  ]
})

const sessionTokenStatusText = computed(() =>
  sessionTokenUsageLoading.value
    ? t('pages.chat.tokens.loading')
    : t('pages.chat.tokens.unavailable')
)

function resolveUsageSession(sessions: SessionsUsageSession[], key: string): SessionsUsageSession | null {
  if (sessions.length === 0) return null
  const normalized = key.trim()
  return sessions.find((item) => item.key === normalized) || sessions[0] || null
}

async function fetchSessionTokenUsage(rawKey: string) {
  const key = rawKey.trim()
  sessionTokenUsageRequestId += 1
  const requestId = sessionTokenUsageRequestId

  if (!key) {
    sessionTokenUsage.value = null
    sessionTokenUsageLoading.value = false
    return
  }

  sessionTokenUsage.value = null
  sessionTokenUsageLoading.value = true

  try {
    const usageResult = await wsStore.rpc.getSessionsUsage({
      key,
      limit: 1,
    })
    if (requestId !== sessionTokenUsageRequestId) return

    const usageSession = resolveUsageSession(usageResult.sessions || [], key)
    if (!usageSession?.usage) {
      sessionTokenUsage.value = null
      return
    }

    const usage = usageSession.usage
    sessionTokenUsage.value = createSessionTokenUsage({
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      total: usage.totalTokens,
    })
  } catch (error) {
    if (requestId !== sessionTokenUsageRequestId) return
    sessionTokenUsage.value = null
    console.warn('[AgentChatPanel] 获取会话 token 用量失败:', error)
  } finally {
    if (requestId === sessionTokenUsageRequestId) {
      sessionTokenUsageLoading.value = false
    }
  }
}

const selectedAgent = computed(() => officeStore.selectedAgent)
const selectedSession = computed(() => officeStore.selectedSession)
const selectedSessionKey = computed(() => officeStore.selectedSessionKey)
const executionInProgress = computed(() => officeStore.executionInProgress)
const activeTasks = computed(() => officeStore.activeTasks)

const panelTitle = computed(() => props.title || t('pages.office.chat.title'))

const expandedToolCalls = ref(new Set<string>())
const expandedToolResults = ref(new Set<string>())
const showAgentDetails = ref(false)
const eventCleanups: Array<() => void> = []

interface SlashCommandPreset {
  command: string
  usage?: string
  description: string
  category: string
  expectArgs?: boolean
  aliases?: string[]
}

interface SubagentsSubcommandPreset {
  subcommand: string
  usage?: string
  description: string
}

interface ConfiguredModelOption {
  modelRef: string
  providerId: string
  modelId: string
}

interface SlashSuggestionItem {
  kind: 'command' | 'skill' | 'subagents-subcommand' | 'model' | 'new-model' | 'new-default'
  key: string
  preset?: SlashCommandPreset
  skill?: Skill
  subagentsSubcommand?: SubagentsSubcommandPreset
  model?: ConfiguredModelOption
}

const selectedSlashCommandIndex = ref(0)
const slashFirstLine = computed(() => (draft.value.split('\n')[0] || '').trimStart())
const slashMode = computed(() => slashFirstLine.value.startsWith('/'))
const slashCommandKeyword = computed(() => {
  if (!slashMode.value) return ''
  const content = slashFirstLine.value.slice(1)
  const token = content.split(/[\s:]/)[0] || ''
  return token.toLowerCase()
})

const slashCommandPresets = computed<SlashCommandPreset[]>(() => [
  {
    command: '/new',
    usage: '[model]',
    description: t('pages.chat.slash.commands.new.description'),
    category: t('pages.chat.slash.categories.session'),
    expectArgs: true,
  },
  {
    command: '/skill',
    usage: '<name> [input]',
    description: t('pages.chat.slash.commands.skill.description'),
    category: t('pages.chat.slash.categories.modelAndContext'),
    expectArgs: true,
  },
  {
    command: '/model',
    usage: '<name|list|status>',
    aliases: ['/models'],
    description: t('pages.chat.slash.commands.model.description'),
    category: t('pages.chat.slash.categories.modelAndContext'),
    expectArgs: true,
  },
  {
    command: '/status',
    description: t('pages.chat.slash.commands.status.description'),
    category: t('pages.chat.slash.categories.common'),
  },
  {
    command: '/subagents',
    usage: 'list|kill|log|info|send|steer|spawn',
    description: t('pages.chat.slash.commands.subagents.description'),
    category: t('pages.chat.slash.categories.session'),
    expectArgs: true,
  },
])

const subagentsSubcommandPresets = computed<SubagentsSubcommandPreset[]>(() => [
  {
    subcommand: 'list',
    description: t('pages.chat.slash.commands.subagents.subcommands.list'),
  },
  {
    subcommand: 'kill',
    usage: '<runId>',
    description: t('pages.chat.slash.commands.subagents.subcommands.kill'),
  },
  {
    subcommand: 'log',
    usage: '<runId>',
    description: t('pages.chat.slash.commands.subagents.subcommands.log'),
  },
  {
    subcommand: 'info',
    usage: '<runId>',
    description: t('pages.chat.slash.commands.subagents.subcommands.info'),
  },
  {
    subcommand: 'send',
    usage: '<runId> <message>',
    description: t('pages.chat.slash.commands.subagents.subcommands.send'),
  },
  {
    subcommand: 'steer',
    usage: '<runId> <message>',
    description: t('pages.chat.slash.commands.subagents.subcommands.steer'),
  },
  {
    subcommand: 'spawn',
    usage: '<agentId> <task> [--model <model>] [--thinking <level>]',
    description: t('pages.chat.slash.commands.subagents.subcommands.spawn'),
  },
])

const slashCommandOptions = computed<SlashCommandPreset[]>(() => {
  if (!slashMode.value) return []
  const query = slashCommandKeyword.value
  const presets = slashCommandPresets.value
  if (!query) return presets
  return presets.filter((item) => {
    const primary = item.command.slice(1).toLowerCase()
    if (primary.includes(query)) return true
    return (item.aliases || []).some((alias) => alias.slice(1).toLowerCase().includes(query))
  })
})

const slashSkillMode = computed(() => slashMode.value && slashCommandKeyword.value === 'skill')

function normalizeSlashArguments(line: string): string {
  const withoutCommand = line.replace(/^\/\S+\s*/, '').trim()
  return withoutCommand
}

const slashSkillNameQuery = computed(() => {
  if (!slashSkillMode.value) return ''
  const args = normalizeSlashArguments(slashFirstLine.value)
  const firstToken = args.split(/\s+/)[0] || ''
  return firstToken.toLowerCase()
})

const availableSkills = computed(() =>
  skillStore.skills
    .filter((skill) => {
      if (skill.disabled) return false
      if (skill.eligible === false) return false
      if (!skillStore.isSkillVisibleInChat(skill.name)) return false
      return true
    })
    .sort((a, b) => a.name.localeCompare(b.name))
)

const slashSkillOptions = computed<Skill[]>(() => {
  if (!slashSkillMode.value) return []
  const query = slashSkillNameQuery.value
  if (!query) return availableSkills.value
  return availableSkills.value.filter((skill) =>
    [skill.name, skill.description || ''].some((field) => field.toLowerCase().includes(query))
  )
})

const slashSubagentsMode = computed(() => slashMode.value && slashCommandKeyword.value === 'subagents')
const slashNewMode = computed(() => slashMode.value && slashCommandKeyword.value === 'new')
const slashModelMode = computed(() =>
  slashMode.value && (slashCommandKeyword.value === 'model' || slashCommandKeyword.value === 'models')
)

const slashSubagentsArgs = computed(() => {
  if (!slashSubagentsMode.value) return ''
  return normalizeSlashArguments(slashFirstLine.value)
})

function splitFirstToken(text: string): { first: string; rest: string } {
  const trimmed = text.trim()
  const spaceIndex = trimmed.indexOf(' ')
  if (spaceIndex === -1) {
    return { first: trimmed, rest: '' }
  }
  return {
    first: trimmed.slice(0, spaceIndex),
    rest: trimmed.slice(spaceIndex + 1).trimStart(),
  }
}

const slashSubagentsSubcommandQuery = computed(() => {
  const { first } = splitFirstToken(slashSubagentsArgs.value)
  return first.toLowerCase()
})

type SubagentsSubcommand = 'list' | 'kill' | 'log' | 'info' | 'send' | 'steer' | 'spawn' | ''

function normalizeSubagentsSubcommand(value: string): SubagentsSubcommand {
  const lowered = value.trim().toLowerCase()
  if (['list', 'kill', 'log', 'info', 'send', 'steer', 'spawn'].includes(lowered)) {
    return lowered as SubagentsSubcommand
  }
  return ''
}

const slashSubagentsSubcommand = computed(() => normalizeSubagentsSubcommand(slashSubagentsSubcommandQuery.value))

const slashSubagentsSubcommandOptions = computed<SubagentsSubcommandPreset[]>(() => {
  if (!slashSubagentsMode.value) return []
  const query = slashSubagentsSubcommandQuery.value
  const presets = subagentsSubcommandPresets.value
  if (!query) return presets
  return presets.filter((preset) => preset.subcommand.includes(query))
})

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function splitModelRef(value: string): ConfiguredModelOption | null {
  const text = value.trim()
  const slashIndex = text.indexOf('/')
  if (slashIndex <= 0 || slashIndex >= text.length - 1) return null
  const providerId = text.slice(0, slashIndex).trim()
  const modelId = text.slice(slashIndex + 1).trim()
  if (!providerId || !modelId) return null
  return {
    modelRef: `${providerId}/${modelId}`,
    providerId,
    modelId,
  }
}

function collectConfiguredModelRefs(input: unknown, refs: Set<string>) {
  if (!input) return

  if (typeof input === 'string') {
    const parsed = splitModelRef(input)
    if (parsed) refs.add(parsed.modelRef)
    return
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      collectConfiguredModelRefs(item, refs)
    }
    return
  }

  const row = asRecord(input)
  if (!row) return

  for (const candidate of [row.id, row.model, row.ref, row.primary]) {
    if (typeof candidate === 'string') {
      const parsed = splitModelRef(candidate)
      if (parsed) refs.add(parsed.modelRef)
    }
  }

  for (const [key, value] of Object.entries(row)) {
    const keyParsed = splitModelRef(key)
    if (keyParsed) refs.add(keyParsed.modelRef)
    if (typeof value === 'string') {
      const valueParsed = splitModelRef(value)
      if (valueParsed) refs.add(valueParsed.modelRef)
    }
  }
}

function extractProviderModelIds(input: unknown): string[] {
  if (!input) return []
  if (typeof input === 'string') return [input]
  if (Array.isArray(input)) return input.filter((v): v is string => typeof v === 'string')
  return []
}

function collectConfiguredModelRefsFromProviders(input: unknown, refs: Set<string>) {
  const providers = asRecord(input)
  if (!providers) return

  for (const [providerIdRaw, providerValue] of Object.entries(providers)) {
    const providerId = providerIdRaw.trim()
    if (!providerId) continue
    const provider = asRecord(providerValue)
    if (!provider) continue

    const candidates = [provider.models, provider.modelIds, provider.availableModels, provider.whitelist]
    for (const candidate of candidates) {
      const ids = extractProviderModelIds(candidate)
      for (const id of ids) {
        const parsed = splitModelRef(id)
        if (parsed) {
          refs.add(parsed.modelRef)
        } else if (id.trim()) {
          refs.add(`${providerId}/${id.trim()}`)
        }
      }
    }
  }
}

const configuredModelOptions = computed<ConfiguredModelOption[]>(() => {
  const refs = new Set<string>()
  const defaultsRaw = asRecord(configStore.config?.agents?.defaults)
  const defaultsModelRaw = asRecord(defaultsRaw?.model)
  const allowlistedRefs = new Set<string>()

  collectConfiguredModelRefs(configStore.config?.models?.primary, refs)
  collectConfiguredModelRefs(configStore.config?.models?.fallback, refs)
  collectConfiguredModelRefs(defaultsRaw?.models, refs)
  collectConfiguredModelRefs(defaultsRaw?.models, allowlistedRefs)
  collectConfiguredModelRefs(defaultsModelRaw?.primary, refs)
  collectConfiguredModelRefs(defaultsModelRaw?.fallback, refs)
  collectConfiguredModelRefs(defaultsModelRaw?.fallbacks, refs)
  collectConfiguredModelRefsFromProviders(configStore.config?.models?.providers, refs)

  const finalRefs = new Set<string>()
  if (allowlistedRefs.size > 0) {
    for (const ref of refs) {
      if (allowlistedRefs.has(ref)) {
        finalRefs.add(ref)
      }
    }
    for (const ref of allowlistedRefs) {
      finalRefs.add(ref)
    }
  } else {
    for (const ref of refs) {
      finalRefs.add(ref)
    }
  }

  return Array.from(finalRefs)
    .sort((a, b) => a.localeCompare(b))
    .map((ref) => splitModelRef(ref))
    .filter((item): item is ConfiguredModelOption => !!item)
})

function filterConfiguredModels(query: string, list: ConfiguredModelOption[]): ConfiguredModelOption[] {
  if (!query) return list
  return list.filter((model) =>
    [model.modelRef, model.providerId, model.modelId].some((field) => field.toLowerCase().includes(query))
  )
}

const slashModelQuery = computed(() => {
  if (!slashModelMode.value) return ''
  const args = normalizeSlashArguments(slashFirstLine.value)
  const firstToken = args.split(/\s+/)[0] || ''
  return firstToken.toLowerCase()
})

const slashModelOptions = computed<ConfiguredModelOption[]>(() => {
  if (!slashModelMode.value) return []
  return filterConfiguredModels(slashModelQuery.value, configuredModelOptions.value)
})

const slashNewModelQuery = computed(() => {
  if (!slashNewMode.value) return ''
  const args = normalizeSlashArguments(slashFirstLine.value)
  const firstToken = args.split(/\s+/)[0] || ''
  return firstToken.toLowerCase()
})

const slashNewModelOptions = computed<ConfiguredModelOption[]>(() => {
  if (!slashNewMode.value) return []
  return filterConfiguredModels(slashNewModelQuery.value, configuredModelOptions.value)
})

const slashSuggestions = computed<SlashSuggestionItem[]>(() => {
  if (!slashMode.value) return []
  if (slashSubagentsMode.value) {
    return slashSubagentsSubcommandOptions.value.map((preset) => ({
      kind: 'subagents-subcommand',
      key: `subagents-subcommand-${preset.subcommand}`,
      subagentsSubcommand: preset,
    }))
  }
  if (slashNewMode.value) {
    const defaults: SlashSuggestionItem[] = [
      {
        kind: 'new-default',
        key: 'new-default',
      },
    ]
    const models: SlashSuggestionItem[] = slashNewModelOptions.value.map(
      (model): SlashSuggestionItem => ({
        kind: 'new-model',
        key: `new-model-${model.modelRef}`,
        model,
      })
    )
    return [...defaults, ...models]
  }
  if (slashSkillMode.value) {
    return slashSkillOptions.value.map((skill) => ({
      kind: 'skill',
      key: `skill-${skill.name}`,
      skill,
    }))
  }
  if (slashModelMode.value) {
    return slashModelOptions.value.map((model) => ({
      kind: 'model',
      key: `model-${model.modelRef}`,
      model,
    }))
  }
  return slashCommandOptions.value.map((preset) => ({
    kind: 'command',
    key: `cmd-${preset.command}`,
    preset,
  }))
})

const activeSlashSuggestion = computed(() => {
  if (slashSuggestions.value.length === 0) return null
  const safeIndex = Math.min(
    Math.max(selectedSlashCommandIndex.value, 0),
    slashSuggestions.value.length - 1
  )
  return slashSuggestions.value[safeIndex]
})

function skillSourceLabel(source: Skill['source']): string {
  if (source === 'workspace') return t('pages.skills.sources.workspace')
  if (source === 'managed') return t('pages.skills.sources.managed')
  if (source === 'extra') return t('pages.skills.sources.extra')
  return t('pages.skills.sources.bundled')
}

function applySlashSuggestion(item: SlashSuggestionItem) {
  if (item.kind === 'command' && item.preset) {
    draft.value = item.preset.command + ' '
    return
  }
  if (item.kind === 'skill' && item.skill) {
    draft.value = `/skill ${item.skill.name} `
    return
  }
  if (item.kind === 'subagents-subcommand' && item.subagentsSubcommand) {
    const args = slashSubagentsArgs.value
    const { rest } = splitFirstToken(args)
    const base = `/subagents ${item.subagentsSubcommand.subcommand}`
    if (rest) {
      draft.value = `${base} ${rest}`
    } else {
      draft.value = `${base} `
    }
    return
  }
  if (item.kind === 'model' && item.model) {
    draft.value = `/model ${item.model.modelRef} `
    return
  }
  if (item.kind === 'new-default') {
    draft.value = '/new '
    return
  }
  if (item.kind === 'new-model' && item.model) {
    draft.value = `/new ${item.model.modelRef} `
    return
  }
}

async function handleDraftKeydown(e: KeyboardEvent) {
  const isEnter = e.key === 'Enter'
  const canSend = !e.shiftKey && !e.isComposing

  if (slashMode.value && slashSuggestions.value.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      selectedSlashCommandIndex.value = Math.min(
        selectedSlashCommandIndex.value + 1,
        slashSuggestions.value.length - 1
      )
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      selectedSlashCommandIndex.value = Math.max(selectedSlashCommandIndex.value - 1, 0)
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      if (activeSlashSuggestion.value) {
        applySlashSuggestion(activeSlashSuggestion.value)
      }
      return
    }
    if (isEnter && canSend) {
      e.preventDefault()
      if (activeSlashSuggestion.value) {
        applySlashSuggestion(activeSlashSuggestion.value)
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      draft.value = draft.value.replace(/^\s*\/+/, '')
      return
    }
  }

  if ((e.metaKey || e.ctrlKey) && isEnter) {
    e.preventDefault()
    await handleSend()
    return
  }

  if (isEnter && canSend) {
    e.preventDefault()
    await handleSend()
  }
}

watch(slashFirstLine, () => {
  selectedSlashCommandIndex.value = 0
})

const filteredQuickReplies = computed(() => {
  const query = quickReplySearch.value.trim().toLowerCase()
  const list = [...quickReplies.value].sort((a, b) => b.updatedAt - a.updatedAt)
  if (!query) return list
  return list.filter((item) =>
    [item.title, item.content].some((field) => field.toLowerCase().includes(query))
  )
})

const workspaceRoot = computed(() => configStore.config?.agents?.defaults?.workspace || '~/.openclaw/workspace')
const workspaceQuickReplyDir = computed(() => {
  const root = workspaceRoot.value.endsWith('/') ? workspaceRoot.value.slice(0, -1) : workspaceRoot.value
  return `${root}/prompts/common-replies`
})

function loadQuickReplies() {
  try {
    const raw = localStorage.getItem(QUICK_REPLY_STORAGE_KEY)
    if (!raw) {
      quickReplies.value = []
      return
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      quickReplies.value = []
      return
    }
    quickReplies.value = parsed
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null
        const row = item as Record<string, unknown>
        const title = asString(row.title).trim()
        const content = asString(row.content).trim()
        if (!title || !content) return null
        const id = asString(row.id).trim() || `quick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const updatedAt = asNumber(row.updatedAt) || Date.now()
        return {
          id,
          title,
          content,
          updatedAt,
        }
      })
      .filter((item): item is { id: string; title: string; content: string; updatedAt: number } => !!item)
  } catch {
    quickReplies.value = []
  }
}

function persistQuickReplies() {
  localStorage.setItem(QUICK_REPLY_STORAGE_KEY, JSON.stringify(quickReplies.value))
}

function resetQuickReplyForm() {
  quickReplyForm.title = ''
  quickReplyForm.content = ''
}

function openCreateQuickReply() {
  quickReplyModalMode.value = 'create'
  editingQuickReplyId.value = ''
  resetQuickReplyForm()
  showQuickReplyModal.value = true
}

function openEditQuickReply(item: { id: string; title: string; content: string }) {
  quickReplyModalMode.value = 'edit'
  editingQuickReplyId.value = item.id
  quickReplyForm.title = item.title
  quickReplyForm.content = item.content
  showQuickReplyModal.value = true
}

function handleDeleteQuickReply(id: string) {
  quickReplies.value = quickReplies.value.filter((item) => item.id !== id)
  persistQuickReplies()
  message.success(t('pages.chat.quickReplies.messages.deleted'))
}

function handleInsertQuickReply(item: { title: string; content: string }) {
  const text = item.content.trim()
  if (!text) return
  draft.value = draft.value.trim() ? `${draft.value}\n${text}` : text
  message.success(t('pages.chat.quickReplies.messages.inserted', { title: item.title }))
}

async function handleSendQuickReply(item: { content: string }) {
  draft.value = item.content
  await handleSend()
}

function handleSaveQuickReply() {
  const title = quickReplyForm.title.trim()
  const content = quickReplyForm.content.trim()
  if (!title) {
    message.warning(t('pages.chat.quickReplies.messages.titleRequired'))
    return
  }
  if (!content) {
    message.warning(t('pages.chat.quickReplies.messages.contentRequired'))
    return
  }

  if (quickReplyModalMode.value === 'edit' && editingQuickReplyId.value) {
    quickReplies.value = quickReplies.value.map((item) =>
      item.id === editingQuickReplyId.value
        ? { ...item, title, content, updatedAt: Date.now() }
        : item
    )
    message.success(t('pages.chat.quickReplies.messages.updated'))
  } else {
    quickReplies.value = [
      {
        id: `quick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        content,
        updatedAt: Date.now(),
      },
      ...quickReplies.value,
    ]
    message.success(t('pages.chat.quickReplies.messages.created'))
  }

  persistQuickReplies()
  showQuickReplyModal.value = false
}

async function handleCopyWorkspaceDir() {
  try {
    await navigator.clipboard.writeText(workspaceQuickReplyDir.value)
    message.success(t('pages.chat.quickReplies.messages.dirCopied'))
  } catch {
    message.warning(t('pages.chat.quickReplies.messages.dirCopyFailed'))
  }
}

interface ToolCallItemView {
  id?: string
  name: string
  command?: string
  workdir?: string
  timeout?: number
  partialJson?: string
  argumentsJson?: string
}

interface ThinkingItemView {
  type?: string
  text: string
  signatureId?: string
  summaryText?: string
  hasEncryptedSignature: boolean
}

interface ToolResultItemView {
  id?: string
  name?: string
  status?: string
  content: string
}

interface ToolValidationErrorItemView {
  toolName: string
  issues: string[]
  argumentsText?: string
}

interface ImageItemView {
  mimeType?: string
  bytes?: number
  data?: string
  mediaPath?: string
  url?: string
}

interface StructuredMessageView {
  toolCalls: ToolCallItemView[]
  thinkings: ThinkingItemView[]
  toolResults: ToolResultItemView[]
  validationErrors: ToolValidationErrorItemView[]
  plainTexts: string[]
  images: ImageItemView[]
}

interface RenderMessage {
  key: string
  item: ChatMessage
  structured: StructuredMessageView | null
}

const BOTTOM_GAP = 32
let pendingForceScroll = false
let pendingScroll = false
let destroyed = false

function toggleToolCallExpand(key: string) {
  const set = expandedToolCalls.value
  if (set.has(key)) {
    set.delete(key)
  } else {
    set.add(key)
  }
  expandedToolCalls.value = new Set(set)
}

function toggleToolResultExpand(key: string) {
  const set = expandedToolResults.value
  if (set.has(key)) {
    set.delete(key)
  } else {
    set.add(key)
  }
  expandedToolResults.value = new Set(set)
}

function getMessageContent(entry: RenderMessage): string {
  if (entry.structured) {
    return entry.structured.plainTexts.join('\n')
  }
  return entry.item.content || ''
}

async function copyMessageContent(entry: RenderMessage) {
  const content = getMessageContent(entry)
  try {
    await navigator.clipboard.writeText(content)
    message.success(t('common.copied'))
  } catch {
    message.error(t('common.copyFailed'))
  }
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    message.success(t('common.copied'))
  } catch {
    message.error(t('common.copyFailed'))
  }
}

const imagePreviewUrl = ref<string | null>(null)
const showImagePreviewModal = ref(false)

function openImagePreview(url: string) {
  imagePreviewUrl.value = url
  showImagePreviewModal.value = true
}

function closeImagePreview() {
  showImagePreviewModal.value = false
  imagePreviewUrl.value = null
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value
      .map((item) => asText(item))
      .filter((item) => item.trim().length > 0)
      .join('\n')
  }
  const row = asRecord(value)
  if (!row) return ''
  if ('text' in row) return asText(row.text)
  if ('content' in row) return asText(row.content)
  if ('message' in row) return asText(row.message)
  if ('output' in row) return asText(row.output)
  try {
    return JSON.stringify(row, null, 2)
  } catch {
    return ''
  }
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function isThinkingOnlyStructuredMessage(structured: StructuredMessageView | null): boolean {
  if (!structured) return false
  if (structured.thinkings.length === 0) return false
  return (
    structured.toolCalls.length === 0 &&
    structured.toolResults.length === 0 &&
    structured.validationErrors.length === 0 &&
    structured.plainTexts.length === 0
  )
}

function parseToolResultMessage(item: ChatMessage): StructuredMessageView | null {
  const toolResults: ToolResultItemView[] = []
  
  let contentText = ''
  if (item.rawContent && Array.isArray(item.rawContent)) {
    for (const part of item.rawContent) {
      if (part.type === 'text' && part.text) {
        contentText = part.text
      }
    }
  } else if (item.content) {
    contentText = item.content
  }
  
  toolResults.push({
    id: item.toolCallId,
    name: item.toolName || 'unknown',
    status: item.isError ? 'error' : undefined,
    content: contentText,
  })
  
  return {
    toolCalls: [],
    thinkings: [],
    toolResults,
    validationErrors: [],
    plainTexts: [],
    images: [],
  }
}

function buildImageUrl(part: ChatMessageContent): string | undefined {
  if (part.data) {
    const mimeType = part.mimeType || 'image/png'
    return `data:${mimeType};base64,${part.data}`
  }
  if (part.mediaPath) {
    let mediaPath = part.mediaPath
    
    // 处理 MEDIA: 前缀
    if (mediaPath.startsWith('MEDIA:')) {
      mediaPath = mediaPath.slice(6)
    }
    
    // 从 file:// URL 中提取相对路径
    // 例如: file:///C:/Users/xxx/.openclaw/media/browser/xxx.png -> browser/xxx.png
    if (mediaPath.startsWith('file://')) {
      // 查找 .openclaw/media/ 后面的相对路径
      const mediaIndex = mediaPath.indexOf('.openclaw/media/')
      if (mediaIndex !== -1) {
        mediaPath = mediaPath.slice(mediaIndex + '.openclaw/media/'.length)
      } else {
        // 如果没有找到标准路径，尝试提取文件名
        const lastSlash = mediaPath.lastIndexOf('/')
        if (lastSlash !== -1) {
          mediaPath = `browser/${mediaPath.slice(lastSlash + 1)}`
        }
      }
    }
    
    return `/api/media?path=${encodeURIComponent(mediaPath)}`
  }
  return undefined
}

/**
 * 从路径中提取相对于媒体目录的相对路径
 */
function normalizeMediaPath(path: string): string {
  // 处理 MEDIA: 前缀
  if (path.startsWith('MEDIA:')) {
    path = path.slice(6)
  }
  
  // 从 file:// URL 中提取相对路径
  // 例如: file:///C:/Users/xxx/.openclaw/media/browser/xxx.png -> browser/xxx.png
  if (path.startsWith('file://')) {
    const mediaIndex = path.indexOf('.openclaw/media/')
    if (mediaIndex !== -1) {
      return path.slice(mediaIndex + '.openclaw/media/'.length)
    }
    // 如果没有找到标准路径，尝试提取文件名
    const lastSlash = path.lastIndexOf('/')
    if (lastSlash !== -1) {
      return `browser/${path.slice(lastSlash + 1)}`
    }
  }
  
  return path
}

function extractImageFromText(text: string): { images: ImageItemView[]; cleanedText: string } {
  const images: ImageItemView[] = []
  let cleanedText = text
  
  const mdImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
  let match
  while ((match = mdImageRegex.exec(text)) !== null) {
    const imagePath = match[2]
    if (imagePath && imagePath.match(/\.(png|jpg|jpeg|gif|webp|bmp)$/i)) {
      const normalizedPath = normalizeMediaPath(imagePath)
      const imageUrl = `/api/media?path=${encodeURIComponent(normalizedPath)}`
      images.push({
        mimeType: `image/${imagePath.split('.').pop()?.toLowerCase() || 'png'}`,
        url: imageUrl,
      })
      cleanedText = cleanedText.replace(match[0], '').trim()
    }
  }
  
  const mediaPathRegex = /MEDIA:([^\s\n]+)/g
  while ((match = mediaPathRegex.exec(text)) !== null) {
    const imagePath = match[1]
    if (imagePath && imagePath.match(/\.(png|jpg|jpeg|gif|webp|bmp)$/i)) {
      const normalizedPath = normalizeMediaPath(imagePath)
      const imageUrl = `/api/media?path=${encodeURIComponent(normalizedPath)}`
      images.push({
        mimeType: `image/${imagePath.split('.').pop()?.toLowerCase() || 'png'}`,
        url: imageUrl,
      })
      cleanedText = cleanedText.replace(match[0], '').trim()
    }
  }
  
  return { images, cleanedText }
}

function parseRawContent(rawContent: ChatMessageContent[]): StructuredMessageView | null {
  const toolCalls: ToolCallItemView[] = []
  const thinkings: ThinkingItemView[] = []
  const toolResults: ToolResultItemView[] = []
  const plainTexts: string[] = []
  const images: ImageItemView[] = []

  for (const part of rawContent) {
    if (part.type === 'text' && part.text) {
      const { images: extractedImages, cleanedText } = extractImageFromText(part.text)
      images.push(...extractedImages)
      
      const trimmedText = cleanedText.trim()
      if (trimmedText.match(/\.(png|jpg|jpeg|gif|webp|bmp)$/i)) {
        // Add "browser/" prefix for image filenames without a path
        const imagePath = trimmedText.includes('/') ? trimmedText : `browser/${trimmedText}`
        const imageUrl = `/api/media?path=${encodeURIComponent(imagePath)}`
        images.push({
          mimeType: `image/${trimmedText.split('.').pop()?.toLowerCase() || 'png'}`,
          url: imageUrl,
        })
        // Also add the image filename to plainTexts to display it as text
        plainTexts.push(cleanedText)
      } else if (trimmedText) {
        plainTexts.push(cleanedText)
      }
    }
    
    if (part.type === 'thinking' && part.thinking) {
      thinkings.push({
        text: part.thinking,
        hasEncryptedSignature: false,
      })
    }
    
    if (part.type === 'tool_call') {
      let argumentsJson: string | undefined
      if (part.arguments) {
        try {
          argumentsJson = JSON.stringify(part.arguments, null, 2)
        } catch {
          argumentsJson = String(part.arguments)
        }
      }
      toolCalls.push({
        id: part.id,
        name: part.name || 'unknown',
        argumentsJson,
      })
    }
    
    if (part.type === 'tool_result') {
      let contentText: string
      const rawContent = part.content
      if (rawContent && typeof rawContent === 'object' && !Array.isArray(rawContent)) {
        try {
          contentText = JSON.stringify(rawContent, null, 2)
        } catch {
          contentText = String(rawContent)
        }
      } else if (typeof rawContent === 'string') {
        contentText = rawContent
      } else {
        contentText = String(rawContent || '')
      }
      
      toolResults.push({
        id: part.id,
        name: part.name || 'unknown',
        status: part.isError ? 'error' : undefined,
        content: contentText,
      })
    }

    if (part.type === 'image') {
      const imageUrl = buildImageUrl(part)
      images.push({
        mimeType: part.mimeType,
        bytes: part.bytes,
        data: part.data,
        mediaPath: part.mediaPath,
        url: imageUrl,
      })
    }
  }

  if (toolCalls.length === 0 && thinkings.length === 0 && toolResults.length === 0 && plainTexts.length === 0 && images.length === 0) {
    return null
  }

  return {
    toolCalls,
    thinkings,
    toolResults,
    validationErrors: [],
    plainTexts,
    images,
  }
}

function stripCodeFence(text: string): string {
  const value = text.trim()
  if (!value.startsWith('```') || !value.endsWith('```')) return value
  const lines = value.split('\n')
  if (lines.length < 2) return value
  return lines.slice(1, -1).join('\n').trim()
}

function decodeEscapedJsonText(text: string): string | null {
  const normalized = text.trim()
  if (!normalized.includes('\\"')) return null
  try {
    const wrapped = `"${normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    const decoded = JSON.parse(wrapped)
    if (typeof decoded === 'string' && decoded.trim()) {
      return decoded.trim()
    }
  } catch {
    return null
  }
  return null
}

function looksLikeJsonString(value: string): boolean {
  const text = value.trim()
  if (!text) return false
  return (
    text.startsWith('{') ||
    text.startsWith('[') ||
    text.startsWith('{\\') ||
    text.startsWith('[\\') ||
    (text.startsWith('"') && text.endsWith('"'))
  )
}

function unwrapJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return value
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!looksLikeJsonString(text)) return value
  try {
    const parsed = JSON.parse(text)
    return unwrapJsonValue(parsed, depth + 1)
  } catch {
    return value
  }
}

function parseSingleJsonValue(text: string): unknown | null {
  const normalized = text.trim()
  if (!normalized) return null

  const candidates: string[] = [normalized]
  const decoded = decodeEscapedJsonText(normalized)
  if (decoded && decoded !== normalized) {
    candidates.push(decoded)
  }

  for (const candidate of candidates) {
    try {
      return unwrapJsonValue(JSON.parse(candidate))
    } catch {
      // try next
    }
  }

  return null
}

function splitLeadingJsonValue(line: string): { parsed: unknown; rest: string } | null {
  const text = line.trimStart()
  if (!text || (text[0] !== '{' && text[0] !== '[')) return null

  let inString = false
  let escaped = false
  let depth = 0

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{' || ch === '[') {
      depth += 1
      continue
    }

    if (ch === '}' || ch === ']') {
      depth -= 1
      if (depth !== 0) continue

      const jsonText = text.slice(0, i + 1)
      const parsed = parseSingleJsonValue(jsonText)
      if (parsed == null) return null

      const rest = text.slice(i + 1).trim()
      return {
        parsed,
        rest,
      }
    }
  }

  return null
}

function parseJsonItems(content: string): { items: unknown[]; plainLines: string[] } | null {
  const normalized = stripCodeFence(content).trim()
  if (!normalized) return null

  const rawItems: unknown[] = []
  const plainLines: string[] = []
  const parsed = parseSingleJsonValue(normalized)
  if (parsed != null) {
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        rawItems.push(unwrapJsonValue(item))
      }
    } else {
      rawItems.push(parsed)
    }
    return {
      items: rawItems,
      plainLines,
    }
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (!lines.length) return null
  for (const line of lines) {
    const parsedLine = parseSingleJsonValue(line)
    if (parsedLine == null) {
      const split = splitLeadingJsonValue(line)
      if (split) {
        const parsedValue = split.parsed
        if (Array.isArray(parsedValue)) {
          for (const item of parsedValue) {
            rawItems.push(unwrapJsonValue(item))
          }
        } else {
          rawItems.push(parsedValue)
        }

        if (split.rest) {
          plainLines.push(split.rest)
        }
        continue
      }

      plainLines.push(line)
      continue
    }
    if (Array.isArray(parsedLine)) {
      for (const item of parsedLine) {
        rawItems.push(unwrapJsonValue(item))
      }
      continue
    }
    rawItems.push(parsedLine)
  }

  if (!rawItems.length) return null
  return {
    items: rawItems,
    plainLines,
  }
}

function parseThinkingSignature(value: unknown): {
  signatureId?: string
  summaryText?: string
  hasEncryptedSignature: boolean
} {
  const row = asRecord(unwrapJsonValue(value))
  if (!row) {
    return {
      hasEncryptedSignature: false,
    }
  }
  const signatureId = asString(row.id) || undefined
  const summaryArray = Array.isArray(row.summary) ? row.summary : []
  let summaryText = ''
  for (const item of summaryArray) {
    const text = asText(item).trim()
    if (text) {
      summaryText = text
      break
    }
  }
  const encrypted = asString(row.encrypted_content)
  return {
    signatureId,
    summaryText: summaryText || undefined,
    hasEncryptedSignature: !!encrypted,
  }
}

function parseToolValidationError(content: string): ToolValidationErrorItemView | null {
  const normalized = stripCodeFence(content).trim()
  if (!normalized) return null

  const lines = normalized.split('\n')
  const headerIndex = lines.findIndex((line) => /validation failed for tool/i.test(line))
  if (headerIndex < 0) return null

  const header = lines[headerIndex]?.trim() || ''
  const toolMatch = header.match(/validation failed for tool\s+["'`]?(.+?)["'`]?:?\s*$/i)
  const toolName = toolMatch?.[1]?.trim() || 'unknown'

  const argsMarkerIndex = lines.findIndex((line, idx) => {
    if (idx <= headerIndex) return false
    return /^\s*received arguments\s*:?\s*$/i.test(line)
  })

  const issueSliceEnd = argsMarkerIndex >= 0 ? argsMarkerIndex : lines.length
  const issues = lines
    .slice(headerIndex + 1, issueSliceEnd)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter(Boolean)

  let argumentsText = ''
  if (argsMarkerIndex >= 0) {
    const rawArguments = lines.slice(argsMarkerIndex + 1).join('\n').trim()
    const normalizedArguments = stripCodeFence(rawArguments).trim()
    if (rawArguments) {
      const parsedArgs = parseSingleJsonValue(normalizedArguments || rawArguments)
      if (parsedArgs == null) {
        argumentsText = normalizedArguments || rawArguments
      } else if (typeof parsedArgs === 'string') {
        argumentsText = parsedArgs
      } else {
        try {
          argumentsText = JSON.stringify(parsedArgs, null, 2)
        } catch {
          argumentsText = rawArguments
        }
      }
    }
  }

  if (!toolName && issues.length === 0 && !argumentsText) return null
  return {
    toolName,
    issues,
    argumentsText: argumentsText || undefined,
  }
}

function parseStructuredMessage(content: string): StructuredMessageView | null {
  const parsed = parseJsonItems(content)
  if (!parsed?.items.length) {
    const validationError = parseToolValidationError(content)
    if (!validationError) return null
    return {
      toolCalls: [],
      thinkings: [],
      toolResults: [],
      validationErrors: [validationError],
      plainTexts: [],
      images: [],
    }
  }
  const rawItems = parsed.items

  const toolCalls: ToolCallItemView[] = []
  const thinkings: ThinkingItemView[] = []
  const toolResults: ToolResultItemView[] = []
  let recognized = 0

  for (const rowValue of rawItems) {
    const row = asRecord(unwrapJsonValue(rowValue))
    if (!row) continue
    const typeRaw = asString(row.type).toLowerCase()
    const type = typeRaw ||
      ('thinking' in row || 'thinkingSignature' in row
        ? 'thinking'
        : ('arguments' in row && ('name' in row || 'tool' in row) 
          ? 'toolcall' 
          : (('tool_call_id' in row || 'toolCallId' in row || 'call_id' in row) && ('content' in row || 'output' in row || 'result' in row)
            ? 'toolresult'
            : '')))

    if (type === 'toolcall' || type === 'tool_call') {
      const args = asRecord(row.arguments ?? row.args ?? row.params)
      let argumentsJson: string | undefined
      const rawArgs = row.arguments ?? row.args ?? row.params
      if (rawArgs) {
        try {
          if (typeof rawArgs === 'string') {
            argumentsJson = rawArgs
          } else {
            argumentsJson = JSON.stringify(rawArgs, null, 2)
          }
        } catch {
          argumentsJson = String(rawArgs)
        }
      }
      toolCalls.push({
        id: asString(row.id || row.tool_call_id || row.toolCallId || row.call_id) || undefined,
        name: asString(row.name || row.tool || row.toolName || row.tool_name) || 'unknown',
        command: args ? asString(args.command || args.cmd) || undefined : undefined,
        workdir: args ? asString(args.workdir || args.cwd || args.dir) || undefined : undefined,
        timeout: args ? asNumber(args.timeout) : undefined,
        partialJson: asString(row.partialJson || row.partial_json) || undefined,
        argumentsJson,
      })
      recognized += 1
      continue
    }

    if (type === 'thinking' || type === 'reasoning') {
      const signature = parseThinkingSignature(row.thinkingSignature ?? row.signature)
      const text = asText(row.thinking ?? row.text ?? row.message).trim()
      const hasSignature = signature.signatureId || signature.summaryText || signature.hasEncryptedSignature
      if (!text && !hasSignature) continue
      if (!text && hasSignature && parsed.plainLines.length > 0) {
        recognized += 1
        continue
      }
      thinkings.push({
        type: type || undefined,
        text,
        signatureId: signature.signatureId,
        summaryText: signature.summaryText,
        hasEncryptedSignature: signature.hasEncryptedSignature,
      })
      recognized += 1
      continue
    }

    if (type === 'toolresult' || type === 'tool_result') {
      let contentText: string
      const rawContent = row.content ?? row.output ?? row.result ?? row.message ?? row.response
      
      if (rawContent && typeof rawContent === 'object' && !Array.isArray(rawContent)) {
        try {
          contentText = JSON.stringify(rawContent, null, 2)
        } catch {
          contentText = asText(rawContent)
        }
      } else {
        contentText = asText(rawContent)
      }
      
      if (!contentText.trim()) continue
      toolResults.push({
        id: asString(row.id || row.tool_call_id || row.toolCallId || row.call_id) || undefined,
        name: asString(row.name || row.tool || row.toolName || row.tool_name) || undefined,
        status: asString(row.status || row.state || row.error) || undefined,
        content: contentText,
      })
      recognized += 1
      continue
    }
  }

  if (!recognized) return null
  return {
    toolCalls,
    thinkings,
    toolResults,
    validationErrors: [],
    plainTexts: parsed.plainLines,
    images: [],
  }
}

const messageList = computed(() => chatStore.messages)

const visibleMessageEntries = computed<RenderMessage[]>(() => {
  const list = messageList.value
  const rendered: RenderMessage[] = []

  for (let idx = 0; idx < list.length; idx += 1) {
    const item = list[idx]
    if (!item) continue
    
    if (item.role === 'tool') {
      const structured = parseToolResultMessage(item)
      if (structured) {
        rendered.push({
          key: item.id || `tool-${idx}`,
          item,
          structured,
        })
      }
      continue
    }
    
    if (item.rawContent && Array.isArray(item.rawContent)) {
      const structured = parseRawContent(item.rawContent)
      if (structured && (structured.toolCalls.length > 0 || structured.thinkings.length > 0 || structured.toolResults.length > 0 || structured.plainTexts.length > 0)) {
        rendered.push({
          key: item.id || `${item.role}-${idx}`,
          item,
          structured,
        })
        continue
      }
    }
    
    const structured = parseStructuredMessage(item.content)
    if (isThinkingOnlyStructuredMessage(structured)) continue
    rendered.push({
      key: item.id || `${item.role}-${idx}`,
      item,
      structured,
    })
  }

  return rendered
})

const currentAgentId = computed(() => {
  const sessionKey = chatStore.sessionKey
  if (!sessionKey) return 'default'
  const match = sessionKey.match(/^agent:([^:]+):/)
  if (match && match[1]) {
    return match[1]
  }
  return 'default'
})

const currentAgentStatus = computed(() => {
  return chatStore.getOrCreateAgentStatus(currentAgentId.value)
})

const agentBusy = computed(() => {
  const phase = currentAgentStatus.value.phase
  return (
    phase === 'sending' ||
    phase === 'waiting' ||
    phase === 'thinking' ||
    phase === 'tool' ||
    phase === 'replying' ||
    phase === 'aborting'
  )
})

const currentToolProgress = computed(() => {
  return chatStore.toolProgress.get(currentAgentId.value) || null
})

const agentBusyToolName = computed(() => {
  if (!agentBusy.value) return ''

  const toolProgress = currentToolProgress.value
  if (toolProgress && toolProgress.phase !== 'result' && toolProgress.name.trim()) {
    return toolProgress.name.trim()
  }

  const phase = currentAgentStatus.value.phase
  if (phase === 'replying' || phase === 'aborting') return ''

  const runId = currentAgentStatus.value.runId
  const list = visibleMessageEntries.value
  let startIndex = 0
  if (runId) {
    const idx = list.findIndex((entry) => entry.item.id === runId)
    if (idx >= 0) startIndex = idx + 1
  }

  for (let i = list.length - 1; i >= startIndex; i -= 1) {
    const entry = list[i]
    if (!entry) continue
    const item = entry.item
    if (item.role !== 'assistant') continue
    const structured = entry.structured
    if (!structured) return ''

    if (structured.toolCalls.length === 0) return ''
    if (structured.toolResults.length >= structured.toolCalls.length) {
      return ''
    }

    const lastToolCall = structured.toolCalls[structured.toolCalls.length - 1]
    if (!lastToolCall?.name) return ''
    const normalized = lastToolCall.name.trim()
    return normalized
  }

  return ''
})

const agentStatusTagType = computed<'default' | 'success' | 'warning' | 'info' | 'error'>(() => {
  if (agentBusyToolName.value) return 'warning'
  const phase = currentAgentStatus.value.phase
  if (phase === 'replying' || phase === 'sending' || phase === 'waiting' || phase === 'thinking') return 'info'
  if (phase === 'tool' || phase === 'aborting' || phase === 'aborted') return 'warning'
  if (phase === 'done') return 'success'
  if (phase === 'error') return 'error'
  return 'default'
})

const agentStatusText = computed(() => {
  if (agentBusyToolName.value) return t('pages.chat.agentStatus.toolCall', { name: agentBusyToolName.value })
  const status = currentAgentStatus.value
  if (status.phase === 'sending') return t('pages.chat.agentStatus.sending')
  if (status.phase === 'waiting') return t('pages.chat.agentStatus.waiting')
  if (status.phase === 'thinking') return status.detail ? status.detail : t('pages.chat.agentStatus.thinking')
  if (status.phase === 'tool') {
    return status.detail
      ? t('pages.chat.agentStatus.toolCall', { name: status.detail })
      : t('pages.chat.agentStatus.toolRunning')
  }
  if (status.phase === 'replying') return t('pages.chat.agentStatus.replying')
  if (status.phase === 'aborting') return t('pages.chat.agentStatus.aborting')
  if (status.phase === 'done') return t('pages.chat.agentStatus.done')
  if (status.phase === 'aborted') return t('pages.chat.agentStatus.aborted')
  if (status.phase === 'error') {
    return status.detail
      ? t('pages.chat.agentStatus.errorWithDetail', { detail: status.detail })
      : t('pages.chat.agentStatus.error')
  }
  return t('pages.chat.agentStatus.idle')
})

const hasAgentDetails = computed(() => {
  if (agentBusy.value) return true
  const agentSteps = chatStore.agentSteps.get(currentAgentId.value)
  if (agentSteps && agentSteps.length > 0) return true
  if (currentToolProgress.value) return true
  return false
})

const toolElapsedMs = computed(() => {
  const progress = currentToolProgress.value
  if (!progress) return 0
  const endAt = progress.phase === 'result' ? progress.updatedAtMs : nowMs.value
  return endAt - progress.startedAtMs
})

function formatClock(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '--:--:--'
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function formatDurationMs(ms: number): string {
  const safe = Math.max(0, Math.floor(ms))
  const totalSec = Math.floor(safe / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min <= 0) return `${sec}s`
  return `${min}m${String(sec).padStart(2, '0')}s`
}

async function handleAbort() {
  if (aborting.value) return
  if (!agentBusy.value) return

  aborting.value = true
  try {
    await chatStore.abortActiveRun()
    message.info(t('pages.chat.messages.abortRequested'))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    message.error(t('pages.chat.messages.abortFailed', { reason }))
  } finally {
    aborting.value = false
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function looksLikeMarkdown(value: string): boolean {
  const text = value.replace(/\r\n/g, '\n')
  if (!text.trim()) return false
  if (/```[\s\S]*```/.test(text)) return true
  if (/`[^`\n]+`/.test(text)) return true
  if (/\[[^\]]+]\((https?:\/\/[^)\s]+)\)/.test(text)) return true
  if (/\*\*[^*\n]+\*\*/.test(text)) return true
  if (/(^|[\s(（\[{【'"""'])\*[^*\n]+\*(?=$|[\s)\]）}】'".,!?，。！？：:、"'"])/u.test(text)) return true
  if (/^\s{0,3}#{1,6}\s+\S+/m.test(text)) return true
  if (/^\s{0,3}>\s+\S+/m.test(text)) return true
  if (/^\s{0,3}[-*+]\s+\S+/m.test(text)) return true
  if (/^\s{0,3}\d{1,9}[.)]\s+\S+/m.test(text)) return true
  if (/\|\s*[-:]{3,}\s*\|/.test(text)) return true
  if (/^\s*\|?.+\|.+\n\s*\|?\s*[-:]{3,}\s*\|/m.test(text)) return true
  if (/^\s{0,3}(?:[-*_]\s*){3,}$/m.test(text)) return true
  if (/^\s{0,3}[-*_]{3,}\s*$/m.test(text)) return true
  return false
}

function renderPlainText(content: string): string {
  const escaped = escapeHtml(content || '')
  return `<p>${escaped.replace(/\n/g, '<br />')}</p>`
}

function renderChatMarkdown(content: string, role?: ChatMessage['role']): string {
  const text = content || ''
  if (!looksLikeMarkdown(text)) {
    return renderPlainText(text)
  }
  const autoNestList = role === 'assistant' || role === 'tool' || role === 'system'
  return renderSimpleMarkdown(text, { autoNestList })
}

function roleType(role: string): 'default' | 'success' | 'info' | 'warning' {
  if (role === 'user') return 'info'
  if (role === 'assistant') return 'success'
  if (role === 'tool') return 'warning'
  return 'default'
}

function roleLabel(role: string): string {
  if (role === 'user') return t('pages.chat.roles.user')
  if (role === 'assistant') return t('pages.chat.roles.assistant')
  if (role === 'tool') return t('pages.chat.roles.tool')
  if (role === 'system') return t('pages.chat.roles.system')
  return role
}

function isNearBottom(scrollbar: InstanceType<typeof NScrollbar> | null): boolean {
  if (!scrollbar) return true
  const el = scrollbar.$el as HTMLElement | undefined
  if (!el) return true
  const containerEl = el.querySelector('.n-scrollbar-container') as HTMLElement | null
  if (!containerEl) return true
  const distance = containerEl.scrollHeight - containerEl.scrollTop - containerEl.clientHeight
  return distance <= BOTTOM_GAP
}

function handleTranscriptScroll() {
  autoFollowBottom.value = isNearBottom(scrollRef.value)
}

function handleExpandedScroll() {
  autoFollowBottom.value = isNearBottom(expandedScrollRef.value)
}

function scrollToBottom(options?: { force?: boolean; expanded?: boolean }) {
  const scrollbar = options?.expanded ? expandedScrollRef.value : scrollRef.value
  if (!scrollbar) return

  const force = options?.force ?? false
  if (!force && !autoFollowBottom.value) return

  nextTick(() => {
    scrollbar.scrollTo({ top: Number.MAX_SAFE_INTEGER })
  })
}

function requestScrollToBottom(options?: { force?: boolean; expanded?: boolean }) {
  const force = options?.force ?? false
  if (!force && !autoFollowBottom.value) return
  if (force) pendingForceScroll = true
  if (pendingScroll) return

  pendingScroll = true
  const schedule =
    typeof queueMicrotask === 'function' ? queueMicrotask : (fn: () => void) => Promise.resolve().then(fn)
  schedule(() => {
    pendingScroll = false
    if (destroyed) return
    const forceNow = pendingForceScroll
    pendingForceScroll = false
    scrollToBottom({ force: forceNow, expanded: options?.expanded })
  })
}

function cancelPendingScroll() {
  destroyed = true
  pendingForceScroll = false
  pendingScroll = false
}

async function handleSend() {
  const content = draft.value.trim()
  if (!content) return
  if (agentBusy.value) return

  try {
    const sessionKey = selectedSessionKey.value || (selectedAgent.value ? `${selectedAgent.value.id}:main` : 'main')
    chatStore.setSessionKey(sessionKey)
    await chatStore.sendMessage(content)
    void fetchSessionTokenUsage(sessionKey)
    draft.value = ''
    await nextTick()
    autoFollowBottom.value = true
    requestScrollToBottom({ force: true })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    message.error(reason)
  }
}

function openExpandedModal() {
  showExpandedModal.value = true
  nextTick(() => {
    if (expandedScrollRef.value) {
      expandedScrollRef.value.scrollTo({ top: Number.MAX_SAFE_INTEGER })
    }
  })
}

function closeExpandedModal() {
  showExpandedModal.value = false
}

const messageSignature = computed(() => {
  const list = visibleMessageEntries.value
  const last = list.length > 0 ? list[list.length - 1]?.item : null
  const lastContentLength = last?.content ? last.content.length : 0
  return `${list.length}|${last?.id || ''}|${last?.role || ''}|${last?.timestamp || ''}|${lastContentLength}`
})

watch(
  messageSignature,
  async (next, prev) => {
    if (next === prev) return
    requestScrollToBottom()
    requestScrollToBottom({ expanded: true })
  },
  { flush: 'post' }
)

function handleCodeCopy(event: Event) {
  const target = event.target as HTMLElement
  const button = target.closest('.code-copy-btn') as HTMLButtonElement
  if (!button) return

  const code = button.dataset.code || ''
  navigator.clipboard.writeText(code).then(() => {
    button.classList.add('copied')
    button.title = 'Copied!'
    setTimeout(() => {
      button.classList.remove('copied')
      button.title = 'Copy code'
    }, 2000)
  }).catch((err) => {
    console.error('Failed to copy:', err)
  })
}

onMounted(async () => {
  nowTimer = setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)

  loadQuickReplies()
  document.addEventListener('click', handleCodeCopy)

  eventCleanups.push(
    wsStore.subscribe('event', (evt: unknown) => {
      const data = evt as { event?: string; payload?: unknown }
      const eventName = data.event || ''
      if (
        eventName === 'chat' ||
        eventName.startsWith('chat.') ||
        eventName === 'agent' ||
        eventName.startsWith('agent.') ||
        eventName.startsWith('tool.') ||
        eventName.startsWith('model.')
      ) {
        const name = eventName.toLowerCase()
        const isStreamingEvent =
          name.includes('stream') ||
          name.includes('delta') ||
          name.includes('chunk') ||
          name.includes('partial')
        chatStore.handleAgentStatusEvent(eventName, data.payload)
        chatStore.handleRealtimeEvent(data.payload, {
          refreshHistory: false,
          streaming: isStreamingEvent,
        })
      }
    })
  )

  const sessionKey = selectedSessionKey.value || (selectedAgent.value ? `${selectedAgent.value.id}:main` : null)
  if (sessionKey) {
    chatStore.setSessionKey(sessionKey)
    await chatStore.fetchHistory(sessionKey)
    await nextTick()
    autoFollowBottom.value = true
    requestScrollToBottom({ force: true })
    requestScrollToBottom({ force: true, expanded: true })
  }
})

onUnmounted(() => {
  eventCleanups.forEach((cleanup) => cleanup())
  chatStore.clearTimers()
  cancelPendingScroll()
  if (nowTimer) {
    clearInterval(nowTimer)
    nowTimer = null
  }
  document.removeEventListener('click', handleCodeCopy)
})

watch(selectedSessionKey, async (newSessionKey) => {
  if (newSessionKey) {
    chatStore.setSessionKey(newSessionKey)
    await chatStore.fetchHistory(newSessionKey)
    await nextTick()
    autoFollowBottom.value = true
    requestScrollToBottom({ force: true })
    requestScrollToBottom({ force: true, expanded: true })
  }
})
</script>

<template>
  <NCard :title="panelTitle" size="small" embedded class="chat-panel-card">
    <template #header-extra>
      <NSpace :size="8" align="center">
        <div v-if="sessionTokenMetricTags.length" class="chat-token-metrics">
          <NTag
            v-for="metric in sessionTokenMetricTags"
            :key="metric.key"
            size="small"
            :bordered="false"
            round
            class="chat-token-chip"
            :class="{ 'chat-token-chip--total': metric.highlight }"
          >
            <span class="chat-token-chip__label">{{ metric.label }}</span>
            <span class="chat-token-chip__value">{{ metric.value }}</span>
          </NTag>
        </div>
        <NTag v-else-if="selectedSessionKey" size="small" :bordered="false" round class="chat-token-chip chat-token-chip--loading">
          {{ sessionTokenStatusText }}
        </NTag>
        <NTag v-if="executionInProgress" size="small" type="info" :bordered="false" round>
          <template #icon>
            <NIcon :component="TimeOutline" />
          </template>
          {{ t('pages.office.chat.executing') }}
        </NTag>
        <NTooltip v-if="selectedSession">
          <template #trigger>
            <NTag size="small" :bordered="false" round class="session-tag">
              <span class="session-tag__text">
                {{ selectedAgent?.name || 'Agent' }} / {{ selectedSession.label || selectedSession.key.slice(0, 16) }}
              </span>
            </NTag>
          </template>
          {{ t('pages.office.chat.chattingWith') }}: {{ selectedAgent?.name }} - {{ selectedSession.label || selectedSession.key }}
        </NTooltip>
        <NTooltip>
          <template #trigger>
            <NSwitch v-model:value="autoFollowBottom" size="small" />
          </template>
          {{ t('pages.chat.preferences.autoFollow') }}
        </NTooltip>
        <NButton size="tiny" quaternary @click="openExpandedModal">
          <template #icon>
            <NIcon :component="ExpandOutline" />
          </template>
        </NButton>
      </NSpace>
    </template>

    <div class="chat-panel">
      <div v-if="!selectedSessionKey" class="chat-empty">
        <NEmpty :description="t('pages.office.chat.selectSession')" />
      </div>

      <template v-else>
        <div v-if="activeTasks.length > 0" class="active-tasks-bar">
          <NSpace :size="8" align="center">
            <NIcon :component="TimeOutline" :color="'#2080f0'" />
            <NText depth="3" style="font-size: 12px;">
              {{ t('pages.office.chat.activeTasks', { count: activeTasks.length }) }}
            </NText>
          </NSpace>
        </div>

        <NScrollbar ref="scrollRef" class="chat-messages" @scroll="handleTranscriptScroll">
          <div v-if="visibleMessageEntries.length === 0" class="chat-empty">
            <NEmpty :description="t('pages.office.chat.noMessages')" />
          </div>
          <div v-else class="message-list">
            <div
              v-for="entry in visibleMessageEntries"
              :key="entry.key"
              class="chat-bubble"
              :class="`is-${entry.item.role}`"
            >
              <NSpace justify="space-between" align="center" class="chat-bubble-meta" :size="8">
                <NSpace align="center" :size="6">
                  <NTag size="small" :type="roleType(entry.item.role)" :bordered="false" round>
                    {{ roleLabel(entry.item.role) }}
                  </NTag>
                  <NText v-if="entry.item.name" depth="3" style="font-size: 12px;">
                    {{ entry.item.name }}
                  </NText>
                </NSpace>
                <NText v-if="entry.item.timestamp" depth="3" style="font-size: 12px;">
                  {{ formatDate(entry.item.timestamp) }}
                </NText>
              </NSpace>

              <div v-if="entry.structured" class="structured-message-list">
                <div v-if="entry.structured.toolCalls.length" class="tool-call-list">
                  <div
                    v-for="(tool, toolIndex) in entry.structured.toolCalls"
                    :key="`${entry.key}-tool-${toolIndex}`"
                    class="tool-call-card"
                  >
                    <NSpace align="center" justify="space-between">
                      <NSpace align="center" :size="6">
                        <NTag size="small" type="warning" :bordered="false" round>{{ t('pages.chat.structured.toolCall') }}</NTag>
                        <NText strong>{{ tool.name }}</NText>
                      </NSpace>
                      <NSpace align="center" :size="8">
                        <NText v-if="tool.timeout" depth="3" style="font-size: 12px;">
                          {{ t('pages.chat.structured.timeout', { seconds: tool.timeout }) }}
                        </NText>
                        <NButton
                          v-if="tool.argumentsJson"
                          size="tiny"
                          text
                          @click="toggleToolCallExpand(`${entry.key}-tool-${toolIndex}`)"
                        >
                          {{ expandedToolCalls.has(`${entry.key}-tool-${toolIndex}`) ? t('pages.chat.structured.hideArgs') : t('pages.chat.structured.viewArgs') }}
                        </NButton>
                      </NSpace>
                    </NSpace>

                    <div v-if="tool.command || tool.workdir" class="tool-call-meta">
                      <code v-if="tool.command" class="tool-call-meta__code">{{ tool.command }}</code>
                      <code v-if="tool.workdir" class="tool-call-meta__code">{{ tool.workdir }}</code>
                    </div>

                    <div v-if="tool.argumentsJson && expandedToolCalls.has(`${entry.key}-tool-${toolIndex}`)" class="tool-call-args">
                      <pre class="tool-call-args__content">{{ tool.argumentsJson }}</pre>
                    </div>

                    <details v-if="tool.partialJson" class="tool-call-details">
                      <summary>{{ t('pages.chat.structured.viewPartialJson') }}</summary>
                      <pre>{{ tool.partialJson }}</pre>
                    </details>
                  </div>
                </div>

                <div v-if="entry.structured.toolResults.length" class="tool-result-list">
                  <div
                    v-for="(result, resultIndex) in entry.structured.toolResults"
                    :key="`${entry.key}-tool-result-${resultIndex}`"
                    class="tool-result-card"
                  >
                    <NSpace align="center" justify="space-between">
                      <NSpace align="center" :size="6">
                        <NTag size="small" type="success" :bordered="false" round>{{ t('pages.chat.structured.toolResult') }}</NTag>
                        <NText strong>{{ result.name || 'unknown' }}</NText>
                      </NSpace>
                      <NSpace align="center" :size="8">
                        <NText v-if="result.status" depth="3" style="font-size: 12px;">
                          {{ result.status }}
                        </NText>
                        <NButton
                          size="tiny"
                          text
                          @click="toggleToolResultExpand(`${entry.key}-result-${resultIndex}`)"
                        >
                          {{ expandedToolResults.has(`${entry.key}-result-${resultIndex}`) ? t('pages.chat.structured.hideArgs') : t('pages.chat.structured.viewArgs') }}
                        </NButton>
                      </NSpace>
                    </NSpace>

                    <div v-if="expandedToolResults.has(`${entry.key}-result-${resultIndex}`)" class="tool-call-grid">
                      <span class="tool-call-label">{{ t('pages.chat.structured.callId') }}</span>
                      <div class="tool-call-value-wrapper">
                        <code>{{ result.id || '-' }}</code>
                        <NTooltip>
                          <template #trigger>
                            <NButton quaternary size="tiny" class="tool-value-copy-btn" @click="copyToClipboard(result.id || '-')">
                              <template #icon>
                                <NIcon :component="CopyOutline" />
                              </template>
                            </NButton>
                          </template>
                          {{ t('common.copy') }}
                        </NTooltip>
                      </div>
                      <span class="tool-call-label">{{ t('pages.chat.structured.content') }}</span>
                      <div class="tool-call-value-wrapper tool-result-content-wrapper">
                        <pre class="tool-result-content">{{ result.content }}</pre>
                        <NTooltip>
                          <template #trigger>
                            <NButton quaternary size="tiny" class="tool-value-copy-btn" @click="copyToClipboard(result.content)">
                              <template #icon>
                                <NIcon :component="CopyOutline" />
                              </template>
                            </NButton>
                          </template>
                          {{ t('common.copy') }}
                        </NTooltip>
                      </div>
                    </div>
                  </div>
                </div>

                <div v-if="entry.structured.validationErrors.length" class="validation-error-list">
                  <div
                    v-for="(validation, validationIndex) in entry.structured.validationErrors"
                    :key="`${entry.key}-validation-${validationIndex}`"
                    class="validation-error-card"
                  >
                    <NSpace align="center" justify="space-between">
                      <NSpace align="center" :size="6">
                        <NTag size="small" type="warning" :bordered="false" round>{{ t('pages.chat.structured.validationFailed') }}</NTag>
                        <NText strong>{{ validation.toolName }}</NText>
                      </NSpace>
                      <NText depth="3" style="font-size: 12px;">
                        {{ t('pages.chat.structured.issuesCount', { count: validation.issues.length }) }}
                      </NText>
                    </NSpace>

                    <div class="tool-call-grid">
                      <span class="tool-call-label">{{ t('pages.chat.structured.issues') }}</span>
                      <div class="validation-issues">
                        <div v-if="validation.issues.length === 0">-</div>
                        <div v-for="(issue, issueIndex) in validation.issues" :key="issueIndex">
                          - {{ issue }}
                        </div>
                      </div>
                    </div>

                    <details v-if="validation.argumentsText" class="tool-call-details">
                      <summary>{{ t('pages.chat.structured.viewArgs') }}</summary>
                      <pre>{{ validation.argumentsText }}</pre>
                    </details>
                  </div>
                </div>

                <div v-if="entry.structured.plainTexts.length" class="chat-bubble-content-wrapper">
                  <div
                    class="chat-bubble-content structured-plain-text chat-markdown"
                    v-html="renderChatMarkdown(entry.structured.plainTexts.join('\n'), entry.item.role)"
                  ></div>
                  <div class="chat-content-copy-btn">
                    <NTooltip>
                      <template #trigger>
                        <NButton quaternary size="tiny" @click="copyMessageContent(entry)">
                          <template #icon>
                            <NIcon :component="CopyOutline" />
                          </template>
                        </NButton>
                      </template>
                      {{ t('common.copy') }}
                    </NTooltip>
                  </div>
                </div>

                <div v-if="entry.structured.images.length" class="chat-images-container">
                  <div
                    v-for="(img, imgIndex) in entry.structured.images"
                    :key="`${entry.key}-img-${imgIndex}`"
                    class="chat-image-wrapper"
                  >
                    <img
                      v-if="img.url"
                      :src="img.url"
                      class="chat-image"
                      loading="lazy"
                      @click="openImagePreview(img.url)"
                    />
                    <span v-else class="chat-image-placeholder">{{ t('pages.chat.image.unavailable') }}</span>
                  </div>
                </div>
              </div>

              <div v-else class="chat-bubble-content-wrapper">
                <div
                  class="chat-bubble-content chat-markdown"
                  v-html="renderChatMarkdown(entry.item.content, entry.item.role)"
                ></div>
                <div class="chat-content-copy-btn">
                  <NTooltip>
                    <template #trigger>
                      <NButton quaternary size="tiny" @click="copyMessageContent(entry)">
                        <template #icon>
                          <NIcon :component="CopyOutline" />
                        </template>
                      </NButton>
                    </template>
                    {{ t('common.copy') }}
                  </NTooltip>
                </div>
              </div>
            </div>
          </div>
        </NScrollbar>

        <NCollapse class="chat-quick-collapse">
          <NCollapseItem :title="t('pages.chat.quickReplies.title')" name="quick-replies">
            <template #header-extra>
              <NButton size="tiny" type="primary" secondary @click.stop="openCreateQuickReply">{{ t('pages.chat.quickReplies.add') }}</NButton>
            </template>
            <NInput
              v-model:value="quickReplySearch"
              size="small"
              :placeholder="t('pages.chat.quickReplies.searchPlaceholder')"
            />

            <div v-if="filteredQuickReplies.length" class="chat-quick-list">
              <div v-for="item in filteredQuickReplies" :key="item.id" class="chat-quick-item">
                <NSpace justify="space-between" align="start" :wrap="false">
                  <div style="min-width: 0; flex: 1;">
                    <NText strong style="font-size: 12px;">{{ item.title }}</NText>
                    <NText depth="3" style="display: block; font-size: 11px; margin-top: 2px;">
                      {{ truncate(item.content, 60) }}
                    </NText>
                  </div>
                  <NSpace :size="2">
                    <NButton size="tiny" text @click="handleInsertQuickReply(item)">{{ t('pages.chat.quickReplies.insert') }}</NButton>
                    <NButton size="tiny" text type="primary" @click="handleSendQuickReply(item)">{{ t('pages.chat.actions.send') }}</NButton>
                    <NButton size="tiny" text @click="openEditQuickReply(item)">{{ t('common.edit') }}</NButton>
                    <NPopconfirm
                      :positive-text="t('common.delete')"
                      :negative-text="t('common.cancel')"
                      @positive-click="handleDeleteQuickReply(item.id)"
                    >
                      <template #trigger>
                        <NButton size="tiny" text type="error">{{ t('common.delete') }}</NButton>
                      </template>
                      {{ t('pages.chat.quickReplies.confirmDelete') }}
                    </NPopconfirm>
                  </NSpace>
                </NSpace>
              </div>
            </div>
            <NEmpty v-else :description="t('pages.chat.quickReplies.empty')" style="padding: 10px 0 6px;" size="small" />
          </NCollapseItem>
        </NCollapse>

        <div class="chat-input">
          <NInput
            v-model:value="draft"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 4 }"
            :placeholder="t('pages.office.chat.inputPlaceholder')"
            @keydown="handleDraftKeydown"
          />

          <div v-if="slashMode" class="chat-slash-panel">
            <div class="chat-slash-head">
              <NText depth="3" style="font-size: 12px;">{{ t('pages.chat.slash.title') }}</NText>
              <NText depth="3" style="font-size: 12px;">{{ t('pages.chat.slash.hint') }}</NText>
            </div>
            <div v-if="slashSuggestions.length" class="chat-slash-list">
              <button
                v-for="(item, index) in slashSuggestions"
                :key="item.key"
                class="chat-slash-item"
                :class="{ 'is-active': index === selectedSlashCommandIndex }"
                type="button"
                @mouseenter="selectedSlashCommandIndex = index"
                @mousedown.prevent
                @click="applySlashSuggestion(item)"
              >
                <div v-if="item.kind === 'command' && item.preset">
                  <div class="chat-slash-line">
                    <span class="chat-slash-command">{{ item.preset.command }}</span>
                    <span v-if="item.preset.usage" class="chat-slash-usage">{{ item.preset.usage }}</span>
                    <NTag size="tiny" :bordered="false" round>{{ item.preset.category }}</NTag>
                  </div>
                  <div class="chat-slash-line chat-slash-desc">
                    <span>{{ item.preset.description }}</span>
                  </div>
                </div>
                <div v-else-if="item.kind === 'skill' && item.skill">
                  <div class="chat-slash-line">
                    <span class="chat-slash-command">/skill {{ item.skill.name }}</span>
                    <NTag size="tiny" type="success" :bordered="false" round>
                      {{ skillSourceLabel(item.skill.source) }}
                    </NTag>
                  </div>
                  <div v-if="item.skill.description" class="chat-slash-line chat-slash-desc">
                    <span>{{ item.skill.description }}</span>
                  </div>
                </div>
                <div v-else-if="item.kind === 'subagents-subcommand' && item.subagentsSubcommand">
                  <div class="chat-slash-line">
                    <span class="chat-slash-command">/subagents {{ item.subagentsSubcommand.subcommand }}</span>
                    <span v-if="item.subagentsSubcommand.usage" class="chat-slash-usage">{{ item.subagentsSubcommand.usage }}</span>
                  </div>
                  <div class="chat-slash-line chat-slash-desc">
                    <span>{{ item.subagentsSubcommand.description }}</span>
                  </div>
                </div>
                <div v-else-if="item.kind === 'model' && item.model">
                  <div class="chat-slash-line">
                    <span class="chat-slash-command">/model {{ item.model.modelRef }}</span>
                  </div>
                  <div class="chat-slash-line chat-slash-desc">
                    <span>{{ item.model.providerId }} / {{ item.model.modelId }}</span>
                  </div>
                </div>
                <div v-else-if="item.kind === 'new-default'">
                  <div class="chat-slash-line">
                    <span class="chat-slash-command">/new</span>
                    <NTag size="tiny" type="info" :bordered="false" round>
                      {{ t('pages.chat.slash.commands.new.defaultLabel') }}
                    </NTag>
                  </div>
                  <div class="chat-slash-line chat-slash-desc">
                    <span>{{ t('pages.chat.slash.commands.new.defaultDesc') }}</span>
                  </div>
                </div>
                <div v-else-if="item.kind === 'new-model' && item.model">
                  <div class="chat-slash-line">
                    <span class="chat-slash-command">/new {{ item.model.modelRef }}</span>
                  </div>
                  <div class="chat-slash-line chat-slash-desc">
                    <span>{{ item.model.providerId }} / {{ item.model.modelId }}</span>
                  </div>
                </div>
              </button>
            </div>
            <div v-else class="chat-slash-empty">
              <NText depth="3" style="font-size: 12px;">{{ t('pages.chat.slash.noMatch') }}</NText>
            </div>
          </div>
          <div class="chat-compose-status-line">
            <NTag
              size="small"
              :type="agentStatusTagType"
              :bordered="false"
              round
              class="chat-agent-status-tag"
            >
              {{ agentStatusText }}
            </NTag>
            <NButton
              v-if="hasAgentDetails"
              size="tiny"
              text
              @click="showAgentDetails = !showAgentDetails"
            >
              {{ showAgentDetails ? t('pages.chat.agentDetails.hide') : t('pages.chat.agentDetails.show') }}
            </NButton>
          </div>

          <div v-if="showAgentDetails && hasAgentDetails" class="chat-agent-details">
            <NSpace vertical :size="6">
              <NText depth="3" style="font-size: 12px;">
                {{ t('pages.chat.agentDetails.phaseDuration', { duration: formatDurationMs(nowMs - currentAgentStatus.sinceMs) }) }}
              </NText>

              <div v-if="chatStore.agentSteps.get(currentAgentId)?.length" class="chat-agent-steps">
                <div v-for="(step, index) in chatStore.agentSteps.get(currentAgentId)" :key="`step-${step.ts}-${index}`" class="chat-agent-step">
                  <span class="chat-agent-step__time">{{ formatClock(step.ts) }}</span>
                  <span class="chat-agent-step__label">{{ step.label }}</span>
                </div>
              </div>

              <div v-if="currentToolProgress" class="chat-tool-progress">
                <div class="chat-tool-progress__title">
                  <span>{{ t('pages.chat.agentDetails.tool', { name: currentToolProgress.name }) }}</span>
                  <span v-if="currentToolProgress.meta" class="chat-tool-progress__meta">{{ currentToolProgress.meta }}</span>
                </div>
                <div class="chat-tool-progress__kv">
                  <span class="chat-tool-progress__k">{{ t('pages.chat.structured.callId') }}</span>
                  <code class="chat-tool-progress__v">{{ currentToolProgress.toolCallId }}</code>
                  <span class="chat-tool-progress__k">{{ t('pages.chat.agentDetails.phase') }}</span>
                  <code class="chat-tool-progress__v">{{ currentToolProgress.phase }}</code>
                  <span class="chat-tool-progress__k">{{ t('pages.chat.agentDetails.elapsed') }}</span>
                  <code class="chat-tool-progress__v">
                    {{ formatDurationMs(toolElapsedMs) }}
                  </code>
                </div>

                <details v-if="currentToolProgress.argsPreview" class="tool-call-details">
                  <summary>{{ t('pages.chat.structured.viewArgs') }}</summary>
                  <pre>{{ currentToolProgress.argsPreview }}</pre>
                </details>

                <details v-if="currentToolProgress.partialPreview" class="tool-call-details">
                  <summary>{{ t('pages.chat.agentDetails.viewPartialResult') }}</summary>
                  <pre>{{ currentToolProgress.partialPreview }}</pre>
                </details>

                <details v-if="currentToolProgress.resultPreview" class="tool-call-details">
                  <summary>{{ t('pages.chat.agentDetails.viewResult') }}</summary>
                  <pre>{{ currentToolProgress.resultPreview }}</pre>
                </details>
              </div>
            </NSpace>
          </div>

          <div class="chat-actions">
            <NButton
              v-if="agentBusy"
              size="small"
              type="warning"
              secondary
              :loading="aborting"
              :disabled="aborting"
              @click="handleAbort"
            >
              <template #icon><NIcon :component="StopCircleOutline" /></template>
              {{ t('pages.chat.actions.stop') }}
            </NButton>
            <NButton size="small" type="primary" :loading="agentBusy" :disabled="agentBusy || !draft.trim()" @click="handleSend">
              <template #icon><NIcon :component="SendOutline" /></template>
              {{ t('pages.office.chat.send') }}
            </NButton>
          </div>
        </div>
      </template>
    </div>
  </NCard>

  <NModal
    v-model:show="showExpandedModal"
    preset="card"
    :title="t('pages.office.chat.expandedTitle')"
    :style="{ width: '90vw', maxWidth: '1400px', height: '85vh' }"
    :mask-closable="true"
    class="expanded-chat-modal"
  >
    <template #header-extra>
      <NButton size="small" quaternary @click="closeExpandedModal">
        <template #icon>
          <NIcon :component="ContractOutline" />
        </template>
      </NButton>
    </template>

    <div class="expanded-chat-content">
      <div v-if="!selectedSessionKey" class="chat-empty">
        <NEmpty :description="t('pages.office.chat.selectSession')" />
      </div>

      <template v-else>
        <NScrollbar ref="expandedScrollRef" class="expanded-chat-messages" @scroll="handleExpandedScroll">
          <div v-if="visibleMessageEntries.length === 0" class="chat-empty">
            <NEmpty :description="t('pages.office.chat.noMessages')" />
          </div>
          <div v-else class="message-list expanded">
            <div
              v-for="entry in visibleMessageEntries"
              :key="entry.key"
              class="chat-bubble"
              :class="`is-${entry.item.role}`"
            >
              <NSpace justify="space-between" align="center" class="chat-bubble-meta" :size="8">
                <NSpace align="center" :size="6">
                  <NTag size="small" :type="roleType(entry.item.role)" :bordered="false" round>
                    {{ roleLabel(entry.item.role) }}
                  </NTag>
                  <NText v-if="entry.item.name" depth="3" style="font-size: 12px;">
                    {{ entry.item.name }}
                  </NText>
                </NSpace>
                <NText v-if="entry.item.timestamp" depth="3" style="font-size: 12px;">
                  {{ formatDate(entry.item.timestamp) }}
                </NText>
              </NSpace>

              <div v-if="entry.structured" class="structured-message-list">
                <div v-if="entry.structured.toolCalls.length" class="tool-call-list">
                  <div
                    v-for="(tool, toolIndex) in entry.structured.toolCalls"
                    :key="`${entry.key}-tool-${toolIndex}`"
                    class="tool-call-card"
                  >
                    <NSpace align="center" justify="space-between">
                      <NSpace align="center" :size="6">
                        <NTag size="small" type="warning" :bordered="false" round>{{ t('pages.chat.structured.toolCall') }}</NTag>
                        <NText strong>{{ tool.name }}</NText>
                      </NSpace>
                      <NSpace align="center" :size="8">
                        <NText v-if="tool.timeout" depth="3" style="font-size: 12px;">
                          {{ t('pages.chat.structured.timeout', { seconds: tool.timeout }) }}
                        </NText>
                        <NButton
                          v-if="tool.argumentsJson"
                          size="tiny"
                          text
                          @click="toggleToolCallExpand(`${entry.key}-tool-${toolIndex}`)"
                        >
                          {{ expandedToolCalls.has(`${entry.key}-tool-${toolIndex}`) ? t('pages.chat.structured.hideArgs') : t('pages.chat.structured.viewArgs') }}
                        </NButton>
                      </NSpace>
                    </NSpace>

                    <div v-if="tool.command || tool.workdir" class="tool-call-meta">
                      <code v-if="tool.command" class="tool-call-meta__code">{{ tool.command }}</code>
                      <code v-if="tool.workdir" class="tool-call-meta__code">{{ tool.workdir }}</code>
                    </div>

                    <div v-if="tool.argumentsJson && expandedToolCalls.has(`${entry.key}-tool-${toolIndex}`)" class="tool-call-args">
                      <pre class="tool-call-args__content">{{ tool.argumentsJson }}</pre>
                    </div>
                  </div>
                </div>

                <div v-if="entry.structured.toolResults.length" class="tool-result-list">
                  <div
                    v-for="(result, resultIndex) in entry.structured.toolResults"
                    :key="`${entry.key}-tool-result-${resultIndex}`"
                    class="tool-result-card"
                  >
                    <NSpace align="center" justify="space-between">
                      <NSpace align="center" :size="6">
                        <NTag size="small" type="success" :bordered="false" round>{{ t('pages.chat.structured.toolResult') }}</NTag>
                        <NText strong>{{ result.name || 'unknown' }}</NText>
                      </NSpace>
                      <NSpace align="center" :size="8">
                        <NText v-if="result.status" depth="3" style="font-size: 12px;">
                          {{ result.status }}
                        </NText>
                        <NButton
                          size="tiny"
                          text
                          @click="toggleToolResultExpand(`${entry.key}-result-${resultIndex}`)"
                        >
                          {{ expandedToolResults.has(`${entry.key}-result-${resultIndex}`) ? t('pages.chat.structured.hideArgs') : t('pages.chat.structured.viewArgs') }}
                        </NButton>
                      </NSpace>
                    </NSpace>

                    <div v-if="expandedToolResults.has(`${entry.key}-result-${resultIndex}`)" class="tool-call-grid">
                      <span class="tool-call-label">{{ t('pages.chat.structured.callId') }}</span>
                      <div class="tool-call-value-wrapper">
                        <code>{{ result.id || '-' }}</code>
                        <NTooltip>
                          <template #trigger>
                            <NButton quaternary size="tiny" class="tool-value-copy-btn" @click="copyToClipboard(result.id || '-')">
                              <template #icon>
                                <NIcon :component="CopyOutline" />
                              </template>
                            </NButton>
                          </template>
                          {{ t('common.copy') }}
                        </NTooltip>
                      </div>
                      <span class="tool-call-label">{{ t('pages.chat.structured.content') }}</span>
                      <div class="tool-call-value-wrapper tool-result-content-wrapper">
                        <pre class="tool-result-content">{{ result.content }}</pre>
                        <NTooltip>
                          <template #trigger>
                            <NButton quaternary size="tiny" class="tool-value-copy-btn" @click="copyToClipboard(result.content)">
                              <template #icon>
                                <NIcon :component="CopyOutline" />
                              </template>
                            </NButton>
                          </template>
                          {{ t('common.copy') }}
                        </NTooltip>
                      </div>
                    </div>
                  </div>
                </div>

                <div v-if="entry.structured.plainTexts.length" class="chat-bubble-content-wrapper">
                  <div
                    class="chat-bubble-content structured-plain-text chat-markdown"
                    v-html="renderChatMarkdown(entry.structured.plainTexts.join('\n'), entry.item.role)"
                  ></div>
                  <div class="chat-content-copy-btn">
                    <NTooltip>
                      <template #trigger>
                        <NButton quaternary size="tiny" @click="copyMessageContent(entry)">
                          <template #icon>
                            <NIcon :component="CopyOutline" />
                          </template>
                        </NButton>
                      </template>
                      {{ t('common.copy') }}
                    </NTooltip>
                  </div>
                </div>

                <div v-if="entry.structured.images.length" class="chat-images-container">
                  <div
                    v-for="(img, imgIndex) in entry.structured.images"
                    :key="`${entry.key}-img-${imgIndex}`"
                    class="chat-image-wrapper"
                  >
                    <img
                      v-if="img.url"
                      :src="img.url"
                      class="chat-image"
                      loading="lazy"
                      @click="openImagePreview(img.url)"
                    />
                    <span v-else class="chat-image-placeholder">{{ t('pages.chat.image.unavailable') }}</span>
                  </div>
                </div>
              </div>

              <div v-else class="chat-bubble-content-wrapper">
                <div
                  class="chat-bubble-content chat-markdown"
                  v-html="renderChatMarkdown(entry.item.content, entry.item.role)"
                ></div>
                <div class="chat-content-copy-btn">
                  <NTooltip>
                    <template #trigger>
                      <NButton quaternary size="tiny" @click="copyMessageContent(entry)">
                        <template #icon>
                          <NIcon :component="CopyOutline" />
                        </template>
                      </NButton>
                    </template>
                    {{ t('common.copy') }}
                  </NTooltip>
                </div>
              </div>
            </div>
          </div>
        </NScrollbar>

        <div class="chat-input expanded">
          <NInput
            v-model:value="draft"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 6 }"
            :placeholder="t('pages.office.chat.inputPlaceholder')"
            @keydown="handleDraftKeydown"
          />

          <div v-if="slashMode" class="chat-slash-panel">
            <div class="chat-slash-head">
              <NText depth="3" style="font-size: 12px;">{{ t('pages.chat.slash.title') }}</NText>
              <NText depth="3" style="font-size: 12px;">{{ t('pages.chat.slash.hint') }}</NText>
            </div>
            <div v-if="slashSuggestions.length" class="chat-slash-list">
              <button
                v-for="(item, index) in slashSuggestions"
                :key="item.key"
                class="chat-slash-item"
                :class="{ 'is-active': index === selectedSlashCommandIndex }"
                type="button"
                @mouseenter="selectedSlashCommandIndex = index"
                @mousedown.prevent
                @click="applySlashSuggestion(item)"
              >
                <div v-if="item.kind === 'command' && item.preset">
                  <div class="chat-slash-line">
                    <span class="chat-slash-command">{{ item.preset.command }}</span>
                    <span v-if="item.preset.usage" class="chat-slash-usage">{{ item.preset.usage }}</span>
                    <NTag size="tiny" :bordered="false" round>{{ item.preset.category }}</NTag>
                  </div>
                  <div class="chat-slash-line chat-slash-desc">
                    <span>{{ item.preset.description }}</span>
                  </div>
                </div>
                <div v-else-if="item.kind === 'skill' && item.skill">
                  <div class="chat-slash-line">
                    <span class="chat-slash-command">/skill {{ item.skill.name }}</span>
                    <NTag size="tiny" type="success" :bordered="false" round>
                      {{ skillSourceLabel(item.skill.source) }}
                    </NTag>
                  </div>
                  <div v-if="item.skill.description" class="chat-slash-line chat-slash-desc">
                    <span>{{ item.skill.description }}</span>
                  </div>
                </div>
                <div v-else-if="item.kind === 'subagents-subcommand' && item.subagentsSubcommand">
                  <div class="chat-slash-line">
                    <span class="chat-slash-command">/subagents {{ item.subagentsSubcommand.subcommand }}</span>
                    <span v-if="item.subagentsSubcommand.usage" class="chat-slash-usage">{{ item.subagentsSubcommand.usage }}</span>
                  </div>
                  <div class="chat-slash-line chat-slash-desc">
                    <span>{{ item.subagentsSubcommand.description }}</span>
                  </div>
                </div>
                <div v-else-if="item.kind === 'model' && item.model">
                  <div class="chat-slash-line">
                    <span class="chat-slash-command">/model {{ item.model.modelRef }}</span>
                  </div>
                  <div class="chat-slash-line chat-slash-desc">
                    <span>{{ item.model.providerId }} / {{ item.model.modelId }}</span>
                  </div>
                </div>
                <div v-else-if="item.kind === 'new-default'">
                  <div class="chat-slash-line">
                    <span class="chat-slash-command">/new</span>
                    <NTag size="tiny" type="info" :bordered="false" round>
                      {{ t('pages.chat.slash.commands.new.defaultLabel') }}
                    </NTag>
                  </div>
                  <div class="chat-slash-line chat-slash-desc">
                    <span>{{ t('pages.chat.slash.commands.new.defaultDesc') }}</span>
                  </div>
                </div>
                <div v-else-if="item.kind === 'new-model' && item.model">
                  <div class="chat-slash-line">
                    <span class="chat-slash-command">/new {{ item.model.modelRef }}</span>
                  </div>
                  <div class="chat-slash-line chat-slash-desc">
                    <span>{{ item.model.providerId }} / {{ item.model.modelId }}</span>
                  </div>
                </div>
              </button>
            </div>
            <div v-else class="chat-slash-empty">
              <NText depth="3" style="font-size: 12px;">{{ t('pages.chat.slash.noMatch') }}</NText>
            </div>
          </div>
          <div class="chat-compose-status-line">
            <NTag
              size="small"
              :type="agentStatusTagType"
              :bordered="false"
              round
              class="chat-agent-status-tag"
            >
              {{ agentStatusText }}
            </NTag>
            <NButton
              v-if="hasAgentDetails"
              size="tiny"
              text
              @click="showAgentDetails = !showAgentDetails"
            >
              {{ showAgentDetails ? t('pages.chat.agentDetails.hide') : t('pages.chat.agentDetails.show') }}
            </NButton>
          </div>

          <div v-if="showAgentDetails && hasAgentDetails" class="chat-agent-details">
            <NSpace vertical :size="6">
              <NText depth="3" style="font-size: 12px;">
                {{ t('pages.chat.agentDetails.phaseDuration', { duration: formatDurationMs(nowMs - currentAgentStatus.sinceMs) }) }}
              </NText>

              <div v-if="chatStore.agentSteps.get(currentAgentId)?.length" class="chat-agent-steps">
                <div v-for="(step, index) in chatStore.agentSteps.get(currentAgentId)" :key="`step-${step.ts}-${index}`" class="chat-agent-step">
                  <span class="chat-agent-step__time">{{ formatClock(step.ts) }}</span>
                  <span class="chat-agent-step__label">{{ step.label }}</span>
                </div>
              </div>

              <div v-if="currentToolProgress" class="chat-tool-progress">
                <div class="chat-tool-progress__title">
                  <span>{{ t('pages.chat.agentDetails.tool', { name: currentToolProgress.name }) }}</span>
                </div>
                <div class="chat-tool-progress__kv">
                  <span class="chat-tool-progress__k">{{ t('pages.chat.structured.callId') }}</span>
                  <code class="chat-tool-progress__v">{{ currentToolProgress.toolCallId }}</code>
                  <span class="chat-tool-progress__k">{{ t('pages.chat.agentDetails.phase') }}</span>
                  <code class="chat-tool-progress__v">{{ currentToolProgress.phase }}</code>
                  <span class="chat-tool-progress__k">{{ t('pages.chat.agentDetails.elapsed') }}</span>
                  <code class="chat-tool-progress__v">{{ formatDurationMs(toolElapsedMs) }}</code>
                </div>

                <details v-if="currentToolProgress.argsPreview" class="tool-call-details">
                  <summary>{{ t('pages.chat.structured.viewArgs') }}</summary>
                  <pre>{{ currentToolProgress.argsPreview }}</pre>
                </details>

                <details v-if="currentToolProgress.resultPreview" class="tool-call-details">
                  <summary>{{ t('pages.chat.agentDetails.viewResult') }}</summary>
                  <pre>{{ currentToolProgress.resultPreview }}</pre>
                </details>
              </div>
            </NSpace>
          </div>

          <div class="chat-actions">
            <NButton
              v-if="agentBusy"
              size="small"
              type="warning"
              secondary
              :loading="aborting"
              :disabled="aborting"
              @click="handleAbort"
            >
              <template #icon><NIcon :component="StopCircleOutline" /></template>
              {{ t('pages.chat.actions.stop') }}
            </NButton>
            <NButton size="small" type="primary" :loading="agentBusy" :disabled="agentBusy || !draft.trim()" @click="handleSend">
              <template #icon><NIcon :component="SendOutline" /></template>
              {{ t('pages.office.chat.send') }}
            </NButton>
          </div>
        </div>
      </template>
    </div>
  </NModal>

  <NModal
    v-model:show="showQuickReplyModal"
    preset="card"
    :title="quickReplyModalMode === 'edit'
      ? t('pages.chat.quickReplies.modal.editTitle')
      : t('pages.chat.quickReplies.modal.createTitle')"
    style="width: 500px; max-width: calc(100vw - 28px);"
  >
    <NForm label-placement="left" label-width="72">
      <NFormItem :label="t('pages.chat.quickReplies.modal.title')" required>
        <NInput v-model:value="quickReplyForm.title" :placeholder="t('pages.chat.quickReplies.modal.titlePlaceholder')" />
      </NFormItem>
      <NFormItem :label="t('pages.chat.quickReplies.modal.content')" required>
        <NInput
          v-model:value="quickReplyForm.content"
          type="textarea"
          :autosize="{ minRows: 4, maxRows: 10 }"
          :placeholder="t('pages.chat.quickReplies.modal.contentPlaceholder')"
        />
      </NFormItem>
    </NForm>
    <template #footer>
      <NSpace justify="end">
        <NButton @click="showQuickReplyModal = false">{{ t('common.cancel') }}</NButton>
        <NButton type="primary" @click="handleSaveQuickReply">
          {{ quickReplyModalMode === 'edit'
            ? t('pages.chat.quickReplies.modal.saveChanges')
            : t('pages.chat.quickReplies.add') }}
        </NButton>
      </NSpace>
    </template>
  </NModal>

  <NModal
    v-model:show="showImagePreviewModal"
    preset="card"
    :title="t('pages.chat.image.preview')"
    style="width: 90vw; max-width: 1200px;"
    :mask-closable="true"
    @update:show="(val: boolean) => { if (!val) closeImagePreview() }"
  >
    <div v-if="imagePreviewUrl" class="image-preview-container">
      <img :src="imagePreviewUrl" class="image-preview-full" />
    </div>
  </NModal>
</template>

<style scoped>
.chat-panel-card {
  height: 1432px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.chat-panel-card :deep(.n-card__content) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding-bottom: 0 !important;
}

.chat-panel-card :deep(.n-card-header) {
  flex-wrap: wrap;
  min-width: 0;
}

.chat-panel-card :deep(.n-card-header__main) {
  flex: 0 0 100%;
  max-width: 100%;
}

.chat-panel-card :deep(.n-card-header__extra) {
  flex: 0 0 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  margin-top: 4px;
}

.session-tag {
  max-width: 200px;
  overflow: hidden;
}

.session-tag__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
}

.chat-token-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.chat-token-chip.n-tag {
  border-radius: 999px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 11px;
}

.chat-token-chip--total.n-tag {
  background: rgba(32, 128, 240, 0.12);
}

.chat-token-chip--loading.n-tag {
  border: 1px dashed var(--border-color);
}

.chat-token-chip__label {
  color: var(--text-secondary);
  margin-right: 3px;
}

.chat-token-chip__value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.chat-slash-panel {
  margin-top: 8px;
  padding: 8px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  border: 1px solid var(--border-color);
}

.chat-slash-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.chat-slash-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
}

.chat-slash-item {
  display: block;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}

.chat-slash-item:hover,
.chat-slash-item.is-active {
  background: rgba(24, 160, 88, 0.1);
}

.chat-slash-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chat-slash-command {
  font-weight: 600;
  font-size: 13px;
  color: #fff;
}

.chat-slash-usage {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}

.chat-slash-desc {
  margin-top: 4px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}

.chat-slash-empty {
  padding: 12px;
  text-align: center;
}

.chat-quick-collapse {
  margin-top: 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  background: var(--bg-primary);
}

.chat-quick-collapse :deep(.n-collapse-item__header-main) {
  font-weight: 600;
  font-size: 12px;
}

.chat-quick-collapse :deep(.n-collapse-item__content-wrapper) {
  padding: 0 10px 10px;
}

.chat-quick-list {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 160px;
  overflow-y: auto;
  padding-right: 2px;
}

.chat-quick-item {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 6px 8px;
  background: var(--bg-secondary);
}

.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.chat-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.active-tasks-bar {
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  margin-bottom: 8px;
}

.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.message-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 8px 0;
}

.message-list.expanded {
  gap: 20px;
}

.chat-bubble {
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
}

.chat-bubble.is-user {
  background: rgba(24, 160, 88, 0.08);
}

.chat-bubble.is-assistant {
  background: rgba(32, 128, 240, 0.06);
}

.chat-bubble.is-tool {
  background: rgba(245, 158, 11, 0.06);
}

.chat-bubble-meta {
  margin-bottom: 8px;
}

.chat-bubble-content-wrapper {
  position: relative;
}

.chat-bubble-content {
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.chat-bubble-content.structured-plain-text {
  margin-top: 8px;
}

.chat-content-copy-btn {
  position: absolute;
  top: 0;
  right: 0;
  opacity: 0;
  transition: opacity 0.2s;
}

.chat-bubble-content-wrapper:hover .chat-content-copy-btn {
  opacity: 1;
}

.structured-message-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tool-call-list,
.tool-result-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tool-call-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}

.tool-call-args {
  margin-top: 8px;
}

.tool-call-details {
  margin-top: 8px;
  font-size: 12px;
}

.tool-call-details summary {
  cursor: pointer;
  color: var(--text-secondary);
}

.tool-call-details pre {
  font-size: 11px;
  margin: 8px 0 0;
  padding: 8px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  overflow-x: auto;
  max-height: 200px;
}

.tool-call-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 12px;
  margin-top: 8px;
  font-size: 12px;
}

.tool-call-label {
  color: var(--text-secondary);
}

.tool-call-value-wrapper {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.tool-call-value-wrapper code {
  font-size: 11px;
  word-break: break-all;
}

.tool-value-copy-btn {
  flex-shrink: 0;
}

.tool-result-content-wrapper {
  grid-column: 1 / -1;
}

.tool-result-content {
  font-size: 11px;
  margin: 0;
  padding: 8px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  overflow-x: auto;
  max-height: 300px;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-input {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chat-input.expanded {
  margin-top: 16px;
}

.chat-compose-status-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chat-agent-status-tag {
  font-size: 12px;
}

.chat-agent-details {
  padding: 10px 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  font-size: 12px;
}

.chat-agent-steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}

.chat-agent-step {
  display: flex;
  gap: 8px;
  font-size: 11px;
}

.chat-agent-step__time {
  color: var(--text-secondary);
  font-family: monospace;
}

.chat-agent-step__label {
  color: var(--text-primary);
}

.chat-tool-progress {
  margin-top: 8px;
  padding: 8px;
  background: var(--bg-tertiary);
  border-radius: var(--radius);
}

.chat-tool-progress__title {
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 6px;
}

.chat-tool-progress__meta {
  margin-left: 8px;
  color: var(--text-secondary);
}

.chat-tool-progress__kv {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  font-size: 11px;
}

.chat-tool-progress__k {
  color: var(--text-secondary);
}

.chat-tool-progress__v {
  font-family: monospace;
}

.chat-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.expanded-chat-modal :deep(.n-card__content) {
  padding: 0;
}

.expanded-chat-content {
  display: flex;
  flex-direction: column;
  height: calc(85vh - 120px);
  padding: 16px;
}

.expanded-chat-messages {
  flex: 1;
  min-height: 0;
}

.chat-markdown {
  white-space: normal;
  font-size: 12.5px;
  line-height: 1.72;
  word-break: break-word;
  overflow-wrap: break-word;
}

.chat-markdown :deep(> :first-child) {
  margin-top: 0;
}

.chat-markdown :deep(> :last-child) {
  margin-bottom: 0;
}

.chat-markdown :deep(h1),
.chat-markdown :deep(h2),
.chat-markdown :deep(h3),
.chat-markdown :deep(h4),
.chat-markdown :deep(h5),
.chat-markdown :deep(h6) {
  margin: 16px 0 4px;
  line-height: 1.4;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.chat-markdown :deep(h1) { font-size: 1.25em; }
.chat-markdown :deep(h2) { font-size: 1.12em; }
.chat-markdown :deep(h3) { font-size: 1.02em; }

.chat-markdown :deep(p) {
  margin: 4px 0;
  line-height: 1.72;
}

.chat-markdown :deep(table) {
  width: 100%;
  margin: 8px 0;
  border-collapse: separate;
  border-spacing: 0;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
}

.chat-markdown :deep(th),
.chat-markdown :deep(td) {
  padding: 10px 12px;
  border-right: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  vertical-align: top;
  text-align: left;
}

.chat-markdown :deep(th) {
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-weight: 600;
}

.chat-markdown :deep(th:last-child),
.chat-markdown :deep(td:last-child) {
  border-right: none;
}

.chat-markdown :deep(tr:last-child > td) {
  border-bottom: none;
}

.chat-markdown :deep(ul) {
  margin: 4px 0;
  padding-left: 1.1em;
  list-style: none;
}

.chat-markdown :deep(ul > li) {
  position: relative;
  margin: 2px 0;
  line-height: 1.72;
}

.chat-markdown :deep(ul > li::before) {
  content: '';
  position: absolute;
  left: -0.88em;
  top: 0.58em;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--md-bullet-color);
}

.chat-markdown :deep(ul ul) {
  margin: 1px 0 1px 0.15em;
}

.chat-markdown :deep(ul ul > li::before) {
  width: 3.5px;
  height: 3.5px;
  background: transparent;
  border: 1px solid var(--md-bullet-nested-color);
  top: 0.62em;
}

.chat-markdown :deep(ul ul ul > li::before) {
  width: 3px;
  height: 3px;
  border: none;
  background: var(--md-bullet-nested-color);
  border-radius: 0;
}

.chat-markdown :deep(ol) {
  margin: 4px 0;
  padding-left: 1.5em;
  list-style-position: outside;
}

.chat-markdown :deep(ol > li) {
  margin: 2px 0;
  line-height: 1.72;
}

.chat-markdown :deep(ol > li::marker) {
  color: var(--md-bullet-color);
  font-size: 0.9em;
  font-weight: 500;
}

.chat-markdown :deep(a) {
  color: var(--link-color);
  text-decoration: none;
  font-weight: 500;
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
  transition: color 0.12s ease, text-decoration-color 0.12s ease;
  text-decoration-line: underline;
  text-decoration-color: var(--link-underline);
}

.chat-markdown :deep(a:hover) {
  color: var(--link-color-hover);
  text-decoration-color: var(--link-color-hover);
}

.chat-markdown :deep(blockquote) {
  margin: 6px 0;
  padding: 4px 10px;
  border-left: 2.5px solid var(--md-blockquote-border);
  border-radius: 0 4px 4px 0;
  background: var(--md-blockquote-bg);
}

.chat-markdown :deep(blockquote p) {
  margin: 2px 0;
  color: var(--text-secondary);
  font-size: 0.94em;
}

.chat-markdown :deep(pre) {
  margin: 6px 0;
  padding: 9px 11px;
  border-radius: 6px;
  border: 1px solid var(--md-code-border);
  background: var(--md-pre-bg);
  overflow-x: auto;
  line-height: 1.52;
}

.chat-markdown :deep(code) {
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, monospace;
  font-size: 0.87em;
}

.chat-markdown :deep(p code),
.chat-markdown :deep(li code),
.chat-markdown :deep(td code),
.chat-markdown :deep(th code) {
  padding: 0.5px 4.5px;
  border-radius: 3px;
  border: 1px solid var(--md-code-border);
  background: var(--md-code-bg);
}

/* —— 代码块容器（带行号） —— */
.chat-markdown :deep(.code-block-container) {
  display: flex;
  position: relative;
  margin: 6px 0;
  border-radius: 6px;
  border: 1px solid var(--md-code-border);
  background: var(--md-pre-bg);
  overflow-x: auto;
}

.chat-markdown :deep(.code-block-container pre) {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  overflow: visible;
}

.chat-markdown :deep(.code-line-numbers) {
  display: flex;
  flex-direction: column;
  padding: 10px 8px;
  background: rgba(0, 0, 0, 0.03);
  border-right: 1px solid var(--md-code-border);
  text-align: right;
  user-select: none;
  min-width: 40px;
}

.chat-markdown :deep(.line-number) {
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, monospace;
  font-size: 0.87em;
  line-height: 1.52;
  color: var(--text-tertiary);
  padding: 0 4px;
}

.chat-markdown :deep(.code-content) {
  flex: 1;
  padding: 10px 12px;
  overflow-x: auto;
  min-width: 0;
}

.chat-markdown :deep(.code-content code) {
  display: block;
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, monospace;
  font-size: 0.87em;
  line-height: 1.52;
  white-space: pre;
}

.chat-markdown :deep(.code-copy-btn) {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 4px 6px;
  border: 1px solid var(--md-code-border);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease;
}

.chat-markdown :deep(.code-block-container:hover .code-copy-btn) {
  opacity: 1;
}

.chat-markdown :deep(.code-copy-btn:hover) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.chat-markdown :deep(.code-copy-btn.copied) {
  color: var(--link-color);
}

.chat-markdown :deep(hr) {
  border: 0;
  height: 1px;
  background: var(--border-color);
  margin: 10px 0;
}

.chat-markdown :deep(strong) {
  font-weight: 600;
}

.chat-markdown :deep(em) {
  font-style: italic;
}

.structured-plain-text {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px dashed var(--border-color);
  background: var(--bg-primary);
}

.tool-call-card {
  border: 1px solid rgba(250, 173, 20, 0.35);
  border-radius: 8px;
  background: rgba(250, 173, 20, 0.08);
  padding: 10px;
}

.tool-result-card {
  border: 1px solid rgba(24, 160, 88, 0.35);
  border-radius: 8px;
  background: rgba(24, 160, 88, 0.08);
  padding: 10px;
}

.validation-error-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.validation-error-card {
  border: 1px solid rgba(250, 173, 20, 0.45);
  border-radius: 8px;
  background: rgba(250, 173, 20, 0.08);
  padding: 10px;
}

.validation-issues {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.55;
}

.tool-call-args__content {
  margin: 0;
  padding: 10px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow: auto;
}

.tool-call-meta__code {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-primary);
  line-height: 1.5;
  word-break: break-all;
}

.tool-result-content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.55;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
}

.chat-images-container {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.chat-image-wrapper {
  max-width: 300px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.chat-image {
  display: block;
  max-width: 100%;
  max-height: 300px;
  object-fit: contain;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.chat-image:hover {
  transform: scale(1.02);
}

.chat-image-placeholder {
  display: block;
  padding: 16px;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: center;
}

.image-preview-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
}

.image-preview-full {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
  border-radius: 8px;
}
</style>
