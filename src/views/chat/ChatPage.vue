<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
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
  NSpin,
  NSwitch,
  NTag,
  NText,
  NTooltip,
  useMessage,
} from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import { CopyOutline, RefreshOutline, SendOutline, StopCircleOutline, ChevronBackOutline, ChevronForwardOutline, VolumeHighOutline, StopOutline } from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useChatStore } from '@/stores/chat'
import { useConfigStore } from '@/stores/config'
import { useSessionStore } from '@/stores/session'
import { useSkillStore } from '@/stores/skill'
import { useWebSocketStore } from '@/stores/websocket'
import { formatDate, formatRelativeTime, parseSessionKey, truncate } from '@/utils/format'
import { renderSimpleMarkdown } from '@/utils/markdown'
import { useEdgeTTS } from '@/composables/useEdgeTTS'
import { useTTSSettings } from '@/composables/useTTSSettings'
import type { AgentInstance, ChatMessage, ChatMessageContent, SessionsUsageSession, Skill } from '@/api/types'

const message = useMessage()
const route = useRoute()
const router = useRouter()
const chatStore = useChatStore()
const configStore = useConfigStore()
const sessionStore = useSessionStore()
const skillStore = useSkillStore()
const wsStore = useWebSocketStore()
const { t, locale } = useI18n()

const sessionKeyInput = ref('')
const draft = ref('')
const roleFilter = ref<'all' | 'user' | 'assistant' | 'system'>('all')
const autoFollowBottom = ref(true)
const transcriptRef = ref<HTMLElement | null>(null)
const quickReplySearch = ref('')
const showQuickReplyModal = ref(false)
const quickReplyModalMode = ref<'create' | 'edit'>('create')
const editingQuickReplyId = ref('')
const quickReplyForm = reactive({
  title: '',
  content: '',
})
const showAgentDetails = ref(false)
const aborting = ref(false)
const nowMs = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | null = null

// 侧边栏折叠状态
const sideCollapsed = ref(false)

const roleFilterOptions = computed<SelectOption[]>(() => [
  { label: t('pages.chat.filters.roles.all'), value: 'all' },
  { label: t('pages.chat.filters.roles.user'), value: 'user' },
  { label: t('pages.chat.filters.roles.assistant'), value: 'assistant' },
  { label: t('pages.chat.filters.roles.system'), value: 'system' },
])

const BOTTOM_GAP = 32
const QUICK_REPLY_STORAGE_KEY = 'openclaw_chat_quick_replies_v1'
const SESSION_KEY_STORAGE_KEY = 'openclaw_chat_selected_session_v1'
let pendingForceScroll = false
let pendingScroll = false
let destroyed = false
const quickReplies = ref<Array<{
  id: string
  title: string
  content: string
  updatedAt: number
}>>([])

const expandedToolCalls = ref(new Set<string>())
const expandedToolResults = ref(new Set<string>())

// TTS state
const playingMessageId = ref<string | null>(null)
const { speak: ttsSpeak, stop: ttsStop, isPlaying: ttsIsPlaying, isLoading: ttsIsLoading } = useEdgeTTS({
  voice: 'zh-CN',
})
const { settings: ttsSettings } = useTTSSettings()
const lastPlayedMessageId = ref<string | null>(null)

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

// ---- Text-to-Speech ----

function stopTTS() {
  ttsStop()
  playingMessageId.value = null
}

async function playTTS(msg: ChatMessage) {
  const content = msg.content || ''
  if (!content.trim()) return

  // If already playing this message, stop it
  if (playingMessageId.value === msg.id) {
    stopTTS()
    return
  }

  // Stop any current playback
  stopTTS()

  try {
    playingMessageId.value = msg.id || null

    // Use TTS settings from local storage
    const voice = ttsSettings.value.voice || 'zh-CN'
    const rate = ttsSettings.value.rate ?? 1.0
    const volume = ttsSettings.value.volume ?? 1.0
    const pitch = ttsSettings.value.pitch ?? 1.0

    // Use Web Speech API TTS
    await ttsSpeak(content, { voice, rate, volume, pitch })
  } catch (err) {
    console.error('[ChatPage] TTS error:', err)
    message.error(t('pages.chat.tts.error'))
    stopTTS()
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

const sessionOptions = computed(() => {
  const seen = new Set<string>()
  const options = sessionStore.sessions
    .map((session) => {
      const key = session.key.trim()
      return {
        key,
        label: session.label,
      }
    })
    .filter((item) => {
      if (!item.key || seen.has(item.key)) return false
      seen.add(item.key)
      return true
    })
    .map((item) => ({
      label: item.label ? `${item.label} (${item.key})` : item.key,
      value: item.key,
    }))

  return options
})

const normalizedSessionKey = computed(() => {
  const input = sessionKeyInput.value.trim()
  if (input) return input
  const firstSession = sessionStore.sessions[0]
  return firstSession?.key || ''
})
const selectedSession = computed(() =>
  sessionStore.sessions.find((session) => session.key === normalizedSessionKey.value) || null
)
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
  const found = sessions.find((item) => item.key === normalized)
  return found || null
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

    sessionTokenUsage.value = createSessionTokenUsage({
      input: usageSession.usage.input,
      output: usageSession.usage.output,
      cacheRead: usageSession.usage.cacheRead,
      cacheWrite: usageSession.usage.cacheWrite,
      total: usageSession.usage.totalTokens,
    })
  } catch (error) {
    if (requestId !== sessionTokenUsageRequestId) return
    sessionTokenUsage.value = null
    console.warn('[ChatPage] 获取会话 token 用量失败:', error)
  } finally {
    if (requestId === sessionTokenUsageRequestId) {
      sessionTokenUsageLoading.value = false
    }
  }
}

const sessionMeta = computed(() => parseSessionKey(normalizedSessionKey.value))
const sessionChannelDisplay = computed(() => {
  const channel = selectedSession.value?.channel?.trim().toLowerCase() || ''
  const parsedChannel = sessionMeta.value.channel?.trim().toLowerCase() || ''
  const isGeneric = (value: string) => !value || value === 'main' || value === 'unknown'

  if (!isGeneric(parsedChannel) && isGeneric(channel)) return parsedChannel
  if (!isGeneric(channel)) return channel
  if (parsedChannel && parsedChannel !== 'unknown') return parsedChannel
  return 'main'
})

