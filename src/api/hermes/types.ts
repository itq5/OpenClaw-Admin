// ============================================================
// Hermes Agent API 类型定义
// ============================================================

// --- 连接相关 ---

export interface HermesConnectionConfig {
  webUrl: string
  apiUrl: string
  apiKey: string
}

export interface HermesStatus {
  version: string
  release_date?: string
  hermes_home?: string
  config_path?: string
  env_path?: string
  config_version?: number
  latest_config_version?: number
  gateway_running?: boolean
  gateway_pid?: number
  gateway_state?: string
  gateway_platforms?: Record<string, { state: string; error_code?: string | null; error_message?: string | null; updated_at?: string }>
  gateway_exit_reason?: string | null
  gateway_updated_at?: string
  active_sessions?: number
  connected?: boolean
  platform?: string
  hostname?: string
}

// --- 聊天相关 ---

export interface HermesMessage {
  id?: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  timestamp?: string | number
  model?: string
  provider?: string
  stopReason?: string
  toolCallId?: string
  toolName?: string
  isError?: boolean
  name?: string
}

export interface HermesChatSendParams {
  sessionId?: string
  message: string
  model?: string
  stream?: boolean
}

export interface HermesStreamDelta {
  type: 'delta' | 'tool_call' | 'tool_result' | 'error' | 'done'
  content?: string
  toolCallId?: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  isError?: boolean
  error?: string
}

// --- 会话相关 ---

export interface HermesSession {
  id: string
  title?: string
  createdAt?: string
  updatedAt?: string
  messageCount?: number
  model?: string
  platform?: string
}

export interface HermesSessionRaw {
  session_id: string
  id?: string
  title?: string | null
  preview?: string
  started_at?: number
  ended_at?: number
  last_active?: number
  message_count?: number
  model?: string
  source?: string
}

export interface HermesSessionDetail extends HermesSession {
  messages?: HermesMessage[]
}

export interface HermesSearchResult {
  query: string
  sessions: HermesSession[]
  total: number
}

// --- 模型相关 ---

export interface HermesModel {
  id: string
  label?: string
  provider?: string
  enabled?: boolean
  available?: boolean
  description?: string
  contextWindow?: number
  capabilities?: string[]
}

export interface ModelEndpoint {
  id: string
  name: string
  baseUrl?: string
  type: 'configured' | 'custom'
  models: ModelEndpointModel[]
}

export interface ModelEndpointModel {
  id: string
  name?: string
  isDefault?: boolean
}

export interface ModelSelection {
  modelId: string
  providerName: string
  baseUrl?: string
  type: 'configured' | 'custom'
}

// --- 配置相关 ---

export interface HermesModelConfig {
  default?: string
  provider?: string
  base_url?: string
}

export interface HermesConfig {
  model?: string | HermesModelConfig
  modelProvider?: string
  provider?: string
  providers?: Record<string, { base_url?: string; api_key?: string }>
  custom_providers?: HermesCustomProvider[] | HermesCustomProvider
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  contextWindow?: number
  platforms?: Record<string, unknown>
  skills?: Record<string, unknown>
  cron?: Record<string, unknown>
  memory?: Record<string, unknown>
  [key: string]: unknown
}

export interface HermesConfigUpdateParams {
  model?: string | HermesModelConfig
  modelProvider?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  contextWindow?: number
  [key: string]: unknown
}

// --- 渠道/平台相关 ---

export interface HermesPlatform {
  id: string
  name: string
  type: string
  enabled: boolean
  configured: boolean
  config?: Record<string, unknown>
}

// --- 技能相关 ---

export interface HermesSkill {
  name: string
  description?: string
  version?: string
  enabled: boolean
  category?: string
  config?: Record<string, unknown>
  path?: string
  source?: string
  trust_level?: string
  tags?: string[]
  author?: string
  installed?: boolean
}

// --- 定时任务相关 ---

export interface HermesCronJob {
  id: string
  name: string
  description?: string
  enabled: boolean
  schedule: string
  command?: string
  timezone?: string
  nextRun?: string
  lastRun?: string
  lastStatus?: 'ok' | 'error' | 'skipped'
  lastError?: string
  createdAt?: string
  updatedAt?: string
}

export interface HermesCronJobCreateParams {
  name: string
  description?: string
  enabled?: boolean
  schedule: string
  command?: string
  timezone?: string
}

export interface HermesCronJobUpdateParams {
  name?: string
  description?: string
  enabled?: boolean
  schedule?: string
  command?: string
  timezone?: string
}

// --- 记忆相关 ---

export interface HermesMemoryContent {
  content: string
  updatedAt?: string
  size?: number
}

// --- 工具集相关 ---

export interface HermesToolset {
  name: string
  enabled: boolean
  configured: boolean
  tools?: string[]
  description?: string
}

// --- 环境变量相关 ---

export interface HermesEnvVar {
  key: string
  value: string
  masked?: boolean
}

// --- 使用分析相关 ---

export interface HermesUsageDailyItem {
  day: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  reasoning_tokens: number
  estimated_cost: number
  actual_cost: number
  sessions: number
}

export interface HermesUsageByModel {
  model: string
  input_tokens: number
  output_tokens: number
  estimated_cost: number
  sessions: number
}

export interface HermesUsageTotals {
  total_input: number
  total_output: number
  total_cache_read: number
  total_reasoning: number
  total_estimated_cost: number
  total_actual_cost: number
  total_sessions: number
}

export interface HermesUsageAnalytics {
  daily: HermesUsageDailyItem[]
  by_model: HermesUsageByModel[]
  totals: HermesUsageTotals
  period_days: number
}

// --- 聊天流式增量 ---

