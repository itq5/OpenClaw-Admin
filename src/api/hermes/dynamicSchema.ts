import type { ConfigCategory, ConfigFieldSchema, ConfigFieldType } from './types'
import {
  MINIMAX_TTS_FORMAT_OPTIONS,
  MINIMAX_TTS_MODEL_OPTIONS,
  MINIMAX_TTS_REGION_OPTIONS,
} from './configSchema'

const CATEGORY_LABELS: Record<string, string> = {
  model: '模型',
  agent: 'Agent',
  terminal: '终端',
  memory: '记忆',
  compression: '压缩',
  browser: '浏览器',
  tts: 'TTS',
  stt: 'STT',
  voice: '语音',
  display: '显示',
  security: '安全',
  approvals: '审批',
  checkpoints: '检查点',
  logging: '日志',
  platforms: '平台',
  skills: '技能',
  cron: '定时任务',
  custom_providers: '自定义提供商',
  providers: '提供商',
}

const CATEGORY_ICONS: Record<string, string> = {
  model: 'cube',
  agent: 'robot',
  terminal: 'terminal',
  memory: 'brain',
  compression: 'compress',
  browser: 'globe',
  tts: 'volume-high',
  stt: 'mic',
  voice: 'mic',
  display: 'tv',
  security: 'shield-checkmark',
  approvals: 'checkmark-done',
  checkpoints: 'save',
  logging: 'list',
  platforms: 'chatbubbles',
  skills: 'construct',
  cron: 'time',
  custom_providers: 'server',
  providers: 'cloud',
}

const FIELD_LABELS: Record<string, string> = {
  model: '模型',
  file_read_max_chars: '文件读取最大字符数',
  timezone: '时区',
  'agent.max_turns': '最大轮次',
  'agent.gateway_timeout': '网关超时',
  'agent.verbose': '详细模式',
  'agent.reasoning_effort': '推理努力程度',
  'terminal.backend': '终端后端',
  'terminal.cwd': '工作目录',
  'terminal.timeout': '命令超时',
  'terminal.persistent_shell': '持久化 Shell',
  'terminal.docker_image': 'Docker 镜像',
  'terminal.container_cpu': '容器 CPU',
  'terminal.container_memory': '容器内存',
  'memory.memory_enabled': '启用记忆',
  'memory.user_profile_enabled': '启用用户画像',
  'memory.memory_char_limit': '记忆字符上限',
  'memory.user_char_limit': '用户画像字符上限',
  'memory.nudge_interval': '提示间隔',
  'compression.enabled': '启用压缩',
  'compression.threshold': '压缩阈值',
  'compression.target_ratio': '目标压缩比',
  'compression.protect_last_n': '保护最近消息数',
  'browser.inactivity_timeout': '不活动超时',
  'browser.command_timeout': '命令超时',
  'browser.record_sessions': '录制会话',
  'browser.allow_private_urls': '允许私有 URL',
  'tts.provider': 'TTS 提供商',
  'tts.edge.voice': 'Edge 语音',
  'tts.openai.model': 'OpenAI 模型',
  'tts.openai.voice': 'OpenAI 语音',
  'tts.minimax.model': 'MiniMax 模型',
  'tts.minimax.region': 'MiniMax 区域',
  'tts.minimax.voice_id': 'MiniMax 音色',
  'tts.minimax.format': 'MiniMax 音频格式',
  'tts.minimax.language_boost': 'MiniMax 语种增强',
  'stt.enabled': '启用 STT',
  'stt.provider': 'STT 提供商',
  'stt.local.model': '本地模型',
  'voice.record_key': '录音快捷键',
  'voice.max_recording_seconds': '最大录音时长',
  'voice.auto_tts': '自动 TTS',
  'voice.silence_threshold': '静音阈值',
  'voice.silence_duration': '静音持续时间',
  'display.compact': '紧凑模式',
  'display.personality': '人格',
  'display.streaming': '流式输出',
  'display.show_cost': '显示成本',
  'display.bell_on_complete': '完成时响铃',
  'security.redact_secrets': '脱敏密钥',
  'security.tirith_enabled': '启用 Tirith',
  'security.tirith_timeout': 'Tirith 超时',
  'security.tirith_fail_open': 'Tirith 失败开放',
  'approvals.mode': '审批模式',
  'approvals.timeout': '审批超时',
  'checkpoints.enabled': '启用检查点',
  'checkpoints.max_snapshots': '最大快照数',
  'logging.level': '日志级别',
  'logging.max_size_mb': '最大日志大小',
  'logging.backup_count': '备份数量',
}

