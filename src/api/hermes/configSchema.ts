import type {
  ConfigCategory,
  ConfigFieldSchema,
  HermesConfigSchema,
} from './types'
import {
  MINIMAX_T2A_AUDIO_FORMATS,
  MINIMAX_T2A_DEFAULT_AUDIO_FORMAT,
  MINIMAX_T2A_DEFAULT_MODEL,
  MINIMAX_T2A_DEFAULT_REGION,
  MINIMAX_T2A_ENDPOINTS,
  MINIMAX_T2A_MODELS,
} from '../minimax/t2a'

export interface MiniMaxTtsSelectOption {
  value: string
  label: string
}

// MiniMax T2A options are derived from the transport module so that the
// selectable models, regions and audio formats have a single source of truth.
export const MINIMAX_TTS_MODEL_OPTIONS: MiniMaxTtsSelectOption[] = MINIMAX_T2A_MODELS.map(
  (model) => ({ value: model, label: model }),
)

export const MINIMAX_TTS_REGION_OPTIONS: MiniMaxTtsSelectOption[] = MINIMAX_T2A_ENDPOINTS.map(
  (endpoint) => ({
    value: endpoint.region,
    label: `${endpoint.region} (${new URL(endpoint.url).host})`,
  }),
)

export const MINIMAX_TTS_FORMAT_OPTIONS: MiniMaxTtsSelectOption[] = MINIMAX_T2A_AUDIO_FORMATS.map(
  (format) => ({ value: format, label: format.toUpperCase() }),
)

export const GENERAL_FIELDS: ConfigFieldSchema[] = [
  {
    key: 'model',
    label: '模型',
    description: '选择要使用的 AI 模型（支持字符串或对象格式）',
    type: 'json',
    defaultValue: '',
    placeholder: '输入模型名称或配置对象',
  },
  {
    key: 'file_read_max_chars',
    label: '文件读取最大字符数',
    description: '单次读取文件的最大字符数',
    type: 'number',
    defaultValue: 100000,
    validation: { min: 1000, max: 10000000 },
  },
  {
    key: 'timezone',
    label: '时区',
    description: '设置时区',
    type: 'text',
    defaultValue: '',
    placeholder: '例如: Asia/Shanghai',
  },
]

export const AGENT_FIELDS: ConfigFieldSchema[] = [
  {
    key: 'agent.max_turns',
    label: '最大轮次',
    description: 'Agent 最大执行轮次',
    type: 'number',
    defaultValue: 90,
    validation: { min: 1, max: 1000 },
  },
  {
    key: 'agent.gateway_timeout',
    label: '网关超时',
    description: '网关超时时间（秒）',
    type: 'number',
    defaultValue: 1800,
    validation: { min: 60, max: 86400 },
    unit: '秒',
  },
  {
    key: 'agent.verbose',
    label: '详细模式',
    description: '启用详细日志输出',
    type: 'boolean',
    defaultValue: false,
  },
  {
    key: 'agent.reasoning_effort',
    label: '推理努力程度',
    description: '模型推理的努力程度',
    type: 'select',
    defaultValue: 'medium',
    options: [
      { value: 'low', label: '低' },
      { value: 'medium', label: '中' },
      { value: 'high', label: '高' },
    ],
  },
]