const messageList = computed(() => chatStore.messages)
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
      
      const { images: extractedImages, cleanedText } = extractImageFromText(contentText)
      images.push(...extractedImages)
      
      toolResults.push({
        id: part.id,
        name: part.name || 'unknown',
        status: part.isError ? 'error' : undefined,
        content: cleanedText,
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
      if (structured && (structured.toolCalls.length > 0 || structured.thinkings.length > 0 || structured.toolResults.length > 0 || structured.plainTexts.length > 0 || structured.images.length > 0)) {
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

interface SlashCommandPreset {
  command: string
  usage?: string
  description: string
  category: string
  aliases?: string[]
  expectArgs?: boolean
  requiresFlag?: string
}

type SubagentsSubcommand = 'list' | 'kill' | 'log' | 'info' | 'send' | 'steer' | 'spawn'

interface SubagentsSubcommandPreset {
  subcommand: SubagentsSubcommand
  usage?: string
  description: string
}

interface ConfiguredModelOption {
  modelRef: string
  providerId: string
  modelId: string
}

interface SlashSuggestionItem {
  kind: 'command' | 'skill' | 'model' | 'new-model' | 'new-default' | 'subagents-subcommand' | 'subagents-agent'
  key: string
  preset?: SlashCommandPreset
  subagentsSubcommand?: SubagentsSubcommandPreset
  agent?: AgentInstance
  skill?: Skill
  model?: ConfiguredModelOption
}

// 基于 OpenClaw 官方 docs/tools/slash-commands.md 维护的常用命令清单
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
const transcriptLoading = computed(() => chatStore.loading && messageList.value.length === 0)
const refreshingChatData = computed(() => sessionStore.loading || chatStore.loading)
const syncHint = computed(() => {
  if (chatStore.syncing) return t('pages.chat.sync.syncing')
  if (chatStore.lastSyncedAt) {
    return t('pages.chat.sync.syncedAt', { time: formatDate(chatStore.lastSyncedAt) })
  }
  return t('pages.chat.sync.notSynced')
})
const syncTagType = computed<'default' | 'success' | 'warning' | 'info'>(() => {
  if (chatStore.syncing) return 'info'
  if (chatStore.lastError) return 'warning'
  if (chatStore.lastSyncedAt) return 'success'
  return 'default'
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

const currentToolProgress = computed(() => {
  return chatStore.toolProgress.get(currentAgentId.value) || null
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
  return new Date(ts).toLocaleTimeString(locale.value, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
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

const stats = computed(() => {
  const list = visibleMessageEntries.value
  let user = 0
  let assistant = 0
  let system = 0

  for (const entry of list) {
    const item = entry.item
    if (item.role === 'user') user += 1
    else if (item.role === 'assistant') assistant += 1
    else if (item.role === 'system') system += 1
  }

  const last = list.length > 0 ? list[list.length - 1]?.item : null
  return {
    total: list.length,
    user,
    assistant,
    system,
    lastMessageAt: last?.timestamp ? formatRelativeTime(last.timestamp) : '-',
  }
})

const renderedMessages = computed<RenderMessage[]>(() => {
  const role = roleFilter.value
  if (role === 'all') return visibleMessageEntries.value
  return visibleMessageEntries.value.filter((entry) => entry.item.role === role)
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

const selectedSlashCommandIndex = ref(0)
const slashFirstLine = computed(() => (draft.value.split('\n')[0] || '').trimStart())
const slashMode = computed(() => slashFirstLine.value.startsWith('/'))
const slashHasArgs = computed(() => {
  if (!slashMode.value) return false
  const content = slashFirstLine.value.slice(1)
  return /[\s:]/.test(content)
})
const slashCommandKeyword = computed(() => {
  if (!slashMode.value) return ''
  const content = slashFirstLine.value.slice(1)
  const token = content.split(/[\s:]/)[0] || ''
  return token.toLowerCase()
})
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
const slashNewMode = computed(() => slashMode.value && slashCommandKeyword.value === 'new')
const slashSkillMode = computed(() => slashMode.value && slashCommandKeyword.value === 'skill')
const slashModelMode = computed(() =>
  slashMode.value && (slashCommandKeyword.value === 'model' || slashCommandKeyword.value === 'models')
)
const slashSubagentsMode = computed(() => slashMode.value && slashCommandKeyword.value === 'subagents')

function skillSourceLabel(source: Skill['source']): string {
  if (source === 'workspace') return t('pages.skills.sources.workspace')
  if (source === 'managed') return t('pages.skills.sources.managed')
  if (source === 'extra') return t('pages.skills.sources.extra')
  return t('pages.skills.sources.bundled')
}

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

const slashSkillNameQuery = computed(() => {
  if (!slashSkillMode.value) return ''
  const args = normalizeSlashArguments(slashFirstLine.value)
  const firstToken = args.split(/\s+/)[0] || ''
  return firstToken.toLowerCase()
})

const slashSkillOptions = computed<Skill[]>(() => {
  if (!slashSkillMode.value) return []
  const query = slashSkillNameQuery.value
  if (!query) return availableSkills.value
  return availableSkills.value.filter((skill) =>
    [skill.name, skill.description || ''].some((field) => field.toLowerCase().includes(query))
  )
})

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

function extractProviderModelIds(value: unknown): string[] {
  if (!value) return []

  if (Array.isArray(value)) {
    const ids: string[] = []
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) {
        ids.push(item.trim())
        continue
      }
      const row = asRecord(item)
      if (!row) continue
      const id =
        (typeof row.id === 'string' && row.id.trim()) ||
        (typeof row.name === 'string' && row.name.trim()) ||
        ''
      if (id) ids.push(id)
    }
    return ids
  }

  const mapRow = asRecord(value)
  if (!mapRow) return []
  const ids: string[] = []
  for (const [key, item] of Object.entries(mapRow)) {
    const normalizedKey = key.trim()
    if (!normalizedKey) continue

    if (typeof item === 'string' && item.trim()) {
      ids.push(item.trim())
      continue
    }

    const row = asRecord(item)
    if (row) {
      const id =
        (typeof row.id === 'string' && row.id.trim()) ||
        (typeof row.name === 'string' && row.name.trim()) ||
        normalizedKey
      ids.push(id)
      continue
    }

    ids.push(normalizedKey)
  }
  return ids
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

const availableAgents = computed<AgentInstance[]>(() => {
  const list = configStore.config?.agents?.list || []
  const map = new Map<string, AgentInstance>()
  for (const agent of list) {
    const id = agent.id?.trim()
    if (!id) continue
    if (map.has(id)) continue
    map.set(id, { ...agent, id })
  }
  if (!map.has('main')) {
    map.set('main', { id: 'main' })
  }

  return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id))
})

function normalizeSubagentsSubcommand(value: string): SubagentsSubcommand | '' {
  const lowered = value.trim().toLowerCase()
  if (lowered === 'list') return 'list'
  if (lowered === 'kill') return 'kill'
  if (lowered === 'log') return 'log'
  if (lowered === 'info') return 'info'
  if (lowered === 'send') return 'send'
  if (lowered === 'steer') return 'steer'
  if (lowered === 'spawn') return 'spawn'
  return ''
}

const slashSubagentsArgs = computed(() => {
  if (!slashSubagentsMode.value) return ''
  return normalizeSlashArguments(slashFirstLine.value)
})

const slashSubagentsSubcommandQuery = computed(() => {
  const { first } = splitFirstToken(slashSubagentsArgs.value)
  return first.toLowerCase()
})

const slashSubagentsSubcommand = computed(() => normalizeSubagentsSubcommand(slashSubagentsSubcommandQuery.value))

const slashSubagentsSubcommandOptions = computed<SubagentsSubcommandPreset[]>(() => {
  if (!slashSubagentsMode.value) return []
  const query = slashSubagentsSubcommandQuery.value
  const presets = subagentsSubcommandPresets.value
  if (!query) return presets
  return presets.filter((preset) => preset.subcommand.includes(query))
})

const slashSubagentsSpawnAgentQuery = computed(() => {
  if (!slashSubagentsMode.value) return ''
  if (slashSubagentsSubcommand.value !== 'spawn') return ''
  const { rest } = splitFirstToken(slashSubagentsArgs.value)
  const { first } = splitFirstToken(rest)
  return first.toLowerCase()
})

const slashSubagentsSpawnAgentOptions = computed<AgentInstance[]>(() => {
  if (!slashSubagentsMode.value) return []
  if (slashSubagentsSubcommand.value !== 'spawn') return []
  const query = slashSubagentsSpawnAgentQuery.value
  if (!query) return availableAgents.value
  return availableAgents.value.filter((agent) => agent.id.toLowerCase().includes(query))
})

const slashSuggestions = computed<SlashSuggestionItem[]>(() => {
  if (!slashMode.value) return []
  if (slashSubagentsMode.value) {
    if (slashSubagentsSubcommand.value === 'spawn') {
      return slashSubagentsSpawnAgentOptions.value.map((agent) => ({
        kind: 'subagents-agent',
        key: `subagents-spawn-agent-${agent.id}`,
        agent,
      }))
    }
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

const eventCleanups: Array<() => void> = []

function ensureSessionKey(): string {
  const normalized = sessionKeyInput.value.trim() || 'main'
  sessionKeyInput.value = normalized
  return normalized
}

function readStoredSessionKey(): string {
  try {
    return localStorage.getItem(SESSION_KEY_STORAGE_KEY)?.trim() || ''
  } catch (error) {
    console.warn('[ChatPage] 读取上次会话失败:', error)
    return ''
  }
}

function writeStoredSessionKey(key: string) {
  const normalized = key.trim()
  if (!normalized) return
  try {
    localStorage.setItem(SESSION_KEY_STORAGE_KEY, normalized)
  } catch (error) {
    console.warn('[ChatPage] 保存上次会话失败:', error)
  }
}

async function loadHistoryForKey(rawKey: string, options?: { force?: boolean }) {
  const key = rawKey.trim() || 'main'
  sessionKeyInput.value = key
  writeStoredSessionKey(key)

  const shouldSkip =
    !options?.force &&
    key === chatStore.sessionKey &&
    !chatStore.loading &&
    !chatStore.syncing
  if (shouldSkip) return

  chatStore.setSessionKey(key)
  void fetchSessionTokenUsage(key)
  await chatStore.fetchHistory(key)
  await nextTick()
  autoFollowBottom.value = true
  requestScrollToBottom({ force: true })
}

function normalizeSessionSelectValue(value: string | number | null | undefined): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value).trim()
  return ''
}

function handleSessionKeyChange(value: string | number | null) {
  const key = normalizeSessionSelectValue(value) || 'main'
  sessionKeyInput.value = key
  void loadHistoryForKey(key, { force: true })
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
  if (/(^|[\s(（\[{【'"“‘])\*[^*\n]+\*(?=$|[\s)\]）}】'".,!?，。！？：:、”’])/u.test(text)) return true
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

function isNearBottom(): boolean {
  const el = transcriptRef.value
  if (!el) return true
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight
  return distance <= BOTTOM_GAP
}

function handleTranscriptScroll() {
  autoFollowBottom.value = isNearBottom()
}

function looksLikeStreamingPayload(payload: unknown): boolean {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: payload, depth: 0 }]
  const visited = new Set<unknown>()
  const maxDepth = 4

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    if (current.depth > maxDepth) continue

    const value = current.value
    if (!value || typeof value !== 'object') continue
    if (visited.has(value)) continue
    visited.add(value)

    if (!Array.isArray(value)) {
      const row = value as Record<string, unknown>
      if (
        'delta' in row ||
        'chunk' in row ||
        'partial' in row ||
        'stream' in row ||
        'streaming' in row
      ) {
        return true
      }
      const kind = typeof row.type === 'string' ? row.type.toLowerCase() : ''
      if (kind.includes('delta') || kind.includes('chunk') || kind.includes('stream')) {
        return true
      }

      for (const child of Object.values(row)) {
        if (child && typeof child === 'object') {
          queue.push({ value: child, depth: current.depth + 1 })
        }
      }
      continue
    }

    for (const child of value) {
      if (child && typeof child === 'object') {
        queue.push({ value: child, depth: current.depth + 1 })
      }
    }
  }

  return false
}

function scrollToBottom(options?: { force?: boolean }) {
  const el = transcriptRef.value
  if (!el) return

  const force = options?.force ?? false
  if (!force && !autoFollowBottom.value) return

  el.scrollTop = el.scrollHeight
}

function requestScrollToBottom(options?: { force?: boolean }) {
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
    scrollToBottom({ force: forceNow })
  })
}

function cancelPendingScroll() {
  destroyed = true
  pendingForceScroll = false
  pendingScroll = false
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
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
      .filter((item) => !!item.trim())
      .join('\n')
  }
  const row = asRecord(value)
  if (row) {
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
  return ''
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
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
      if (ch === '\\\\') {
        escaped = true
        continue
      }
      if (ch === '\"') {
        inString = false
      }
      continue
    }

    if (ch === '\"') {
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
  const images: ImageItemView[] = []
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
      // 仅有签名而没有思考文本时，通常是内部元信息；若同条消息还有正文，就不额外占用版面
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

  // 检查plainLines中是否包含图片名称（delivery-mirror类型消息）
  const imagePlainTexts: string[] = []
  for (const line of parsed.plainLines) {
    const { images: extractedImages, cleanedText } = extractImageFromText(line)
    images.push(...extractedImages)
    
    const trimmedLine = cleanedText.trim()
    if (trimmedLine.match(/\.(png|jpg|jpeg|gif|webp|bmp)$/i)) {
      const imageUrl = `/api/media?path=${encodeURIComponent(trimmedLine)}`
      images.push({
        mimeType: `image/${trimmedLine.split('.').pop()?.toLowerCase() || 'png'}`,
        url: imageUrl,
      })
    } else if (trimmedLine) {
      imagePlainTexts.push(cleanedText)
    }
  }

  if (!recognized && images.length === 0) return null
  return {
    toolCalls,
    thinkings,
    toolResults,
    validationErrors: [],
    plainTexts: imagePlainTexts,
    images,
  }
}

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

function normalizeSlashArguments(line: string): string {
  const trimmed = line.trimStart()
  const matched = trimmed.match(/^\/[^\s:]+(?::|\s+)?(.*)$/)
  if (!matched) return ''
  return matched[1]?.trim() || ''
}

function splitFirstToken(value: string): { first: string; rest: string } {
  const text = value.trim()
  if (!text) return { first: '', rest: '' }
  const parts = text.split(/\s+/)
  const [first = '', ...rest] = parts
  return {
    first,
    rest: rest.join(' '),
  }
}

function buildSlashCommandLine(command: SlashCommandPreset): string {
  const args = normalizeSlashArguments(slashFirstLine.value)
  if (args) return `${command.command} ${args}`
  if (command.expectArgs) return `${command.command} `
  return command.command
}

function applySlashCommand(command: SlashCommandPreset) {
  const lines = draft.value.split('\n')
  lines[0] = buildSlashCommandLine(command)
  draft.value = lines.join('\n')
}

function applySlashSkill(skill: Skill) {
  const lines = draft.value.split('\n')
  const args = normalizeSlashArguments(slashFirstLine.value)
  const { rest } = splitFirstToken(args)
  lines[0] = rest ? `/skill ${skill.name} ${rest}` : `/skill ${skill.name} `
  draft.value = lines.join('\n')
}

function applySlashModel(model: ConfiguredModelOption) {
  const lines = draft.value.split('\n')
  const args = normalizeSlashArguments(slashFirstLine.value)
  const { rest } = splitFirstToken(args)
  const modelRef = model.modelRef
  lines[0] = rest ? `/model ${modelRef} ${rest}` : `/model ${modelRef}`
  draft.value = lines.join('\n')
}

function applySlashNewModel(model: ConfiguredModelOption) {
  const lines = draft.value.split('\n')
  const args = normalizeSlashArguments(slashFirstLine.value)
  const { rest } = splitFirstToken(args)
  const modelRef = model.modelRef
  lines[0] = rest ? `/new ${modelRef} ${rest}` : `/new ${modelRef}`
  draft.value = lines.join('\n')
}

function applySlashNewDefault() {
  const lines = draft.value.split('\n')
  lines[0] = '/new'
  draft.value = lines.join('\n')
}

function applySlashSubagentsSubcommand(preset: SubagentsSubcommandPreset) {
  const lines = draft.value.split('\n')
  const args = slashSubagentsArgs.value
  const { rest } = splitFirstToken(args)

  const base = `/subagents ${preset.subcommand}`
  if (rest) {
    lines[0] = `${base} ${rest}`
    draft.value = lines.join('\n')
    return
  }

  if (preset.subcommand === 'list') {
    lines[0] = base
  } else {
    lines[0] = `${base} `
  }
  draft.value = lines.join('\n')
}

function applySlashSubagentsSpawnAgent(agentId: string) {
  const id = agentId.trim()
  if (!id) return

  const lines = draft.value.split('\n')
  const args = slashSubagentsArgs.value
  const { first: subcommand, rest } = splitFirstToken(args)
  const normalizedSubcommand = normalizeSubagentsSubcommand(subcommand)
  if (normalizedSubcommand !== 'spawn') return

  const { rest: restAfterAgent } = splitFirstToken(rest)
  lines[0] = restAfterAgent
    ? `/subagents spawn ${id} ${restAfterAgent}`
    : `/subagents spawn ${id} `
  draft.value = lines.join('\n')
}

function applySlashSuggestion(item: SlashSuggestionItem) {
  if (item.kind === 'subagents-subcommand' && item.subagentsSubcommand) {
    applySlashSubagentsSubcommand(item.subagentsSubcommand)
    return
  }
  if (item.kind === 'subagents-agent' && item.agent) {
    applySlashSubagentsSpawnAgent(item.agent.id)
    return
  }
  if (item.kind === 'skill' && item.skill) {
    applySlashSkill(item.skill)
    return
  }
  if (item.kind === 'model' && item.model) {
    applySlashModel(item.model)
    return
  }
  if (item.kind === 'new-model' && item.model) {
    applySlashNewModel(item.model)
    return
  }
  if (item.kind === 'new-default') {
    applySlashNewDefault()
    return
  }
  if (item.kind === 'command' && item.preset) {
    applySlashCommand(item.preset)
  }
}

function moveSlashSuggestionSelection(step: number) {
  const size = slashSuggestions.value.length
  if (!size) return
  selectedSlashCommandIndex.value = (selectedSlashCommandIndex.value + step + size) % size
}

async function handleDraftKeydown(event: KeyboardEvent) {
  const isEnter = event.key === 'Enter'
  const canSend = !event.shiftKey && !event.isComposing

  if (slashMode.value && slashSuggestions.value.length > 0) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveSlashSuggestionSelection(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveSlashSuggestionSelection(-1)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const item = activeSlashSuggestion.value
      if (item) {
        applySlashSuggestion(item)
      }
      return
    }
    if (isEnter && canSend) {
      event.preventDefault()
      const item = activeSlashSuggestion.value
      if (!item) return

      if (item.kind === 'skill' && item.skill) {
        const args = normalizeSlashArguments(slashFirstLine.value)
        const { first } = splitFirstToken(args)
        if (first && first.toLowerCase() === item.skill.name.toLowerCase()) {
          await handleSend()
          return
        }
        applySlashSkill(item.skill)
        return
      }

      if (item.kind === 'model' && item.model) {
        const args = normalizeSlashArguments(slashFirstLine.value)
        const { first } = splitFirstToken(args)
        const modelRef = item.model.modelRef.toLowerCase()
        if (first && first.toLowerCase() === modelRef) {
          await handleSend()
          return
        }
        applySlashModel(item.model)
        return
      }

      if (item.kind === 'new-model' && item.model) {
        const args = normalizeSlashArguments(slashFirstLine.value)
        const { first } = splitFirstToken(args)
        const modelRef = item.model.modelRef.toLowerCase()
        if (first && first.toLowerCase() === modelRef) {
          await handleSend()
          return
        }
        applySlashNewModel(item.model)
        return
      }

      if (item.kind === 'new-default') {
        const args = normalizeSlashArguments(slashFirstLine.value)
        if (!args) {
          await handleSend()
          return
        }
        applySlashNewDefault()
        return
      }

      if (item.kind === 'subagents-subcommand' && item.subagentsSubcommand) {
        const args = normalizeSlashArguments(slashFirstLine.value)
        const { first } = splitFirstToken(args)
        if (first && first.toLowerCase() === item.subagentsSubcommand.subcommand) {
          await handleSend()
          return
        }
        applySlashSubagentsSubcommand(item.subagentsSubcommand)
        return
      }

      if (item.kind === 'subagents-agent' && item.agent) {
        const args = normalizeSlashArguments(slashFirstLine.value)
        const { first: sub, rest } = splitFirstToken(args)
        if (normalizeSubagentsSubcommand(sub) !== 'spawn') {
          applySlashSubagentsSpawnAgent(item.agent.id)
          return
        }
        const { first: agentId } = splitFirstToken(rest)
        if (agentId && agentId.toLowerCase() === item.agent.id.toLowerCase()) {
          await handleSend()
          return
        }
        applySlashSubagentsSpawnAgent(item.agent.id)
        return
      }

      if (item.kind === 'command' && item.preset) {
        if (!slashHasArgs.value) {
          const exact = slashFirstLine.value.trim() === item.preset.command
          if (exact) {
            await handleSend()
            return
          }
          applySlashCommand(item.preset)
          return
        }
        await handleSend()
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      draft.value = draft.value.replace(/^\s*\/+/, '')
      return
    }
  }

  if ((event.metaKey || event.ctrlKey) && isEnter) {
    event.preventDefault()
    await handleSend()
    return
  }

  if (isEnter && canSend) {
    event.preventDefault()
    await handleSend()
  }
}

watch(
  slashSuggestions,
  (list) => {
    if (!list.length) {
      selectedSlashCommandIndex.value = 0
      return
    }
    if (selectedSlashCommandIndex.value >= list.length) {
      selectedSlashCommandIndex.value = 0
    }
  },
  { immediate: true }
)

watch(slashMode, (value) => {
  if (value) {
    selectedSlashCommandIndex.value = 0
  }
})

watch(slashCommandKeyword, () => {
  selectedSlashCommandIndex.value = 0
})

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
  void configStore.fetchConfig()
  void skillStore.fetchSkills()
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
          name.includes('partial') ||
          looksLikeStreamingPayload(data.payload)
        chatStore.handleAgentStatusEvent(eventName, data.payload)
        chatStore.handleRealtimeEvent(data.payload, {
          refreshHistory: false,
          streaming: isStreamingEvent,
        })
      }
    })
  )

  await sessionStore.fetchSessions()
  const routeSessionKey = normalizeSessionSelectValue(
    Array.isArray(route.query.session) ? route.query.session[0] : (route.query.session as string | number | null)
  )
  const currentStoreKey = chatStore.sessionKey.trim()
  const storedSessionKey = readStoredSessionKey()
  if (!sessionKeyInput.value && routeSessionKey) {
    sessionKeyInput.value = routeSessionKey
  }
  if (!sessionKeyInput.value && currentStoreKey) {
    sessionKeyInput.value = currentStoreKey
  }
  if (!sessionKeyInput.value && storedSessionKey) {
    sessionKeyInput.value = storedSessionKey
  }

  const firstSession = sessionStore.sessions[0]
  if (!sessionKeyInput.value && firstSession) {
    sessionKeyInput.value = firstSession.key
  }

  await loadHistoryForKey(ensureSessionKey(), { force: true })
})

onUnmounted(() => {
  eventCleanups.forEach((cleanup) => cleanup())
  chatStore.clearTimers()
  cancelPendingScroll()
  sessionTokenUsageRequestId += 1
  if (nowTimer) {
    clearInterval(nowTimer)
    nowTimer = null
  }
  document.removeEventListener('click', handleCodeCopy)
  // Stop TTS playback
  stopTTS()
})

// ---- Auto Play TTS for new assistant messages ----

watch(
  () => chatStore.messages,
  (messages) => {
    // Check if auto-play is enabled
    if (!ttsSettings.value.autoPlay || !ttsSettings.value.enabled) return
    
    // Find the last assistant message
    const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant')
    if (!lastAssistantMsg?.id) return
    
    // Skip if already played or currently playing
    if (lastPlayedMessageId.value === lastAssistantMsg.id) return
    if (playingMessageId.value === lastAssistantMsg.id) return
    
    // Skip if currently streaming
    if (chatStore.sending) return
    
    // Play the message
    console.log('[ChatPage] Auto-playing TTS for message:', lastAssistantMsg.id)
    lastPlayedMessageId.value = lastAssistantMsg.id
    playTTS(lastAssistantMsg)
  },
  { deep: true }
)

async function handleRefreshChatData() {
  await sessionStore.fetchSessions()
  await loadHistoryForKey(ensureSessionKey(), { force: true })
}

async function handleSend() {
  const content = draft.value.trim()
  if (!content) return
  if (agentBusy.value) return

  try {
    const key = ensureSessionKey()
    chatStore.setSessionKey(key)
    await chatStore.sendMessage(content)
    void fetchSessionTokenUsage(key)
    draft.value = ''
    await nextTick()
    autoFollowBottom.value = true
    requestScrollToBottom({ force: true })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    message.error(reason)
  }
}
</script>

<template>
  <div class="chat-page">
    <NCard :title="t('pages.chat.title')" class="app-card chat-root-card">
      <template #header-extra>
        <NSpace :size="8" class="app-toolbar">
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
          <NTag v-else size="small" :bordered="false" round class="chat-token-chip chat-token-chip--loading">
            {{ sessionTokenStatusText }}
          </NTag>
          <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" :loading="refreshingChatData" @click="handleRefreshChatData">
            <template #icon><NIcon :component="RefreshOutline" /></template>
            {{ t('pages.chat.actions.refreshChat') }}
          </NButton>
        </NSpace>
      </template>

      <NGrid cols="1 l:3" responsive="screen" :x-gap="12" :y-gap="12" class="chat-grid" :class="{ 'chat-grid--collapsed': sideCollapsed }">
        <NGridItem :span="1" class="chat-grid-side" :class="{ 'chat-grid-side--collapsed': sideCollapsed }">
          <!-- 折叠按钮 -->
          <div class="chat-side-collapse-btn" @click="sideCollapsed = !sideCollapsed">
            <NIcon :component="ChevronBackOutline" size="14" />
          </div>
          
          <NCard v-show="!sideCollapsed" embedded :bordered="false" class="chat-side-card">
            <NSpace vertical :size="12">
              <div class="chat-side-stats">
                <div class="chat-stat-item">
                  <span class="chat-stat-label">{{ t('pages.chat.stats.total') }}</span>
                  <strong>{{ stats.total }}</strong>
                </div>
                <div class="chat-stat-item">
                  <span class="chat-stat-label">{{ t('pages.chat.stats.assistant') }}</span>
                  <strong>{{ stats.assistant }}</strong>
                </div>
                <div class="chat-stat-item">
                  <span class="chat-stat-label">{{ t('pages.chat.stats.lastMessage') }}</span>
                  <strong>{{ stats.lastMessageAt }}</strong>
                </div>
              </div>

              <div>
                <NText depth="3" style="font-size: 12px;">{{ t('pages.chat.sessionKey') }}</NText>
                <NSelect
                  v-model:value="sessionKeyInput"
                  :options="sessionOptions"
                  filterable
                  tag
                  :placeholder="t('pages.chat.sessionKeyPlaceholder')"
                  style="min-width: 240px; margin-top: 6px;"
                  @update:value="handleSessionKeyChange"
                />
              </div>

              <div class="chat-quick-panel">
                <NSpace justify="space-between" align="center">
                  <NText strong>{{ t('pages.chat.quickReplies.title') }}</NText>
                  <NButton size="tiny" type="primary" secondary @click="openCreateQuickReply">{{ t('pages.chat.quickReplies.add') }}</NButton>
                </NSpace>
                <NInput
                  v-model:value="quickReplySearch"
                  size="small"
                  style="margin-top: 8px;"
                  :placeholder="t('pages.chat.quickReplies.searchPlaceholder')"
                />

                <div v-if="filteredQuickReplies.length" class="chat-quick-list">
                  <div v-for="item in filteredQuickReplies" :key="item.id" class="chat-quick-item">
                    <NSpace justify="space-between" align="start" :wrap="false">
                      <div style="min-width: 0; flex: 1;">
                        <NText strong>{{ item.title }}</NText>
                        <NText depth="3" style="display: block; font-size: 12px; margin-top: 4px;">
                          {{ truncate(item.content, 78) }}
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
                <NEmpty v-else :description="t('pages.chat.quickReplies.empty')" style="padding: 14px 0 8px;" />

                <div class="chat-quick-footnote">
                  <NText depth="3" style="font-size: 12px;">
                    {{ t('pages.chat.quickReplies.storageHint') }}
                  </NText>
                  <NText depth="3" style="display: block; font-size: 12px; margin-top: 4px;">
                    {{ t('pages.chat.quickReplies.dirLabel') }}<code>{{ workspaceQuickReplyDir }}</code>
                  </NText>
                  <NButton size="tiny" text @click="handleCopyWorkspaceDir" style="margin-top: 4px;">
                    {{ t('pages.chat.quickReplies.copyDir') }}
                  </NButton>
                </div>
              </div>

              <div class="chat-side-switches">
                <NSpace justify="space-between" align="center">
                  <NText>{{ t('pages.chat.preferences.autoFollow') }}</NText>
                  <NSwitch v-model:value="autoFollowBottom" />
                </NSpace>
                <NSpace justify="space-between" align="center" style="margin-top: 8px;">
                  <NText>{{ t('pages.chat.preferences.autoPlay') }}</NText>
                  <NSwitch v-model:value="ttsSettings.autoPlay" />
                </NSpace>
                <NSpace justify="space-between" align="center" style="margin-top: 8px;">
                  <NText>{{ t('pages.chat.filters.title') }}</NText>
                  <NSelect
                    v-model:value="roleFilter"
                    size="small"
                    :options="roleFilterOptions"
                    style="width: 132px;"
                  />
                </NSpace>
              </div>

              <div class="chat-side-kv">
                <div v-if="selectedSession?.label" class="chat-kv-row">
                  <span>{{ t('pages.chat.session.label') }}</span>
                  <code class="chat-kv-label">{{ selectedSession.label }}</code>
                </div>
                <div class="chat-kv-row">
                  <span>Agent</span>
                  <code>{{ selectedSession?.agentId || sessionMeta.agent }}</code>
                </div>
                <div class="chat-kv-row">
                  <span>Channel</span>
                  <code>{{ sessionChannelDisplay }}</code>
                </div>
                <div class="chat-kv-row">
                  <span>Peer</span>
                  <code>{{ selectedSession?.peer || sessionMeta.peer || '-' }}</code>
                </div>
                <div class="chat-kv-row">
                  <span>{{ t('pages.chat.session.model') }}</span>
                  <code>{{ selectedSession?.model || '-' }}</code>
                </div>
              </div>
            </NSpace>
          </NCard>
        </NGridItem>

        <NGridItem :span="sideCollapsed ? 3 : 2" class="chat-grid-main">
          <!-- 展开按钮（侧边栏折叠时显示） -->
          <div v-if="sideCollapsed" class="chat-side-expand-btn" @click="sideCollapsed = false">
            <NIcon :component="ChevronForwardOutline" size="14" />
          </div>
          
          <div class="chat-main-column">
            <NCard embedded :bordered="false" class="chat-transcript-card">
              <NSpace justify="space-between" align="center" style="margin-bottom: 10px;">
                <NSpace align="center" :size="8">
                  <NTag size="small" type="info" :bordered="false" round>
                    {{ t('pages.chat.sessionTag', { key: normalizedSessionKey }) }}
                  </NTag>
                  <NTag size="small" :type="syncTagType" :bordered="false" round>
                    {{ syncHint }}
                  </NTag>
                </NSpace>
                <NText depth="3" style="font-size: 12px;">
                  {{ t('pages.chat.stats.breakdown', { user: stats.user, assistant: stats.assistant, system: stats.system }) }}
                </NText>
              </NSpace>

              <div class="chat-transcript-shell">
                <NSpin :show="transcriptLoading" class="chat-transcript-spin">
                  <div ref="transcriptRef" class="chat-transcript" @scroll="handleTranscriptScroll">
                    <template v-if="renderedMessages.length">
                      <div
                        v-for="entry in renderedMessages"
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

                          <div
                            v-if="entry.structured.plainTexts.length"
                            class="chat-bubble-content-wrapper"
                          >
                            <div class="chat-bubble-content structured-plain-text chat-markdown"
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
                              <NTooltip v-if="entry.item.role === 'user' || entry.item.role === 'assistant'">
                                <template #trigger>
                                  <NButton
                                    quaternary
                                    size="tiny"
                                    :loading="ttsIsLoading && playingMessageId === entry.item.id"
                                    @click="playTTS(entry.item)"
                                  >
                                    <template #icon>
                                      <NIcon :component="playingMessageId === entry.item.id ? StopOutline : VolumeHighOutline" />
                                    </template>
                                  </NButton>
                                </template>
                                {{ playingMessageId === entry.item.id ? t('pages.chat.tts.stop') : t('pages.chat.tts.play') }}
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
                            <NTooltip v-if="entry.item.role === 'user' || entry.item.role === 'assistant'">
                              <template #trigger>
                                <NButton
                                  quaternary
                                  size="tiny"
                                  :loading="ttsIsLoading && playingMessageId === entry.item.id"
                                  @click="playTTS(entry.item)"
                                >
                                  <template #icon>
                                    <NIcon :component="playingMessageId === entry.item.id ? StopOutline : VolumeHighOutline" />
                                  </template>
                                </NButton>
                              </template>
                              {{ playingMessageId === entry.item.id ? t('pages.chat.tts.stop') : t('pages.chat.tts.play') }}
                            </NTooltip>
                          </div>
                        </div>
                      </div>
                    </template>

                    <NEmpty
                      v-else
                      :description="visibleMessageEntries.length ? t('pages.chat.messages.emptyFiltered') : t('common.noMessages')"
                      style="padding: 72px 0;"
                    />
                  </div>
                </NSpin>
              </div>
            </NCard>

            <NCard embedded :bordered="false" class="chat-compose-card">
              <NSpace vertical :size="10">
                <NInput
                  v-model:value="draft"
                  type="textarea"
                  :autosize="{ minRows: 3, maxRows: 8 }"
                  :placeholder="t('pages.chat.input.placeholder')"
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
                          <span v-if="item.preset.requiresFlag" class="chat-slash-flag">
                            {{ t('pages.chat.slash.requiresFlag', { flag: item.preset.requiresFlag }) }}
                          </span>
                        </div>
                      </div>
                      <div v-else-if="item.kind === 'skill' && item.skill">
                        <div class="chat-slash-line">
                          <span class="chat-slash-command">/skill {{ item.skill.name }}</span>
                          <NTag size="tiny" type="success" :bordered="false" round>
                            {{ skillSourceLabel(item.skill.source) }}
                          </NTag>
                        </div>
                        <div class="chat-slash-line chat-slash-desc">
                          <span>{{ item.skill.description || t('common.noDescription') }}</span>
                          <span v-if="item.skill.version" class="chat-slash-flag">v{{ item.skill.version }}</span>
                        </div>
                      </div>
                      <div v-else-if="item.kind === 'model' && item.model">
                        <div class="chat-slash-line">
                          <span class="chat-slash-command">/model {{ item.model.modelRef }}</span>
                          <NTag size="tiny" type="info" :bordered="false" round>
                            {{ item.model.providerId }}
                          </NTag>
                        </div>
                        <div class="chat-slash-line chat-slash-desc">
                          <span>{{ item.model.modelId }}</span>
                          <span class="chat-slash-flag">{{ t('pages.chat.slash.fromConfig') }}</span>
                        </div>
                      </div>
                      <div v-else-if="item.kind === 'new-model' && item.model">
                        <div class="chat-slash-line">
                          <span class="chat-slash-command">/new {{ item.model.modelRef }}</span>
                          <NTag size="tiny" type="info" :bordered="false" round>
                            {{ item.model.providerId }}
                          </NTag>
                        </div>
                        <div class="chat-slash-line chat-slash-desc">
                          <span>{{ item.model.modelId }}</span>
                          <span class="chat-slash-flag">{{ t('pages.chat.slash.fromConfig') }}</span>
                        </div>
                      </div>
                      <div v-else-if="item.kind === 'subagents-subcommand' && item.subagentsSubcommand">
                        <div class="chat-slash-line">
                          <span class="chat-slash-command">/subagents {{ item.subagentsSubcommand.subcommand }}</span>
                          <span v-if="item.subagentsSubcommand.usage" class="chat-slash-usage">{{ item.subagentsSubcommand.usage }}</span>
                          <NTag size="tiny" type="info" :bordered="false" round>
                            subagents
                          </NTag>
                        </div>
                        <div class="chat-slash-line chat-slash-desc">
                          <span>{{ item.subagentsSubcommand.description }}</span>
                        </div>
                      </div>
                      <div v-else-if="item.kind === 'subagents-agent' && item.agent">
                        <div class="chat-slash-line">
                          <span class="chat-slash-command">{{ item.agent.id }}</span>
                          <NTag size="tiny" type="info" :bordered="false" round>
                            {{ t('pages.chat.slash.subagents.agentTag') }}
                          </NTag>
                        </div>
                        <div class="chat-slash-line chat-slash-desc">
                          <span>{{ item.agent.model?.primary || '-' }}</span>
                          <span class="chat-slash-flag">{{ t('pages.chat.slash.fromConfig') }}</span>
                        </div>
                      </div>
                      <div v-else-if="item.kind === 'new-default'">
                        <div class="chat-slash-line">
                          <span class="chat-slash-command">/new</span>
                          <NTag size="tiny" type="default" :bordered="false" round>
                            {{ t('pages.chat.slash.commands.new.defaultLabel') }}
                          </NTag>
                        </div>
                        <div class="chat-slash-line chat-slash-desc">
                          <span>{{ t('pages.chat.slash.commands.new.defaultDesc') }}</span>
                        </div>
                      </div>
                    </button>
                  </div>
                  <div v-else class="chat-slash-empty">
                    <template v-if="slashSkillMode">
                      {{ skillStore.loading ? t('pages.chat.slash.skills.loading') : t('pages.chat.slash.skills.noMatch') }}
                    </template>
                    <template v-else-if="slashSubagentsMode">
                      {{ configStore.loading ? t('pages.chat.slash.subagents.loading') : t('pages.chat.slash.subagents.noMatch') }}
                    </template>
                    <template v-else-if="slashModelMode || slashNewMode">
                      {{ configStore.loading ? t('pages.chat.slash.models.loading') : t('pages.chat.slash.models.noMatch') }}
                    </template>
                    <template v-else>
                      {{ t('pages.chat.slash.commands.noMatch') }}
                    </template>
                  </div>
                </div>

                <div class="chat-compose-status-line">
                  <NSpace align="center" justify="space-between" style="width: 100%;">
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
                  </NSpace>
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

                      <details v-if="currentToolProgress.argsPreview" class="chat-tool-progress__details">
                        <summary>{{ t('pages.chat.structured.viewArgs') }}</summary>
                        <pre>{{ currentToolProgress.argsPreview }}</pre>
                      </details>

                      <details v-if="currentToolProgress.partialPreview" class="chat-tool-progress__details">
                        <summary>{{ t('pages.chat.agentDetails.viewPartialResult') }}</summary>
                        <pre>{{ currentToolProgress.partialPreview }}</pre>
                      </details>

                      <details v-if="currentToolProgress.resultPreview" class="chat-tool-progress__details">
                        <summary>{{ t('pages.chat.agentDetails.viewResult') }}</summary>
                        <pre>{{ currentToolProgress.resultPreview }}</pre>
                      </details>

                      <NText
                        v-if="currentToolProgress.isError === true"
                        depth="3"
                        style="font-size: 12px; color: var(--danger-color);"
                      >
                        {{ t('pages.chat.agentDetails.toolFailed') }}
                      </NText>
                    </div>
                  </NSpace>
                </div>

                <NSpace justify="space-between" align="center">
                  <NText depth="3" style="font-size: 12px;">
                    {{ t('pages.chat.input.sendHint', { key: normalizedSessionKey }) }}
                  </NText>
                  <NSpace :size="8">
                    <NButton size="small" secondary :disabled="!draft" @click="draft = ''">
                      {{ t('pages.chat.actions.clearInput') }}
                    </NButton>
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
                    <NButton size="small" type="primary" :loading="agentBusy" :disabled="agentBusy" @click="handleSend">
                      <template #icon><NIcon :component="SendOutline" /></template>
                      {{ t('pages.chat.actions.send') }}
                    </NButton>
                  </NSpace>
                </NSpace>
              </NSpace>
            </NCard>
          </div>
        </NGridItem>
      </NGrid>

      <NAlert v-if="chatStore.lastError" type="error" :show-icon="true" style="margin-top: 12px; border-radius: var(--radius);">
        {{ chatStore.lastError }}
      </NAlert>
    </NCard>

    <NModal
      v-model:show="showQuickReplyModal"
      preset="card"
      :title="quickReplyModalMode === 'edit'
        ? t('pages.chat.quickReplies.modal.editTitle')
        : t('pages.chat.quickReplies.modal.createTitle')"
      style="width: 640px; max-width: calc(100vw - 28px);"
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
  </div>
</template>

<style scoped>
.chat-page {
  min-height: 0;
}

/* 桌面端：让聊天区尽量占满可用高度，提升 transcript 可视面积 */
@media (min-width: 1024px) {
  .chat-page {
    height: calc(100vh - var(--header-height) - 48px);
    display: flex;
    flex-direction: column;
  }

  :deep(.chat-root-card) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  :deep(.chat-root-card .n-card__content) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .chat-grid {
    flex: 1;
    min-height: 0;
    align-content: stretch;
  }

  .chat-grid-side,
  .chat-grid-main {
    min-height: 0;
    display: flex;
    position: relative;
  }

  /* 折叠按钮样式 */
  .chat-side-collapse-btn {
    position: absolute;
    right: -8px;
    top: 50%;
    transform: translateY(-50%);
    width: 16px;
    height: 48px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 0 4px 4px 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 10;
    transition: all 0.2s ease;
    opacity: 0.6;
  }

  .chat-side-collapse-btn:hover {
    background: var(--bg-secondary);
    opacity: 1;
  }

  /* 展开按钮样式（主内容区域左侧） */
  .chat-side-expand-btn {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 16px;
    height: 48px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 4px 0 0 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 10;
    transition: all 0.2s ease;
    opacity: 0.6;
  }

  .chat-side-expand-btn:hover {
    background: var(--bg-secondary);
    opacity: 1;
  }

  /* 侧边栏折叠状态 */
  .chat-grid-side--collapsed {
    width: 0 !important;
    min-width: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
    overflow: hidden;
  }

  .chat-grid-side--collapsed .chat-side-card {
    display: none;
  }

  .chat-grid-side--collapsed .chat-side-collapse-btn {
    display: none;
  }

  .chat-side-card {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .chat-main-column {
    flex: 1;
    min-height: 0;
  }
}

.chat-token-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.chat-token-chip.n-tag {
  border-radius: 999px;
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.chat-token-chip--total.n-tag {
  background: rgba(32, 128, 240, 0.12);
}

.chat-token-chip--loading.n-tag {
  border: 1px dashed var(--border-color);
}

.chat-token-chip__label {
  color: var(--text-secondary);
  margin-right: 4px;
}

.chat-token-chip__value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.chat-compose-status-line {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  min-width: 0;
}

.chat-agent-status-tag.n-tag {
  max-width: 360px;
}

.chat-agent-status-tag :deep(.n-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-agent-details {
  padding: 10px;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius);
  background: var(--bg-secondary);
}

.chat-agent-steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 160px;
  overflow: auto;
  padding-right: 2px;
}

.chat-agent-step {
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.chat-agent-step__time {
  min-width: 74px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-variant-numeric: tabular-nums;
  opacity: 0.9;
}

.chat-agent-step__label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-tool-progress__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
}

.chat-tool-progress__meta {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
}

.chat-tool-progress__kv {
  margin-top: 6px;
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 6px 10px;
  align-items: start;
}

.chat-tool-progress__k {
  font-size: 12px;
  color: var(--text-secondary);
}

.chat-tool-progress__v {
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  word-break: break-all;
}

.chat-tool-progress__details {
  margin-top: 8px;
}

.chat-tool-progress__details summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
}

.chat-tool-progress__details pre {
  margin-top: 6px;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  font-size: 12px;
  line-height: 1.5;
  overflow: auto;
  max-height: 240px;
}

.chat-side-card {
  border-radius: var(--radius);
}

.chat-main-column {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow: hidden;
}

.chat-side-switches,
.chat-side-stats,
.chat-side-kv,
.chat-quick-panel {
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  background: var(--bg-primary);
}

.chat-quick-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
  padding-right: 2px;
}

.chat-quick-item {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px;
  background: var(--bg-secondary);
}

.chat-quick-footnote {
  margin-top: 8px;
  border-top: 1px dashed var(--border-color);
  padding-top: 8px;
}

.chat-quick-footnote code {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-secondary);
  word-break: break-all;
}

.chat-side-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.chat-stat-item {
  padding: 8px;
  border-radius: 6px;
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chat-stat-item strong {
  font-size: 13px;
  line-height: 1.3;
}

.chat-stat-label {
  font-size: 11px;
  color: var(--text-secondary);
}

.chat-kv-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  font-size: 12px;
  border-bottom: 1px dashed var(--border-color);
}

.chat-kv-row:last-child {
  border-bottom: none;
}

.chat-kv-row code {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-secondary);
  word-break: break-all;
}

.chat-kv-label {
  font-style: italic;
  color: var(--text-secondary);
}

.chat-transcript-card,
.chat-compose-card {
  border-radius: var(--radius);
}

.chat-transcript-card {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

:deep(.chat-transcript-card .n-card__content) {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chat-transcript-shell {
  flex: 1;
  min-height: 0;
}

:deep(.chat-transcript-shell .n-spin-container),
:deep(.chat-transcript-shell .n-spin-content) {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chat-transcript {
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
  padding-bottom: 20px;
  overflow-anchor: none;
  overscroll-behavior: contain;
  background:
    radial-gradient(circle at top right, rgba(24, 160, 88, 0.06), transparent 30%),
    var(--bg-primary);
}

.chat-compose-card {
  flex-shrink: 0;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  box-shadow: var(--shadow-sm);
}

.chat-slash-panel {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-secondary);
  overflow: hidden;
}

.chat-slash-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px dashed var(--border-color);
}

.chat-slash-list {
  max-height: 240px;
  overflow-y: auto;
}

.chat-slash-item {
  width: 100%;
  text-align: left;
  border: 0;
  border-bottom: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-primary);
  padding: 8px 10px;
  cursor: pointer;
}

.chat-slash-item:last-child {
  border-bottom: 0;
}

.chat-slash-item:hover,
.chat-slash-item.is-active {
  background: rgba(24, 144, 255, 0.1);
}

.chat-slash-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.chat-slash-command {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, monospace;
  font-size: 13px;
  line-height: 1.45;
}

.chat-slash-usage {
  color: var(--text-secondary);
  font-size: 12px;
}

.chat-slash-desc {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 12px;
  justify-content: space-between;
}

.chat-slash-flag {
  color: var(--warning-color);
  white-space: nowrap;
}

.chat-slash-empty {
  padding: 12px 10px;
  color: var(--text-secondary);
  font-size: 12px;
}

.chat-bubble {
  position: relative;
  width: fit-content;
  max-width: min(840px, 88%);
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.chat-bubble-content-wrapper {
  position: relative;
}

.chat-content-copy-btn {
  position: absolute;
  top: 0;
  right: 0;
  opacity: 0;
  transition: opacity 0.2s ease;
  z-index: 10;
}

.chat-bubble-content-wrapper:hover .chat-content-copy-btn {
  opacity: 1;
}

.chat-bubble.is-user {
  margin-left: auto;
  border-color: rgba(24, 160, 88, 0.35);
  background: rgba(24, 160, 88, 0.09);
}

.chat-bubble.is-assistant {
  margin-right: auto;
  border-color: rgba(24, 144, 255, 0.3);
  background: rgba(24, 144, 255, 0.08);
}

.chat-bubble.is-tool {
  margin-right: auto;
  border-style: dashed;
}

.chat-bubble.is-system {
  margin: 0 auto 12px;
  border-style: dashed;
  background: rgba(250, 173, 20, 0.08);
}

.chat-bubble-meta {
  margin-bottom: 6px;
}

.chat-bubble-content {
  white-space: pre-wrap;
  line-height: 1.65;
  word-break: break-word;
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

/* —— 标题 —— */
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

/* —— 段落 —— */
.chat-markdown :deep(p) {
  margin: 4px 0;
  line-height: 1.72;
}

/* —— 表格（GFM） —— */
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

/* —— 无序列表 —— */
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

/* 嵌套列表 */
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

/* 三级列表 */
.chat-markdown :deep(ul ul ul > li::before) {
  width: 3px;
  height: 3px;
  border: none;
  background: var(--md-bullet-nested-color);
  border-radius: 0;
}

/* —— 有序列表 —— */
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

/* —— 链接 —— */
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

/* —— 引用块 —— */
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

/* —— 代码 —— */
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

/* —— 分割线 —— */
.chat-markdown :deep(hr) {
  border: 0;
  height: 1px;
  background: var(--border-color);
  margin: 10px 0;
}

/* —— 加粗/强调 —— */
.chat-markdown :deep(strong) {
  font-weight: 600;
}

.chat-markdown :deep(em) {
  font-style: italic;
}

.structured-message-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.structured-plain-text {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px dashed var(--border-color);
  background: var(--bg-primary);
}

.tool-call-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tool-call-card {
  border: 1px solid rgba(250, 173, 20, 0.35);
  border-radius: 8px;
  background: rgba(250, 173, 20, 0.08);
  padding: 10px;
}

.tool-call-args {
  margin-top: 10px;
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

.tool-call-meta {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tool-call-meta__code {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-primary);
  line-height: 1.5;
  word-break: break-all;
}

.tool-result-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tool-result-card {
  border: 1px solid rgba(24, 160, 88, 0.35);
  border-radius: 8px;
  background: rgba(24, 160, 88, 0.08);
  padding: 10px;
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

.tool-call-grid {
  margin-top: 8px;
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 6px 8px;
  align-items: start;
}

.tool-call-label {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.7;
}

.tool-call-grid code {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-primary);
  line-height: 1.5;
  word-break: break-all;
}

.tool-call-value-wrapper {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 4px;
}

.tool-value-copy-btn {
  opacity: 0;
  transition: opacity 0.2s ease;
  flex-shrink: 0;
}

.tool-call-value-wrapper:hover .tool-value-copy-btn {
  opacity: 1;
}

.tool-result-content-wrapper {
  flex-direction: column;
  align-items: stretch;
}

.tool-result-content-wrapper .tool-result-content {
  margin: 0;
}

.tool-result-content-wrapper .tool-value-copy-btn {
  position: absolute;
  top: 4px;
  right: 4px;
}

.tool-call-details {
  margin-top: 8px;
}

.tool-call-details summary {
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

.tool-call-details pre {
  margin-top: 6px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
}

body.wide-mode .chat-grid {
  display: grid !important;
  grid-template-columns: 460px 1fr !important;
  grid-template-rows: 1fr !important;
}

body.wide-mode .chat-grid--collapsed {
  grid-template-columns: 1fr !important;
}

body.wide-mode .chat-grid > div {
  grid-row: 1 !important;
}

body.wide-mode .chat-grid-side {
  max-width: 460px;
  flex-shrink: 0;
}

body.wide-mode .chat-grid-main {
  flex: 1;
  min-width: 0;
}

body.wide-mode .chat-bubble {
  max-width: min(1600px, 92%);
}

@media (max-width: 1200px) {
  .chat-side-card {
    min-height: auto;
  }

  .chat-main-column {
    height: auto;
    min-height: 0;
  }

  .chat-transcript {
    min-height: 320px;
    max-height: 52vh;
  }

}

@media (max-width: 640px) {
  .chat-side-stats {
    grid-template-columns: 1fr;
  }

  .chat-slash-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .chat-bubble {
    max-width: 96%;
  }

  .tool-call-grid {
    grid-template-columns: 1fr;
  }
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