const FIELD_DESCRIPTIONS: Record<string, string> = {
  model: '选择要使用的 AI 模型',
  file_read_max_chars: '单次读取文件的最大字符数',
  timezone: '设置时区',
  'agent.max_turns': 'Agent 最大执行轮次',
  'agent.gateway_timeout': '网关超时时间（秒）',
  'agent.verbose': '启用详细日志输出',
  'terminal.backend': '选择终端后端类型',
  'terminal.cwd': '终端的默认工作目录',
  'terminal.timeout': '命令执行超时时间（秒）',
  'terminal.persistent_shell': '保持 Shell 会话持久化',
  'memory.memory_enabled': '启用 AI 记忆功能',
  'compression.enabled': '启用上下文压缩功能',
  'browser.record_sessions': '录制浏览器会话',
  'stt.enabled': '启用语音转文字功能',
  'display.compact': '启用紧凑显示模式',
  'display.streaming': '启用流式输出',
  'security.redact_secrets': '在日志中脱敏敏感信息',
  'approvals.mode': '命令审批模式',
  'checkpoints.enabled': '启用会话检查点功能',
  'logging.level': '日志输出级别',
}

const SELECT_OPTIONS: Record<string, { value: string | number; label: string }[]> = {
  'terminal.backend': [
    { value: 'local', label: '本地终端' },
    { value: 'docker', label: 'Docker' },
    { value: 'singularity', label: 'Singularity' },
    { value: 'modal', label: 'Modal' },
    { value: 'daytona', label: 'Daytona' },
  ],
  'agent.reasoning_effort': [
    { value: 'low', label: '低' },
    { value: 'medium', label: '中' },
    { value: 'high', label: '高' },
  ],
  'tts.provider': [
    { value: 'edge', label: 'Edge TTS' },
    { value: 'openai', label: 'OpenAI TTS' },
    { value: 'elevenlabs', label: 'ElevenLabs' },
    { value: 'mistral', label: 'Mistral' },
    { value: 'minimax', label: 'MiniMax T2A' },
    { value: 'neutts', label: 'NeuTTS (本地)' },
  ],
  'tts.minimax.model': MINIMAX_TTS_MODEL_OPTIONS,
  'tts.minimax.region': MINIMAX_TTS_REGION_OPTIONS,
  'tts.minimax.format': MINIMAX_TTS_FORMAT_OPTIONS,
  'tts.openai.voice': [
    { value: 'alloy', label: 'Alloy' },
    { value: 'echo', label: 'Echo' },
    { value: 'fable', label: 'Fable' },
    { value: 'onyx', label: 'Onyx' },
    { value: 'nova', label: 'Nova' },
    { value: 'shimmer', label: 'Shimmer' },
  ],
  'stt.provider': [
    { value: 'local', label: '本地 Whisper' },
    { value: 'openai', label: 'OpenAI Whisper' },
    { value: 'mistral', label: 'Mistral' },
  ],
  'stt.local.model': [
    { value: 'tiny', label: 'Tiny' },
    { value: 'base', label: 'Base' },
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium' },
    { value: 'large', label: 'Large' },
  ],
  'display.personality': [
    { value: 'helpful', label: '友好' },
    { value: 'concise', label: '简洁' },
    { value: 'technical', label: '技术' },
    { value: 'creative', label: '创意' },
    { value: 'teacher', label: '教师' },
    { value: 'kawaii', label: '可爱' },
    { value: 'catgirl', label: '猫娘' },
    { value: 'pirate', label: '海盗' },
    { value: 'shakespeare', label: '莎士比亚' },
    { value: 'surfer', label: '冲浪者' },
    { value: 'noir', label: '黑色电影' },
    { value: 'uwu', label: 'UwU' },
    { value: 'philosopher', label: '哲学家' },
    { value: 'hype', label: '热情' },
  ],
  'approvals.mode': [
    { value: 'manual', label: '手动审批' },
    { value: 'auto', label: '自动执行' },
  ],
  'logging.level': [
    { value: 'DEBUG', label: 'Debug' },
    { value: 'INFO', label: 'Info' },
    { value: 'WARNING', label: 'Warning' },
    { value: 'ERROR', label: 'Error' },
  ],
}

const SKIP_KEYS = new Set([
  'platforms',
  'skills',
  'cron',
  'custom_providers',
  'providers',
])

const SECRET_KEY_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /token/i,
  /password/i,
  /credential/i,
]

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some(pattern => pattern.test(key))
}