export const TERMINAL_FIELDS: ConfigFieldSchema[] = [
  {
    key: 'terminal.backend',
    label: '终端后端',
    description: '选择终端后端类型',
    type: 'select',
    defaultValue: 'local',
    options: [
      { value: 'local', label: '本地终端' },
      { value: 'docker', label: 'Docker' },
      { value: 'singularity', label: 'Singularity' },
      { value: 'modal', label: 'Modal' },
      { value: 'daytona', label: 'Daytona' },
    ],
  },
  {
    key: 'terminal.cwd',
    label: '工作目录',
    description: '终端的默认工作目录',
    type: 'text',
    defaultValue: '.',
    placeholder: '例如: /home/user/projects',
  },
  {
    key: 'terminal.timeout',
    label: '命令超时',
    description: '命令执行超时时间（秒）',
    type: 'number',
    defaultValue: 180,
    validation: { min: 10, max: 3600 },
    unit: '秒',
  },
  {
    key: 'terminal.persistent_shell',
    label: '持久化 Shell',
    description: '保持 Shell 会话持久化',
    type: 'boolean',
    defaultValue: true,
  },
  {
    key: 'terminal.docker_image',
    label: 'Docker 镜像',
    description: 'Docker 后端使用的镜像',
    type: 'text',
    defaultValue: 'nikolaik/python-nodejs:python3.11-nodejs20',
    placeholder: 'Docker 镜像名称',
  },
  {
    key: 'terminal.container_cpu',
    label: '容器 CPU',
    description: '容器 CPU 核心数',
    type: 'number',
    defaultValue: 1,
    validation: { min: 1, max: 16 },
    unit: '核',
  },
  {
    key: 'terminal.container_memory',
    label: '容器内存',
    description: '容器内存大小（MB）',
    type: 'number',
    defaultValue: 5120,
    validation: { min: 512, max: 65536 },
    unit: 'MB',
  },
]

export const MEMORY_FIELDS: ConfigFieldSchema[] = [
  {
    key: 'memory.memory_enabled',
    label: '启用记忆',
    description: '启用 AI 记忆功能，允许跨会话记住信息',
    type: 'boolean',
    defaultValue: true,
  },
  {
    key: 'memory.user_profile_enabled',
    label: '启用用户画像',
    description: '启用用户画像功能',
    type: 'boolean',
    defaultValue: true,
  },
  {
    key: 'memory.memory_char_limit',
    label: '记忆字符上限',
    description: '记忆存储的字符上限',
    type: 'number',
    defaultValue: 2200,
    validation: { min: 100, max: 100000 },
    unit: '字符',
  },
  {
    key: 'memory.user_char_limit',
    label: '用户画像字符上限',
    description: '用户画像存储的字符上限',
    type: 'number',
    defaultValue: 1375,
    validation: { min: 100, max: 100000 },
    unit: '字符',
  },
  {
    key: 'memory.nudge_interval',
    label: '提示间隔',
    description: '记忆提示的间隔轮次',
    type: 'number',
    defaultValue: 10,
    validation: { min: 1, max: 100 },
    unit: '轮',
  },
]

export const COMPRESSION_FIELDS: ConfigFieldSchema[] = [
  {
    key: 'compression.enabled',
    label: '启用压缩',
    description: '启用上下文压缩功能',
    type: 'boolean',
    defaultValue: true,
  },
  {
    key: 'compression.threshold',
    label: '压缩阈值',
    description: '触发压缩的上下文比例阈值',
    type: 'number',
    defaultValue: 0.5,
    validation: { min: 0.1, max: 1.0 },
  },
  {
    key: 'compression.target_ratio',
    label: '目标压缩比',
    description: '压缩后的目标比例',
    type: 'number',
    defaultValue: 0.2,
    validation: { min: 0.1, max: 0.5 },
  },
  {
    key: 'compression.protect_last_n',
    label: '保护最近消息数',
    description: '压缩时保护最近 N 条消息',
    type: 'number',
    defaultValue: 20,
    validation: { min: 0, max: 100 },
    unit: '条',
  },
]

export const BROWSER_FIELDS: ConfigFieldSchema[] = [
  {
    key: 'browser.inactivity_timeout',
    label: '不活动超时',
    description: '浏览器不活动超时时间（秒）',
    type: 'number',
    defaultValue: 120,
    validation: { min: 30, max: 3600 },
    unit: '秒',
  },
  {
    key: 'browser.command_timeout',
    label: '命令超时',
    description: '浏览器命令超时时间（秒）',
    type: 'number',
    defaultValue: 30,
    validation: { min: 5, max: 300 },
    unit: '秒',
  },
  {
    key: 'browser.record_sessions',
    label: '录制会话',
    description: '录制浏览器会话',
    type: 'boolean',
    defaultValue: false,
  },
  {
    key: 'browser.allow_private_urls',
    label: '允许私有 URL',
    description: '允许访问私有网络 URL',
    type: 'boolean',
    defaultValue: false,
  },
]