export interface HermesChatDelta {
  id?: string
  object?: string
  created?: number
  model?: string
  session_id?: string
  choices?: Array<{
    index: number
    delta: {
      role?: string
      content?: string
      tool_calls?: Array<{
        index: number
        id: string
        type: 'function'
        function: {
          name: string
          arguments: string
        }
      }>
      tool_responses?: Array<{
        index: number
        id: string
        function_name?: string
        content: string
      }>
    }
    finish_reason: string | null
  }>
  // Hermes-style tool event (root-level)
  tool?: string
  emoji?: string
  label?: string
}

// --- API 响应 ---

export interface HermesApiResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
  message?: string
}

// --- Provider 配置模板 ---

export interface HermesProviderConfig {
  id: string
  name: string
  description?: string
  envKey: string
  baseUrlKey?: string
  defaultBaseUrl?: string
  docsUrl?: string
  recommended?: boolean
  supportsModelList?: boolean
  // 模型列表 API 配置
  modelsApiPath?: string
  modelsApiAuthType?: 'bearer' | 'x-api-key' | 'query' | 'none'
  modelsApiExtraHeaders?: Record<string, string>
  modelsApiQueryParam?: string
}

export interface HermesCustomProvider {
  name: string
  base_url: string
  api_key?: string
  api_mode?: 'chat_completions' | 'anthropic_messages'
  models?: Record<string, { context_length?: number }>
  model?: string
  context_window?: number
}

export const HERMES_PROVIDERS: HermesProviderConfig[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: '推荐，支持 200+ 模型',
    envKey: 'OPENROUTER_API_KEY',
    baseUrlKey: 'OPENROUTER_BASE_URL',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    docsUrl: 'https://openrouter.ai/keys',
    recommended: true,
    supportsModelList: true,
    modelsApiPath: '/models',
    modelsApiAuthType: 'none',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    baseUrlKey: 'OPENAI_BASE_URL',
    defaultBaseUrl: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/api-keys',
    supportsModelList: true,
    modelsApiPath: '/models',
    modelsApiAuthType: 'bearer',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    docsUrl: 'https://console.anthropic.com/',
    supportsModelList: true,
    modelsApiPath: '/v1/models',
    modelsApiAuthType: 'x-api-key',
    modelsApiExtraHeaders: { 'anthropic-version': '2023-06-01' },
  },
  {
    id: 'google',
    name: 'Google Gemini',
    envKey: 'GOOGLE_API_KEY',
    baseUrlKey: 'GEMINI_BASE_URL',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    supportsModelList: true,
    modelsApiPath: '/v1beta/models',
    modelsApiAuthType: 'query',
    modelsApiQueryParam: 'key',
  },
  {
    id: 'zhipu',
    name: 'z.ai / ZhipuAI GLM',
    envKey: 'GLM_API_KEY',
    baseUrlKey: 'GLM_BASE_URL',
    defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
    docsUrl: 'https://open.bigmodel.cn/',
    supportsModelList: true,
    modelsApiPath: '/models',
    modelsApiAuthType: 'bearer',
  },
  {
    id: 'kimi',
    name: 'Kimi / Moonshot',
    envKey: 'KIMI_API_KEY',
    baseUrlKey: 'KIMI_BASE_URL',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    docsUrl: 'https://platform.moonshot.cn/',
    supportsModelList: true,
    modelsApiPath: '/models',
    modelsApiAuthType: 'bearer',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    envKey: 'MINIMAX_API_KEY',
    baseUrlKey: 'MINIMAX_BASE_URL',
    defaultBaseUrl: 'https://api.minimax.chat/v1',
    docsUrl: 'https://www.minimax.io/',
    supportsModelList: true,
    modelsApiPath: '/models',
    modelsApiAuthType: 'bearer',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrlKey: 'DEEPSEEK_BASE_URL',
    defaultBaseUrl: 'https://api.deepseek.com',
    docsUrl: 'https://platform.deepseek.com/',
    supportsModelList: true,
    modelsApiPath: '/models',
    modelsApiAuthType: 'bearer',
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    envKey: 'HF_TOKEN',
    baseUrlKey: 'HF_BASE_URL',
    defaultBaseUrl: 'https://router.huggingface.co/v1',
    docsUrl: 'https://huggingface.co/settings/tokens',
    supportsModelList: true,
    modelsApiPath: '/models',
    modelsApiAuthType: 'bearer',
  },
  {
    id: 'nous',
    name: 'Nous Portal',
    envKey: 'NOUS_API_KEY',
    baseUrlKey: 'HERMES_PORTAL_BASE_URL',
    docsUrl: 'https://nousresearch.com/',
    supportsModelList: true,
    modelsApiPath: '/v1/models',
    modelsApiAuthType: 'bearer',
  },
]

// --- 配置 Schema 相关 ---

export type ConfigFieldType = 'text' | 'number' | 'boolean' | 'select' | 'textarea' | 'json'

export interface ConfigFieldValidation {
  min?: number
  max?: number
  pattern?: string
  patternMessage?: string
  required?: boolean
}

export interface ConfigFieldOption {
  value: string | number | boolean
  label: string
  description?: string
}

export interface ConfigFieldSchema {
  key: string
  label: string
  description?: string
  type: ConfigFieldType
  defaultValue?: unknown
  options?: ConfigFieldOption[]
  validation?: ConfigFieldValidation
  placeholder?: string
  unit?: string
  group?: string
}

export interface ConfigCategory {
  id: string
  label: string
  icon?: string
  description?: string
  fields?: ConfigFieldSchema[]
}

export interface HermesConfigSchema {
  version: string
  categories: ConfigCategory[]
}