function inferFieldType(key: string, value: unknown): ConfigFieldType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (SELECT_OPTIONS[key]) return 'select'
  if (isSecretKey(key)) return 'text'
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return 'json'
  return 'text'
}

function generateFieldSchema(
  key: string,
  value: unknown,
  parentKey: string = '',
): ConfigFieldSchema | null {
  const fullKey = parentKey ? `${parentKey}.${key}` : key
  
  if (SKIP_KEYS.has(key) || SKIP_KEYS.has(fullKey)) {
    return null
  }
  
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return null
  }
  
  const type = inferFieldType(fullKey, value)
  
  return {
    key: fullKey,
    label: FIELD_LABELS[fullKey] || FIELD_LABELS[key] || key,
    description: FIELD_DESCRIPTIONS[fullKey] || FIELD_DESCRIPTIONS[key],
    type,
    defaultValue: value,
    options: SELECT_OPTIONS[fullKey],
    placeholder: type === 'text' ? `输入 ${key}` : undefined,
  }
}

function extractFieldsFromObject(
  obj: Record<string, unknown>,
  parentKey: string = '',
  depth: number = 0,
): ConfigFieldSchema[] {
  if (depth > 3) return []
  
  const fields: ConfigFieldSchema[] = []
  
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue
    if (SKIP_KEYS.has(key)) continue
    
    const fullKey = parentKey ? `${parentKey}.${key}` : key
    
    if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
      const nestedFields = extractFieldsFromObject(
        value as Record<string, unknown>,
        fullKey,
        depth + 1,
      )
      fields.push(...nestedFields)
    } else {
      const field = generateFieldSchema(key, value, parentKey)
      if (field) {
        fields.push(field)
      }
    }
  }
  
  return fields
}

export function generateDynamicSchema(config: Record<string, unknown>): {
  categories: ConfigCategory[]
  fields: Record<string, ConfigFieldSchema[]>
} {
  const categories: ConfigCategory[] = []
  const fields: Record<string, ConfigFieldSchema[]> = {}
  
  const topLevelKeys = Object.keys(config).filter(k => !SKIP_KEYS.has(k))
  
  for (const key of topLevelKeys) {
    const value = config[key]
    
    if (value === undefined || value === null) continue
    
    const categoryId = key
    const categoryLabel = CATEGORY_LABELS[key] || key
    const categoryIcon = CATEGORY_ICONS[key] || 'settings'
    
    let categoryFields: ConfigFieldSchema[] = []
    
    if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
      categoryFields = extractFieldsFromObject(value as Record<string, unknown>, key)
    } else {
      const field = generateFieldSchema(key, value)
      if (field) {
        categoryFields = [field]
      }
    }
    
    if (categoryFields.length > 0) {
      categories.push({
        id: categoryId,
        label: categoryLabel,
        icon: categoryIcon,
        description: `${categoryLabel}相关配置`,
      })
      fields[categoryId] = categoryFields
    }
  }
  
  const otherFields: ConfigFieldSchema[] = []
  for (const key of topLevelKeys) {
    if (categories.find(c => c.id === key)) continue
    
    const value = config[key]
    if (typeof value !== 'object' || Array.isArray(value) || value === null) {
      const field = generateFieldSchema(key, value)
      if (field) {
        otherFields.push(field)
      }
    }
  }
  
  if (otherFields.length > 0) {
    categories.push({
      id: 'other',
      label: '其他',
      icon: 'ellipsis-horizontal',
      description: '其他配置项',
    })
    fields['other'] = otherFields
  }
  
  return { categories, fields }
}

export function mergeWithDynamicSchema(
  config: Record<string, unknown>,
  staticCategories: ConfigCategory[],
  staticFields: Record<string, ConfigFieldSchema[]>,
): {
  categories: ConfigCategory[]
  fields: Record<string, ConfigFieldSchema[]>
} {
  const dynamicSchema = generateDynamicSchema(config)
  
  const mergedCategories = [...staticCategories]
  const mergedFields = { ...staticFields }
  
  for (const category of dynamicSchema.categories) {
    if (!mergedCategories.find(c => c.id === category.id)) {
      mergedCategories.push(category)
      mergedFields[category.id] = dynamicSchema.fields[category.id] || []
    } else {
      const existingFields = mergedFields[category.id] || []
      const existingKeys = new Set(existingFields.map(f => f.key))
      
      for (const field of dynamicSchema.fields[category.id] || []) {
        if (!existingKeys.has(field.key)) {
          existingFields.push(field)
        }
      }
      mergedFields[category.id] = existingFields
    }
  }
  
  return { categories: mergedCategories, fields: mergedFields }
}