export const TTS_FIELDS: ConfigFieldSchema[] = [
  {
    key: 'tts.provider',
    label: 'TTS 提供商',
    description: '选择文本转语音提供商',
    type: 'select',
    defaultValue: 'edge',
    options: [
      { value: 'edge', label: 'Edge TTS' },
      { value: 'openai', label: 'OpenAI TTS' },
      { value: 'elevenlabs', label: 'ElevenLabs' },
      { value: 'mistral', label: 'Mistral' },
      { value: 'minimax', label: 'MiniMax T2A' },
      { value: 'neutts', label: 'NeuTTS (本地)' },
    ],
  },
  {
    key: 'tts.edge.voice',
    label: 'Edge 语音',
    description: 'Edge TTS 语音名称',
    type: 'text',
    defaultValue: 'en-US-AriaNeural',
    placeholder: '例如: en-US-AriaNeural',
  },
  {
    key: 'tts.openai.model',
    label: 'OpenAI 模型',
    description: 'OpenAI TTS 模型',
    type: 'text',
    defaultValue: 'gpt-4o-mini-tts',
  },
  {
    key: 'tts.openai.voice',
    label: 'OpenAI 语音',
    description: 'OpenAI TTS 语音',
    type: 'select',
    defaultValue: 'alloy',
    options: [
      { value: 'alloy', label: 'Alloy' },
      { value: 'echo', label: 'Echo' },
      { value: 'fable', label: 'Fable' },
      { value: 'onyx', label: 'Onyx' },
      { value: 'nova', label: 'Nova' },
      { value: 'shimmer', label: 'Shimmer' },
    ],
  },
  // MiniMax text-to-audio provider fields.
  {
    key: 'tts.minimax.model',
    label: 'MiniMax 模型',
    description: 'MiniMax T2A 语音合成模型',
    type: 'select',
    defaultValue: MINIMAX_T2A_DEFAULT_MODEL,
    options: MINIMAX_TTS_MODEL_OPTIONS,
  },
  {
    key: 'tts.minimax.region',
    label: 'MiniMax 区域',
    description: 'MiniMax T2A 接口区域（全球 / 中国大陆）',
    type: 'select',
    defaultValue: MINIMAX_T2A_DEFAULT_REGION,
    options: MINIMAX_TTS_REGION_OPTIONS,
  },
  {
    key: 'tts.minimax.voice_id',
    label: 'MiniMax 音色',
    description: 'MiniMax T2A 音色 ID',
    type: 'text',
    defaultValue: '',
    placeholder: '例如: female-shaonv',
  },
  {
    key: 'tts.minimax.format',
    label: 'MiniMax 音频格式',
    description: 'MiniMax T2A 输出音频格式',
    type: 'select',
    defaultValue: MINIMAX_T2A_DEFAULT_AUDIO_FORMAT,
    options: MINIMAX_TTS_FORMAT_OPTIONS,
  },
  {
    key: 'tts.minimax.language_boost',
    label: 'MiniMax 语种增强',
    description: 'MiniMax T2A 语种识别增强',
    type: 'text',
    defaultValue: '',
    placeholder: '例如: Chinese',
  },
]

export const STT_FIELDS: ConfigFieldSchema[] = [
  {
    key: 'stt.enabled',
    label: '启用 STT',
    description: '启用语音转文字功能',
    type: 'boolean',
    defaultValue: true,
  },
  {
    key: 'stt.provider',
    label: 'STT 提供商',
    description: '选择语音转文字提供商',
    type: 'select',
    defaultValue: 'local',
    options: [
      { value: 'local', label: '本地 Whisper' },
      { value: 'openai', label: 'OpenAI Whisper' },
      { value: 'mistral', label: 'Mistral' },
    ],
  },
  {
    key: 'stt.local.model',
    label: '本地模型',
    description: '本地 Whisper 模型大小',
    type: 'select',
    defaultValue: 'base',
    options: [
      { value: 'tiny', label: 'Tiny' },
      { value: 'base', label: 'Base' },
      { value: 'small', label: 'Small' },
      { value: 'medium', label: 'Medium' },
      { value: 'large', label: 'Large' },
    ],
  },
]

export const VOICE_FIELDS: ConfigFieldSchema[] = [
  {
    key: 'voice.record_key',
    label: '录音快捷键',
    description: '开始录音的快捷键',
    type: 'text',
    defaultValue: 'ctrl+b',
    placeholder: '例如: ctrl+b',
  },
  {
    key: 'voice.max_recording_seconds',
    label: '最大录音时长',
    description: '最大录音时长（秒）',
    type: 'number',
    defaultValue: 120,
    validation: { min: 10, max: 600 },
    unit: '秒',
  },
  {
    key: 'voice.auto_tts',
    label: '自动 TTS',
    description: '自动播放 TTS 响应',
    type: 'boolean',
    defaultValue: false,
  },
  {
    key: 'voice.silence_threshold',
    label: '静音阈值',
    description: '静音检测阈值（毫秒）',
    type: 'number',
    defaultValue: 200,
    validation: { min: 50, max: 1000 },
    unit: 'ms',
  },
  {
    key: 'voice.silence_duration',
    label: '静音持续时间',
    description: '静音持续时间（秒）',
    type: 'number',
    defaultValue: 3,
    validation: { min: 1, max: 10 },
    unit: '秒',
  },
]

export const DISPLAY_FIELDS: ConfigFieldSchema[] = [
  {
    key: 'display.compact',
    label: '紧凑模式',
    description: '启用紧凑显示模式',
    type: 'boolean',
    defaultValue: false,
  },
  {
    key: 'display.personality',
    label: '人格',
    description: '选择 AI 人格',
    type: 'select',
    defaultValue: 'helpful',
    options: [
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
  },
  {
    key: 'display.streaming',
    label: '流式输出',
    description: '启用流式输出',
    type: 'boolean',
    defaultValue: true,
  },
  {
    key: 'display.show_cost',
    label: '显示成本',
    description: '显示 API 调用成本',
    type: 'boolean',
    defaultValue: false,
  },
  {
    key: 'display.bell_on_complete',
    label: '完成时响铃',
    description: '任务完成时播放提示音',
    type: 'boolean',
    defaultValue: false,
  },
]

export const SECURITY_FIELDS: ConfigFieldSchema[] = [
  {
    key: 'security.redact_secrets',
    label: '脱敏密钥',
    description: '在日志中脱敏敏感信息',
    type: 'boolean',
    defaultValue: true,
  },
  {
    key: 'security.tirith_enabled',
    label: '启用 Tirith',
    description: '启用 Tirith 安全检查',
    type: 'boolean',
    defaultValue: true,
  },
  {
    key: 'security.tirith_timeout',
    label: 'Tirith 超时',
    description: 'Tirith 检查超时时间（秒）',
    type: 'number',
    defaultValue: 5,
    validation: { min: 1, max: 60 },
    unit: '秒',
  },
  {
    key: 'security.tirith_fail_open',
    label: 'Tirith 失败开放',
    description: 'Tirith 检查失败时允许继续执行',
    type: 'boolean',
    defaultValue: true,
  },
]

export const APPROVALS_FIELDS: ConfigFieldSchema[] = [
  {
    key: 'approvals.mode',
    label: '审批模式',
    description: '命令审批模式',
    type: 'select',
    defaultValue: 'manual',
    options: [
      { value: 'manual', label: '手动审批' },
      { value: 'auto', label: '自动执行' },
    ],
  },
  {
    key: 'approvals.timeout',
    label: '审批超时',
    description: '审批等待超时时间（秒）',
    type: 'number',
    defaultValue: 60,
    validation: { min: 10, max: 600 },
    unit: '秒',
  },
]

export const CHECKPOINTS_FIELDS: ConfigFieldSchema[] = [
  {
    key: 'checkpoints.enabled',
    label: '启用检查点',
    description: '启用会话检查点功能',
    type: 'boolean',
    defaultValue: true,
  },
  {
    key: 'checkpoints.max_snapshots',
    label: '最大快照数',
    description: '保存的最大快照数量',
    type: 'number',
    defaultValue: 50,
    validation: { min: 1, max: 200 },
    unit: '个',
  },
]

export const LOGGING_FIELDS: ConfigFieldSchema[] = [
  {
    key: 'logging.level',
    label: '日志级别',
    description: '日志输出级别',
    type: 'select',
    defaultValue: 'INFO',
    options: [
      { value: 'DEBUG', label: 'Debug' },
      { value: 'INFO', label: 'Info' },
      { value: 'WARNING', label: 'Warning' },
      { value: 'ERROR', label: 'Error' },
    ],
  },
  {
    key: 'logging.max_size_mb',
    label: '最大日志大小',
    description: '单个日志文件最大大小（MB）',
    type: 'number',
    defaultValue: 5,
    validation: { min: 1, max: 100 },
    unit: 'MB',
  },
  {
    key: 'logging.backup_count',
    label: '备份数量',
    description: '日志备份数量',
    type: 'number',
    defaultValue: 3,
    validation: { min: 1, max: 20 },
    unit: '个',
  },
]

export const DEFAULT_CONFIG_CATEGORIES: ConfigCategory[] = [
  {
    id: 'general',
    label: '通用',
    icon: 'settings',
    description: '基础配置',
    fields: GENERAL_FIELDS,
  },
  {
    id: 'agent',
    label: 'Agent',
    icon: 'robot',
    description: 'Agent 行为配置',
    fields: AGENT_FIELDS,
  },
  {
    id: 'terminal',
    label: '终端',
    icon: 'terminal',
    description: '终端相关配置',
    fields: TERMINAL_FIELDS,
  },
  {
    id: 'memory',
    label: '记忆',
    icon: 'brain',
    description: 'AI 记忆功能配置',
    fields: MEMORY_FIELDS,
  },
  {
    id: 'compression',
    label: '压缩',
    icon: 'compress',
    description: '上下文压缩配置',
    fields: COMPRESSION_FIELDS,
  },
  {
    id: 'browser',
    label: '浏览器',
    icon: 'globe',
    description: '浏览器自动化配置',
    fields: BROWSER_FIELDS,
  },
  {
    id: 'tts',
    label: 'TTS',
    icon: 'volume',
    description: '文本转语音配置',
    fields: TTS_FIELDS,
  },
  {
    id: 'stt',
    label: 'STT',
    icon: 'mic',
    description: '语音转文字配置',
    fields: STT_FIELDS,
  },
  {
    id: 'voice',
    label: '语音',
    icon: 'mic',
    description: '语音交互配置',
    fields: VOICE_FIELDS,
  },
  {
    id: 'display',
    label: '显示',
    icon: 'tv',
    description: '显示相关配置',
    fields: DISPLAY_FIELDS,
  },
  {
    id: 'security',
    label: '安全',
    icon: 'shield',
    description: '安全相关配置',
    fields: SECURITY_FIELDS,
  },
  {
    id: 'approvals',
    label: '审批',
    icon: 'checkmark',
    description: '命令审批配置',
    fields: APPROVALS_FIELDS,
  },
  {
    id: 'checkpoints',
    label: '检查点',
    icon: 'save',
    description: '会话检查点配置',
    fields: CHECKPOINTS_FIELDS,
  },
  {
    id: 'logging',
    label: '日志',
    icon: 'list',
    description: '日志配置',
    fields: LOGGING_FIELDS,
  },
]

export const DEFAULT_HERMES_CONFIG_SCHEMA: HermesConfigSchema = {
  version: '1.0.0',
  categories: DEFAULT_CONFIG_CATEGORIES,
}

export const CONFIG_FIELD_MAP: Record<string, ConfigFieldSchema> = (() => {
  const map: Record<string, ConfigFieldSchema> = {}
  for (const category of DEFAULT_CONFIG_CATEGORIES) {
    for (const field of category.fields || []) {
      map[field.key] = field
    }
  }
  return map
})()

export const getConfigField = (key: string): ConfigFieldSchema | undefined => {
  return CONFIG_FIELD_MAP[key]
}

export const getConfigCategory = (id: string): ConfigCategory | undefined => {
  return DEFAULT_CONFIG_CATEGORIES.find(cat => cat.id === id)
}

export const getDefaultValue = (key: string): unknown => {
  return CONFIG_FIELD_MAP[key]?.defaultValue
}
