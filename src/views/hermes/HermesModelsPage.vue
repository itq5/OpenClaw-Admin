<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NDivider,
  NGrid,
  NGridItem,
  NIcon,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpace,
  NSpin,
  NTabPane,
  NTabs,
  NTag,
  NText,
  useMessage,
} from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import {
  AddOutline,
  CheckmarkCircleOutline,
  CheckmarkOutline,
  CloudOutline,
  CreateOutline,
  CubeOutline,
  EyeOutline,
  KeyOutline,
  LinkOutline,
  RefreshOutline,
  SearchOutline,
  ServerOutline,
  StarOutline,
  TrashOutline,
} from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useHermesModelStore } from '@/stores/hermes/model'
import { useHermesConfigStore } from '@/stores/hermes/config'
import { useHermesConnectionStore } from '@/stores/hermes/connection'
import { HERMES_PROVIDERS } from '@/api/hermes/types'
import type { HermesProviderConfig, HermesEnvVar, HermesCustomProvider } from '@/api/hermes/types'

const { t } = useI18n()
const modelStore = useHermesModelStore()
const configStore = useHermesConfigStore()
const connStore = useHermesConnectionStore()
const message = useMessage()

const activeTab = ref('models')

// Provider ID 到 Hermes 官方 provider 名称的映射
// 参考: https://hermes-agent.nousresearch.com/docs/integrations/providers/
const PROVIDER_ID_TO_HERMES_NAME: Record<string, string> = {
  openrouter: 'openrouter',
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'gemini',
  zhipu: 'zai',
  kimi: 'kimi-coding',
  minimax: 'minimax',
  deepseek: 'deepseek',
  huggingface: 'huggingface',
  nous: 'nous_portal',
}

// ---- 选中的 Provider ----

const selectedProvider = ref<{ id: string; name: string; base_url?: string; type: 'configured' | 'custom' } | null>(null)

// ---- 自定义端点状态 ----

const customProviders = computed<HermesCustomProvider[]>(() => {
  const providers = configStore.config?.custom_providers
  if (Array.isArray(providers)) return providers
  if (providers && typeof providers === 'object') {
    const p = providers as Record<string, unknown>
    if (p.name && p.base_url) {
      return [{ name: p.name as string, base_url: p.base_url as string, api_key: p.api_key as string | undefined }]
    }
  }
  return []
})

const showCustomProviderForm = ref(false)
const editingCustomProvider = ref<HermesCustomProvider | null>(null)
const customProviderFormName = ref('')
const customProviderFormBaseUrl = ref('')
const customProviderFormApiKey = ref('')
const customProviderFormModel = ref('')
const customProviderFormContextWindow = ref<number | null>(null)
const customProviderFormSaving = ref(false)
const customProviderFormModels = ref<{ id: string; name?: string }[]>([])
const customProviderFormModelsLoading = ref(false)

// ---- 设置默认模型弹窗 ----

const showSetDefaultModelModal = ref(false)
const setDefaultModelId = ref('')
const setDefaultModelContextWindow = ref<number | null>(null)
const setDefaultModelSaving = ref(false)

// ---- 可用模型列表 ----

const availableModels = ref<{ id: string; name?: string }[]>([])
const availableModelsLoading = ref(false)
const showAvailableModels = ref(false)

// ---- Provider 模型管理 ----

interface ProviderModel {
  id: string
  name?: string
  status: 'default' | 'added' | 'available'
}

const providerModelsList = ref<ProviderModel[]>([])
const providerModelsLoading = ref(false)

async function fetchModelsFromEndpoint(
  baseUrl: string, 
  apiKey?: string,
  providerConfig?: {
    modelsApiPath?: string
    modelsApiAuthType?: 'bearer' | 'x-api-key' | 'query' | 'none'
    modelsApiExtraHeaders?: Record<string, string>
    modelsApiQueryParam?: string
    defaultBaseUrl?: string
  }
): Promise<{ id: string; name?: string }[]> {
  // 通过后端代理请求外部 API，避免 CORS 问题
  const response = await fetch('/api/hermes/fetch-models', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ 
      baseUrl, 
      apiKey,
      providerConfig: providerConfig || {},
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const errorMsg = errorData.message || errorData.error || `HTTP ${response.status}`
    const requestUrl = errorData.url || ''
    throw new Error(requestUrl ? `${errorMsg} (请求: ${requestUrl})` : errorMsg)
  }

  const data = await response.json()
  return data.models || []
}

async function fetchCustomProviderFormModels() {
  if (!customProviderFormBaseUrl.value.trim()) {
    return
  }

  customProviderFormModelsLoading.value = true
  customProviderFormModels.value = []

  try {
    const models = await fetchModelsFromEndpoint(
      customProviderFormBaseUrl.value.trim(),
      customProviderFormApiKey.value.trim() || undefined
    )
    customProviderFormModels.value = models
    if (models.length > 0 && !customProviderFormModel.value) {
      // 如果有模型且当前没有选择，自动选择第一个
      customProviderFormModel.value = models[0]!.id
    }
    message.success(t('pages.hermesModels.customProvider.modelsFound', { count: models.length }))
  } catch (error) {
    console.error('[HermesModelsPage] fetchCustomProviderFormModels failed:', error)
    message.error(t('pages.hermesModels.availableModels.fetchFailed') + ': ' + (error instanceof Error ? error.message : String(error)))
  } finally {
    customProviderFormModelsLoading.value = false
  }
}

async function fetchAvailableModels() {
  const provider = displayProvider.value
  if (!provider?.base_url) {
    message.warning(t('pages.hermesModels.availableModels.noEndpoint'))
    return
  }

  availableModelsLoading.value = true
  availableModels.value = []
  showAvailableModels.value = true

  try {
    const baseUrl = provider.base_url.replace(/\/+$/, '')
    
    // 获取 API Key
    let apiKey = ''
    const customProviders = configStore.config?.custom_providers
    if (customProviders) {
      const cp = Array.isArray(customProviders) 
        ? customProviders.find(p => p.name === provider.id || p.base_url === provider.base_url)
        : customProviders
      if (cp?.api_key) {
        apiKey = cp.api_key
      }
    }
    
    // 如果没有从 custom_providers 获取到，尝试从环境变量获取
    if (!apiKey) {
      const providerConfig = HERMES_PROVIDERS.find(p => p.id === provider.id)
      if (providerConfig) {
        const envVar = getProviderEnvVar(providerConfig)
        if (envVar?.value && !envVar.masked) {
          apiKey = envVar.value
        } else {
          // 尝试从原始环境变量获取
          const rawVars = modelStore.rawEnvVars as Record<string, { is_set?: boolean; redacted_value?: string; value?: string }> | null
          if (rawVars && rawVars[providerConfig.envKey]?.value) {
            apiKey = rawVars[providerConfig.envKey]!.value!
          }
        }
      }
    }

    // 获取渠道商配置
    const providerConfig = HERMES_PROVIDERS.find(p => p.id === provider.id)
    const apiConfig = providerConfig ? {
      modelsApiPath: providerConfig.modelsApiPath,
      modelsApiAuthType: providerConfig.modelsApiAuthType,
      modelsApiExtraHeaders: providerConfig.modelsApiExtraHeaders,
      modelsApiQueryParam: providerConfig.modelsApiQueryParam,
      defaultBaseUrl: providerConfig.defaultBaseUrl,
    } : undefined

    // 使用后端代理获取模型列表
    const models = await fetchModelsFromEndpoint(baseUrl, apiKey || undefined, apiConfig)
    
    availableModels.value = models
    
    if (availableModels.value.length === 0) {
      message.info(t('pages.hermesModels.availableModels.empty'))
    } else {
      message.success(t('pages.hermesModels.availableModels.found', { count: availableModels.value.length }))
    }
  } catch (error) {
    message.error(t('pages.hermesModels.availableModels.fetchFailed') + ': ' + (error instanceof Error ? error.message : String(error)))
  } finally {
    availableModelsLoading.value = false
  }
}

function openSetDefaultModelModal(modelId: string) {
  setDefaultModelId.value = modelId
  // 尝试从现有配置中获取上下文窗口大小
  const provider = displayProvider.value
  if (provider) {
    const existingProvider = customProviders.value.find(
      p => p.name === provider.id || p.base_url === provider.base_url
    )
    setDefaultModelContextWindow.value = existingProvider?.context_window || null
  } else {
    setDefaultModelContextWindow.value = null
  }
  showSetDefaultModelModal.value = true
}

async function confirmSetDefaultModel() {
  const modelId = setDefaultModelId.value
  const provider = displayProvider.value
  if (!provider) {
    message.error(t('pages.hermesModels.setModelFailed'))
    return
  }

  setDefaultModelSaving.value = true
  try {
    // 根据 Hermes 配置格式构建配置
    // model.default 只是模型名称
    // model.provider 格式为 "custom:Provider名称"（自定义端点）或预置 provider 名称
    const modelConfig: Record<string, unknown> = {
      default: modelId,
    }
    
    // 检查是否是自定义端点
    // 1. 通过 provider.type 判断
    // 2. 通过检查 custom_providers 中是否存在来判断
    const isCustomProvider = provider.type === 'custom' || 
      customProviders.value.some(p => p.name === provider.id || p.base_url === provider.base_url)

    // 设置 provider 字段
    if (isCustomProvider) {
      // 自定义端点格式: custom:Provider名称
      modelConfig.provider = `custom:${provider.id}`
    } else {
      // 预置 provider 使用 Hermes 官方名称
      const hermesProviderName = PROVIDER_ID_TO_HERMES_NAME[provider.id] || provider.id
      modelConfig.provider = hermesProviderName
    }

    const configUpdate: Record<string, unknown> = {
      model: modelConfig,
    }
    
    // 更新 custom_providers 中对应项的 model 和 context_window 字段
    const existingProviders = [...customProviders.value]
    const providerIndex = existingProviders.findIndex(
      p => p.name === provider.id || p.base_url === provider.base_url
    )
    
    if (providerIndex >= 0) {
      // 更新现有 provider 的 model 和 context_window 字段
      const currentProvider = existingProviders[providerIndex]!
      existingProviders[providerIndex] = {
        ...currentProvider,
        model: modelId,
      }
      // 如果设置了上下文窗口大小，添加到配置中
      if (setDefaultModelContextWindow.value && setDefaultModelContextWindow.value > 0) {
        existingProviders[providerIndex]!.context_window = setDefaultModelContextWindow.value
      }
      configUpdate.custom_providers = existingProviders
    }
    
    await configStore.updateConfig(configUpdate as any)
    message.success(t('pages.hermesModels.setModelSuccess', { model: modelId }))
    showSetDefaultModelModal.value = false
    await configStore.fetchConfig()
  } catch {
    message.error(t('pages.hermesModels.setModelFailed'))
  } finally {
    setDefaultModelSaving.value = false
  }
}

// ---- 筛选状态 ----

const searchQuery = ref('')
const providerFilter = ref<string | null>(null)

const currentModelFromConfig = computed(() => {
  const model = configStore.config?.model
  if (!model) return ''
  if (typeof model === 'string') return model
  return model.default || ''
})

const currentProviderFromConfig = computed(() => {
  const config = configStore.config
  const model = config?.model
  
  // 从 model 配置中获取 base_url
  const modelBaseUrl = model && typeof model === 'object' ? model.base_url : undefined
  
  // 1. 检查 providers 字段
  const providers = config?.providers as Record<string, { base_url?: string }> | undefined
  if (providers) {
    const providerNames = Object.keys(providers)
    if (providerNames.length > 0) {
      const providerName = providerNames[0]!
      const providerData = providers[providerName]
      const knownProvider = HERMES_PROVIDERS.find(p => p.id === providerName)
      return { 
        id: providerName,
        name: knownProvider?.name || providerName,
        base_url: providerData?.base_url || modelBaseUrl,
        type: 'configured' as const,
      }
    }
  }
  
  // 2. 检查 custom_providers 字段
  const customProvidersList = config?.custom_providers
  if (customProvidersList) {
    const cp = Array.isArray(customProvidersList) ? customProvidersList[0] : customProvidersList
    if (cp && cp.name) {
      return { id: cp.name, name: cp.name, base_url: cp.base_url || modelBaseUrl, type: 'custom' as const }
    }
  }
  
  // 3. 检查 provider 字段（从 model.provider 或 config.provider）
  const providerId = (model && typeof model === 'object' ? model.provider : undefined) || config?.provider
  if (providerId) {
    // 检查是否是 custom:xxx 格式
    if (providerId.startsWith('custom:')) {
      const customName = providerId.slice(7)
      return { id: customName, name: customName, base_url: modelBaseUrl, type: 'custom' as const }
    }
    const knownProvider = HERMES_PROVIDERS.find(p => p.id === providerId)
    return { 
      id: providerId,
      name: knownProvider?.name || providerId,
      base_url: modelBaseUrl,
      type: 'configured' as const,
    }
  }
  
  // 4. 检查 modelProvider 字段
  const modelProvider = config?.modelProvider
  if (modelProvider) {
    const knownProvider = HERMES_PROVIDERS.find(p => p.id === modelProvider)
    return { 
      id: modelProvider,
      name: knownProvider?.name || modelProvider,
      base_url: modelBaseUrl,
      type: 'configured' as const,
    }
  }
  
  return null
})

const displayProvider = computed(() => {
  return selectedProvider.value || currentProviderFromConfig.value
})

function isGlobalDefaultModel(modelId: string, modelProvider?: string): boolean {
  const defaultModel = currentModelFromConfig.value
  const defaultProvider = currentProviderFromConfig.value
  const currentProvider = displayProvider.value
  
  // 1. 检查模型 ID 是否匹配全局默认模型
  if (!defaultModel || modelId !== defaultModel) {
    return false
  }
  
  // 2. 如果传入了 modelProvider，检查是否与当前显示的 Provider 一致
  if (modelProvider !== undefined) {
    const providerMatch = currentProvider?.id === modelProvider || 
      (currentProvider?.type === 'custom' && modelProvider === currentProvider.id)
    return providerMatch
  }
  
  // 3. 没有传入 modelProvider 时，检查全局默认 Provider 是否与当前 Provider 一致
  if (!currentProvider || !defaultProvider) {
    return false
  }
  
  // 检查当前显示的 Provider 是否与全局默认模型的 Provider 一致
  // 对于自定义端点，需要检查名称是否匹配
  if (defaultProvider.type === 'custom') {
    return currentProvider.id === defaultProvider.id && currentProvider.type === 'custom'
  }
  
  // 对于预置 Provider，检查 ID 是否匹配
  return currentProvider.id === defaultProvider.id
}

function selectProvider(provider: { id: string; name: string; base_url?: string; type: 'configured' | 'custom' }) {
  if (selectedProvider.value?.id === provider.id && selectedProvider.value?.type === provider.type) {
    selectedProvider.value = null
  } else {
    selectedProvider.value = provider
  }
  // 切换 Provider 时清空可用模型列表和隐藏显示
  availableModels.value = []
  showAvailableModels.value = false
}

function isProviderSelected(providerId: string, type: 'configured' | 'custom'): boolean {
  return selectedProvider.value?.id === providerId && selectedProvider.value?.type === type
}

// ---- 统计数据 ----

const totalModels = computed(() => modelStore.models.length)

const activeModelLabel = computed(() => {
  if (!currentModelFromConfig.value) return '-'
  const found = modelStore.models.find((m) => m.id === currentModelFromConfig.value)
  return found?.label || found?.id || currentModelFromConfig.value
})

const uniqueProviders = computed(() => {
  const set = new Set<string>()
  modelStore.models.forEach((m) => {
    if (m.provider) set.add(m.provider)
  })
  return set.size
})

const configuredProviders = computed(() => {
  return HERMES_PROVIDERS.filter((p) => isProviderConfigured(p)).map((p) => ({
    ...p,
    apiKeyDisplay: getProviderDisplayApiKey(p),
    baseUrl: getProviderDisplayBaseUrlValue(p),
  }))
})

const allAddedModels = computed(() => {
  // 显示当前选择 Provider 的模型
  // 如果当前 Provider 有配置模型（custom_providers[].model），显示该模型
  // 然后判断是否是全局默认模型
  const models: { id: string; provider: string; providerName: string; isDefault: boolean }[] = []
  const currentProvider = displayProvider.value
  
  if (!currentProvider) {
    return models
  }
  
  // 获取当前 Provider 的模型
  let currentProviderModel: string | undefined
  
  if (currentProvider.type === 'custom') {
    // 自定义端点：从 custom_providers 中获取 model
    const cp = customProviders.value.find(p => p.name === currentProvider.id)
    currentProviderModel = cp?.model
  } else {
    // 预置 Provider：检查是否是全局默认模型的 Provider
    const defaultProvider = currentProviderFromConfig.value
    if (defaultProvider?.id === currentProvider.id) {
      currentProviderModel = currentModelFromConfig.value
    }
  }
  
  if (currentProviderModel) {
    models.push({
      id: currentProviderModel,
      provider: currentProvider.id,
      providerName: currentProvider.name,
      isDefault: true,
    })
  }
  
  return models
})

const modelStatusCounts = computed(() => {
  const defaultModel = currentModelFromConfig.value
  const defaultCount = defaultModel ? 1 : 0
  // Hermes 只支持一个默认模型，所以可用模型是所有非默认模型的模型
  const availableCount = availableModels.value.filter(m => m.id !== defaultModel).length
  
  return { default: defaultCount, available: availableCount }
})

const avgContextWindow = computed(() => {
  const withWindow = modelStore.models.filter((m) => m.contextWindow && m.contextWindow > 0)
  if (withWindow.length === 0) return 0
  const sum = withWindow.reduce((acc, m) => acc + (m.contextWindow || 0), 0)
  return Math.round(sum / withWindow.length)
})

function formatContextWindow(val: number): string {
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(1) + 'M'
  if (val >= 1_000) return (val / 1_000).toFixed(1) + 'K'
  return val.toLocaleString()
}

// ---- Provider 筛选选项 ----

const providerOptions = computed<SelectOption[]>(() => {
  const providers = [...new Set(modelStore.models.map((m) => m.provider).filter(Boolean))] as string[]
  return [
    { label: t('pages.hermesModels.allProviders'), value: '__all__' },
    ...providers.map((p) => ({ label: p, value: p })),
  ]
})

// ---- 过滤后的模型列表 ----

const filteredModels = computed(() => {
  let list = modelStore.models
  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (m) =>
        (m.label || m.id).toLowerCase().includes(q) ||
        (m.description || '').toLowerCase().includes(q) ||
        (m.provider || '').toLowerCase().includes(q),
    )
  }
  if (providerFilter.value && providerFilter.value !== '__all__') {
    list = list.filter((m) => m.provider === providerFilter.value)
  }
  return list
})

// ---- 能力标签颜色映射 ----

const capabilityColors: Record<string, 'default' | 'primary' | 'info' | 'success' | 'warning' | 'error'> = {
  chat: 'success',
  completion: 'info',
  vision: 'warning',
  function_calling: 'error',
  tool_use: 'error',
  embedding: 'default',
  image_generation: 'warning',
  code: 'info',
  reasoning: 'success',
}

function getCapabilityType(cap: string): 'default' | 'primary' | 'info' | 'success' | 'warning' | 'error' {
  const lower = cap.toLowerCase()
  for (const [key, type] of Object.entries(capabilityColors)) {
    if (lower.includes(key)) return type
  }
  return 'default'
}

// ---- Provider 配置相关 ----

const revealedKeys = ref<Set<string>>(new Set())
const editingProvider = ref<HermesProviderConfig | null>(null)
const showConfigForm = ref(false)
const configFormApiKey = ref('')
const configFormBaseUrl = ref('')
const configFormModel = ref('')
const configFormSaving = ref(false)
const configFormModels = ref<{ id: string; name?: string }[]>([])
const configFormModelsLoading = ref(false)

function getProviderEnvVar(provider: HermesProviderConfig): HermesEnvVar | undefined {
  const vars = modelStore.envVars
  if (!Array.isArray(vars)) return undefined
  return vars.find((v) => v.key === provider.envKey)
}

function getProviderBaseUrlVar(provider: HermesProviderConfig): HermesEnvVar | undefined {
  if (!provider.baseUrlKey) return undefined
  const vars = modelStore.envVars
  if (!Array.isArray(vars)) return undefined
  return vars.find((v) => v.key === provider.baseUrlKey)
}

function isProviderConfigured(provider: HermesProviderConfig): boolean {
  const envVar = getProviderEnvVar(provider)
  if (envVar) {
    if (envVar.value && envVar.value.trim()) return true
    if (envVar.masked) return true
  }
  const rawVars = modelStore.rawEnvVars as Record<string, { is_set?: boolean; redacted_value?: string }> | null
  if (rawVars && rawVars[provider.envKey]?.is_set === true) return true
  if (provider.id === 'custom') {
    const providers = configStore.config?.providers as Record<string, { base_url?: string }> | undefined
    if (providers?.openai?.base_url) return true
  }
  return false
}

function maskApiKey(value: string): string {
  if (!value || value.length < 8) return '****'
  const prefix = value.slice(0, 6)
  const suffix = value.slice(-4)
  return `${prefix}****${suffix}`
}

function getProviderDisplayApiKey(provider: HermesProviderConfig): string {
  const envVar = getProviderEnvVar(provider)
  if (!envVar) {
    const rawVars = modelStore.rawEnvVars as Record<string, { is_set?: boolean; redacted_value?: string }> | null
    if (rawVars && rawVars[provider.envKey]?.is_set === true) {
      return rawVars[provider.envKey]!.redacted_value as string || '********'
    }
    return ''
  }
  if (!envVar.value || !envVar.value.trim()) {
    if (envVar.masked) return '********'
    const rawVars = modelStore.rawEnvVars as Record<string, { is_set?: boolean; redacted_value?: string }> | null
    if (rawVars && rawVars[provider.envKey]?.is_set === true) {
      return rawVars[provider.envKey]!.redacted_value as string || '********'
    }
    return ''
  }
  if (revealedKeys.value.has(provider.envKey)) {
    return envVar.value
  }
  if (envVar.masked) return '********'
  return maskApiKey(envVar.value)
}

function getProviderDisplayBaseUrl(provider: HermesProviderConfig): HermesEnvVar | undefined {
  if (!provider.baseUrlKey) return undefined
  const vars = modelStore.envVars
  if (!Array.isArray(vars)) return undefined
  return vars.find((v) => v.key === provider.baseUrlKey)
}

function getProviderDisplayBaseUrlValue(provider: HermesProviderConfig): string {
  const envVar = getProviderDisplayBaseUrl(provider)
  if (!envVar) {
    const rawVars = modelStore.rawEnvVars as Record<string, { is_set?: boolean; redacted_value?: string }> | null
    if (rawVars && provider.baseUrlKey && rawVars[provider.baseUrlKey]?.is_set === true) {
      return rawVars[provider.baseUrlKey]!.redacted_value as string || provider.defaultBaseUrl || ''
    }
    if (provider.id === 'custom') {
      const providers = configStore.config?.providers as Record<string, { base_url?: string }> | undefined
      if (providers?.openai?.base_url) return providers.openai.base_url
    }
    return provider.defaultBaseUrl || ''
  }
  if (!envVar.value || !envVar.value.trim()) {
    const rawVars = modelStore.rawEnvVars as Record<string, { is_set?: boolean; redacted_value?: string }> | null
    if (rawVars && provider.baseUrlKey && rawVars[provider.baseUrlKey]?.is_set === true) {
      return rawVars[provider.baseUrlKey]!.redacted_value as string || provider.defaultBaseUrl || ''
    }
    if (provider.id === 'custom') {
      const providers = configStore.config?.providers as Record<string, { base_url?: string }> | undefined
      if (providers?.openai?.base_url) return providers.openai.base_url
    }
    return provider.defaultBaseUrl || ''
  }
  if (revealedKeys.value.has(provider.baseUrlKey!) && !envVar.masked) {
    return envVar.value
  }
  return envVar.value
}

async function handleOpenConfig(provider: HermesProviderConfig) {
  editingProvider.value = provider
  configFormApiKey.value = ''
  configFormBaseUrl.value = provider.defaultBaseUrl || ''
  configFormModel.value = ''
  configFormModels.value = []
  showConfigForm.value = true
}

async function handleEditConfig(provider: HermesProviderConfig) {
  editingProvider.value = provider
  configFormApiKey.value = ''
  configFormBaseUrl.value = getProviderDisplayBaseUrlValue(provider)
  configFormModel.value = currentModelFromConfig.value || ''
  configFormModels.value = []
  const rawVars = modelStore.rawEnvVars as Record<string, { is_set?: boolean; redacted_value?: string }> | null
  if (rawVars && provider.baseUrlKey && rawVars[provider.baseUrlKey]?.redacted_value) {
    configFormBaseUrl.value = rawVars[provider.baseUrlKey]!.redacted_value as string
  }
  showConfigForm.value = true
}

async function fetchConfigFormModels() {
  const baseUrl = configFormBaseUrl.value.trim() || editingProvider.value?.defaultBaseUrl
  if (!baseUrl) {
    message.warning(t('pages.hermesModels.availableModels.noEndpoint'))
    return
  }

  configFormModelsLoading.value = true
  configFormModels.value = []

  try {
    // 传递渠道商配置信息
    const providerConfig = editingProvider.value ? {
      modelsApiPath: editingProvider.value.modelsApiPath,
      modelsApiAuthType: editingProvider.value.modelsApiAuthType,
      modelsApiExtraHeaders: editingProvider.value.modelsApiExtraHeaders,
      modelsApiQueryParam: editingProvider.value.modelsApiQueryParam,
      defaultBaseUrl: editingProvider.value.defaultBaseUrl,
    } : undefined

    const models = await fetchModelsFromEndpoint(
      baseUrl,
      configFormApiKey.value.trim() || undefined,
      providerConfig
    )
    configFormModels.value = models
    if (models.length > 0 && !configFormModel.value) {
      configFormModel.value = models[0]!.id
    }
    message.success(t('pages.hermesModels.customProvider.modelsFound', { count: models.length }))
  } catch (error) {
    console.error('[HermesModelsPage] fetchConfigFormModels failed:', error)
    const errorMsg = error instanceof Error ? error.message : String(error)
    message.error(t('pages.hermesModels.availableModels.fetchFailed') + ': ' + errorMsg)
  } finally {
    configFormModelsLoading.value = false
  }
}

function handleCancelConfig() {
  editingProvider.value = null
  showConfigForm.value = false
  configFormApiKey.value = ''
  configFormBaseUrl.value = ''
  configFormModel.value = ''
}

async function handleSaveConfig() {
  if (!editingProvider.value) return

  configFormSaving.value = true
  try {
    // 保存环境变量
    if (configFormApiKey.value.trim()) {
      await modelStore.setEnvVar(editingProvider.value.envKey, configFormApiKey.value.trim())
    }
    if (editingProvider.value.baseUrlKey && configFormBaseUrl.value.trim()) {
      await modelStore.setEnvVar(editingProvider.value.baseUrlKey, configFormBaseUrl.value.trim())
    }
    
    // 如果选择了模型，设置为默认模型
    if (configFormModel.value.trim()) {
      const modelConfig: Record<string, unknown> = {
        default: configFormModel.value.trim(),
        provider: editingProvider.value.id,
      }
      
      // 如果是自定义端点，添加 base_url
      if (editingProvider.value.id === 'custom' && configFormBaseUrl.value.trim()) {
        modelConfig.base_url = configFormBaseUrl.value.trim()
        if (configFormApiKey.value.trim()) {
          modelConfig.api_key = configFormApiKey.value.trim()
        }
      }
      
      await configStore.updateConfig({ model: modelConfig } as any)
    }
    message.success(t('pages.hermesModels.providerConfig.saveSuccess'))
    handleCancelConfig()
    await configStore.fetchConfig()
  } catch {
    message.error(t('pages.hermesModels.providerConfig.saveFailed'))
  } finally {
    configFormSaving.value = false
  }
}

async function handleDeleteConfig(provider: HermesProviderConfig) {
  try {
    const envVar = getProviderEnvVar(provider)
    const rawVars = modelStore.rawEnvVars as Record<string, { is_set?: boolean; redacted_value?: string }> | null
    const isSet = envVar?.value?.trim() || envVar?.masked || rawVars?.[provider.envKey]?.is_set === true
    
    if (isSet) {
      await modelStore.deleteEnvVar(provider.envKey)
    }
    
    if (provider.baseUrlKey) {
      const baseUrlVar = getProviderBaseUrlVar(provider)
      const baseUrlIsSet = baseUrlVar?.value?.trim() || rawVars?.[provider.baseUrlKey]?.is_set === true
      if (baseUrlVar && baseUrlIsSet) {
        await modelStore.deleteEnvVar(provider.baseUrlKey)
      }
    }
    
    revealedKeys.value.delete(provider.envKey)
    if (provider.baseUrlKey) {
      revealedKeys.value.delete(provider.baseUrlKey)
    }
    
    await modelStore.fetchEnvVars()
    message.success(t('pages.hermesModels.providerConfig.deleteSuccess'))
  } catch (error) {
    console.error('[HermesModelsPage] handleDeleteConfig failed:', error)
    message.error(t('pages.hermesModels.providerConfig.deleteFailed'))
  }
}

async function handleRevealKey(provider: HermesProviderConfig) {
  try {
    const value = await modelStore.revealEnvVar(provider.envKey)
    revealedKeys.value.add(provider.envKey)
    const vars = modelStore.envVars
    if (Array.isArray(vars)) {
      const idx = vars.findIndex((v) => v.key === provider.envKey)
      if (idx >= 0) {
        vars[idx] = { ...vars[idx]!, value, masked: false }
      }
    }
  } catch {
    message.error(t('pages.hermesModels.providerConfig.revealFailed'))
  }
}

async function handleRevealBaseUrl(provider: HermesProviderConfig) {
  if (!provider.baseUrlKey) return
  try {
    const value = await modelStore.revealEnvVar(provider.baseUrlKey)
    revealedKeys.value.add(provider.baseUrlKey)
    const vars = modelStore.envVars
    if (Array.isArray(vars)) {
      const idx = vars.findIndex((v) => v.key === provider.baseUrlKey)
      if (idx >= 0) {
        vars[idx] = { ...vars[idx]!, value, masked: false }
      }
    }
  } catch {
    message.error(t('pages.hermesModels.providerConfig.revealFailed'))
  }
}

async function handleTabChange(tab: string) {
  if (tab === 'providers') {
    const vars = modelStore.envVars
    if (!Array.isArray(vars) || vars.length === 0) {
      await modelStore.fetchEnvVars()
    }
  }
}

// ---- 生命周期 ----

onMounted(async () => {
  try {
    // 确保 Hermes 连接已建立
    if (!connStore.hermesConnected) {
      // 先加载配置，再连接
      await connStore.loadConfigFromBackend()
      const connected = await connStore.connect()
      
      // 如果连接失败，等待重试
      if (!connected) {
        // 等待最多 5 秒让自动重连机制工作
        for (let i = 0; i < 10; i++) {
          await new Promise(resolve => setTimeout(resolve, 500))
          if (connStore.hermesConnected) break
        }
      }
    }
    
    // 检查连接状态
    if (!connStore.hermesConnected) {
      message.error(t('pages.hermesModels.connectionFailed') || 'Hermes 连接失败，请检查 Hermes Dashboard 是否运行')
      return
    }
    
    // 等待连接成功后再获取数据
    await Promise.all([modelStore.fetchModels(), configStore.fetchConfig()])
    if (currentModelFromConfig.value) {
      modelStore.syncCurrentModelFromConfig(currentModelFromConfig.value)
    }
  } catch (error) {
    console.error('[HermesModelsPage] onMounted failed:', error)
    // 连接失败时显示错误提示
    if (!connStore.hermesConnected) {
      message.error(t('pages.hermesModels.connectionFailed') || 'Hermes 连接失败，请检查 Hermes Dashboard 是否运行')
    }
  }
})

// ---- 操作 ----

async function handleRefresh() {
  try {
    await modelStore.fetchModels()
  } catch {
    message.error(t('pages.hermesModels.loadFailed'))
  }
}

async function handleSetModel(modelId: string) {
  try {
    await modelStore.setCurrentModel(modelId)
    message.success(t('pages.hermesModels.setModelSuccess', { model: modelId }))
  } catch {
    message.error(t('pages.hermesModels.setModelFailed'))
  }
}

// ---- 自定义端点管理 ----

function handleOpenCustomProviderForm() {
  editingCustomProvider.value = null
  customProviderFormName.value = ''
  customProviderFormBaseUrl.value = ''
  customProviderFormApiKey.value = ''
  customProviderFormModel.value = ''
  showCustomProviderForm.value = true
}

function handleEditCustomProvider(provider: HermesCustomProvider) {
  editingCustomProvider.value = provider
  customProviderFormName.value = provider.name
  customProviderFormBaseUrl.value = provider.base_url
  // 编辑时不显示原始 API Key，用户需要重新输入或留空保持不变
  customProviderFormApiKey.value = ''
  // 显示该端点配置的模型（custom_providers[].model）
  customProviderFormModel.value = provider.model || ''
  // 显示上下文窗口大小
  customProviderFormContextWindow.value = provider.context_window || null
  showCustomProviderForm.value = true
}

function handleCancelCustomProviderForm() {
  showCustomProviderForm.value = false
  editingCustomProvider.value = null
  customProviderFormName.value = ''
  customProviderFormBaseUrl.value = ''
  customProviderFormApiKey.value = ''
  customProviderFormModel.value = ''
  customProviderFormContextWindow.value = null
  customProviderFormModels.value = []
}

async function handleSaveCustomProvider() {
  if (!customProviderFormName.value.trim() || !customProviderFormBaseUrl.value.trim()) {
    message.error(t('pages.hermesModels.customProvider.nameRequired'))
    return
  }

  customProviderFormSaving.value = true
  try {
    const newProvider: HermesCustomProvider = {
      name: customProviderFormName.value.trim(),
      base_url: customProviderFormBaseUrl.value.trim(),
    }
    
    // 处理 API Key：如果用户输入了新值则使用新值，否则保留原值
    if (customProviderFormApiKey.value.trim()) {
      newProvider.api_key = customProviderFormApiKey.value.trim()
    } else if (editingCustomProvider.value?.api_key) {
      // 编辑模式下，如果用户没有输入新的 API Key，保留原来的值
      newProvider.api_key = editingCustomProvider.value.api_key
    }

    // 如果选择了模型，添加到 custom_provider.model 中
    // 注意：这只是该端点的模型配置，不是全局默认模型
    if (customProviderFormModel.value.trim()) {
      newProvider.model = customProviderFormModel.value.trim()
    }

    // 如果设置了上下文窗口大小
    if (customProviderFormContextWindow.value && customProviderFormContextWindow.value > 0) {
      newProvider.context_window = customProviderFormContextWindow.value
    }

    const existingProviders = [...customProviders.value]
    const existingIndex = existingProviders.findIndex(p => p.name === editingCustomProvider.value?.name)
    
    if (editingCustomProvider.value && existingIndex >= 0) {
      existingProviders[existingIndex] = newProvider
    } else {
      existingProviders.push(newProvider)
    }

    // 只更新 custom_providers，不更新全局 model.default
    // 全局默认模型需要用户在模型列表中主动选择
    const configUpdate: Record<string, unknown> = { 
      custom_providers: existingProviders 
    }

    await configStore.updateConfig(configUpdate as any)

    message.success(t('pages.hermesModels.customProvider.saveSuccess'))
    handleCancelCustomProviderForm()
    await configStore.fetchConfig()
  } catch {
    message.error(t('pages.hermesModels.customProvider.saveFailed'))
  } finally {
    customProviderFormSaving.value = false
  }
}

async function handleDeleteCustomProvider(providerName: string) {
  try {
    const existingProviders = customProviders.value.filter(p => p.name !== providerName)
    await configStore.updateConfig({ custom_providers: existingProviders } as any)
    message.success(t('pages.hermesModels.customProvider.deleteSuccess'))
    await configStore.fetchConfig()
  } catch {
    message.error(t('pages.hermesModels.customProvider.deleteFailed'))
  }
}
</script>

<template>
  <div class="hermes-models-page">
    <!-- 页面标题 -->
    <div class="hermes-models-header">
      <h2 class="hermes-models-title">{{ t('pages.hermesModels.title') }}</h2>
      <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" :loading="modelStore.loading" @click="handleRefresh">
        <template #icon><NIcon :component="RefreshOutline" /></template>
        {{ t('common.refresh') }}
      </NButton>
    </div>

    <!-- 错误提示 -->
    <NAlert v-if="modelStore.lastError" type="error" :bordered="false" closable class="app-card">
      {{ modelStore.lastError }}
    </NAlert>

    <!-- 概览统计面板 -->
    <NCard :bordered="false" class="app-card hermes-stats-panel">
      <NGrid cols="1 s:2 m:4" responsive="screen" :x-gap="16" :y-gap="16">
        <NGridItem>
          <div class="stat-item">
            <div class="stat-icon stat-icon--green">
              <NIcon :component="CheckmarkCircleOutline" :size="20" />
            </div>
            <div class="stat-content">
              <NText depth="3" class="stat-label">{{ t('pages.hermesModels.stats.activeModel') }}</NText>
              <div class="stat-value stat-value--text">{{ currentModelFromConfig || '-' }}</div>
            </div>
          </div>
        </NGridItem>
        <NGridItem>
          <div class="stat-item">
            <div class="stat-icon stat-icon--purple">
              <NIcon :component="ServerOutline" :size="20" />
            </div>
            <div class="stat-content">
              <NText depth="3" class="stat-label">{{ t('pages.hermesModels.stats.currentProvider') }}</NText>
              <div class="stat-value stat-value--text">{{ currentProviderFromConfig?.name || '-' }}</div>
            </div>
          </div>
        </NGridItem>
        <NGridItem>
          <div class="stat-item">
            <div class="stat-icon stat-icon--blue">
              <NIcon :component="CloudOutline" :size="20" />
            </div>
            <div class="stat-content">
              <NText depth="3" class="stat-label">{{ t('pages.hermesModels.stats.endpoint') }}</NText>
              <div class="stat-value stat-value--text stat-value--small">{{ currentProviderFromConfig?.base_url || '-' }}</div>
            </div>
          </div>
        </NGridItem>
        <NGridItem>
          <div class="stat-item">
            <div class="stat-icon stat-icon--orange">
              <NIcon :component="CubeOutline" :size="20" />
            </div>
            <div class="stat-content">
              <NText depth="3" class="stat-label">{{ t('pages.hermesModels.stats.configuredProviders') }}</NText>
              <div class="stat-value">{{ customProviders.length }}</div>
            </div>
          </div>
        </NGridItem>
      </NGrid>
    </NCard>

    <!-- 标签页 -->
    <NCard :bordered="false" class="app-card">
      <NTabs v-model:value="activeTab" type="line" animated @update:value="handleTabChange">
        <!-- 模型列表标签页 -->
        <NTabPane name="models" :tab="t('pages.hermesModels.tabs.models')">
          <!-- 当前配置卡片 -->
          <div class="current-config-section">
            <NText strong class="section-title">{{ t('pages.hermesModels.currentConfig.title') }}</NText>
            
            <NGrid cols="1" responsive="screen" :x-gap="12" :y-gap="12">
              <!-- 当前 Provider -->
              <NGridItem>
                <NCard class="app-card config-card" :class="{ 'config-card--selected': selectedProvider }" :bordered="false">
                  <div class="config-card-content">
                    <div class="config-card-header">
                      <NIcon :component="ServerOutline" :size="20" class="config-icon" />
                      <NText strong>{{ t('pages.hermesModels.currentConfig.provider') }}</NText>
                      <NTag v-if="selectedProvider" type="info" size="small" :bordered="false" round>
                        {{ selectedProvider.type === 'custom' ? t('pages.hermesModels.customProvider.divider') : t('pages.hermesModels.configuredProviders.title') }}
                      </NTag>
                    </div>
                    <div class="config-card-value">
                      <NText v-if="displayProvider" class="config-value-text">{{ displayProvider.name }}</NText>
                      <NText v-else depth="3">{{ t('pages.hermesModels.currentConfig.notSet') }}</NText>
                    </div>
                    <div v-if="displayProvider?.base_url" class="config-card-sub">
                      <NText depth="3" style="font-size: 12px;">{{ displayProvider.base_url }}</NText>
                    </div>
                  </div>
                </NCard>
              </NGridItem>

              <!-- 已添加的模型列表 -->
              <NGridItem>
                <NCard class="app-card config-card" :bordered="false">
                  <div class="config-card-content">
                    <div class="config-card-header">
                      <NIcon :component="CubeOutline" :size="20" class="config-icon" />
                      <NText strong>{{ t('pages.hermesModels.currentConfig.modelList') }}</NText>
                      <NTag v-if="allAddedModels.length > 0" type="info" size="small" :bordered="false" round>
                        {{ allAddedModels.length }}
                      </NTag>
                    </div>
                    <div v-if="allAddedModels.length > 0" class="added-models-grid">
                      <div 
                        v-for="model in allAddedModels" 
                        :key="model.id" 
                        class="added-model-card"
                        :class="{ 'added-model-card--default': isGlobalDefaultModel(model.id, model.provider) }"
                      >
                        <div class="added-model-card-header">
                          <div 
                            class="status-dot" 
                            :class="isGlobalDefaultModel(model.id, model.provider) ? 'status-dot--default' : 'status-dot--added'"
                          ></div>
                          <NText class="added-model-card-name" :title="model.id">{{ model.id }}</NText>
                        </div>
                        <div class="added-model-card-body">
                          <NText depth="3" style="font-size: 11px;">{{ model.providerName }}</NText>
                        </div>
                        <div class="added-model-card-footer">
                          <!-- 全局默认模型 -->
                          <template v-if="isGlobalDefaultModel(model.id, model.provider)">
                            <NTag type="success" size="tiny" :bordered="false" round>
                              <template #icon><NIcon :component="StarOutline" :size="10" /></template>
                              {{ t('pages.hermesModels.modelStatus.globalDefault') }}
                            </NTag>
                          </template>
                          <!-- 非全局默认模型 - 显示设置按钮 -->
                          <template v-else>
                            <NButton
                              size="tiny"
                              type="primary"
                              secondary
                              round
                              @click.stop="openSetDefaultModelModal(model.id)"
                            >
                              <template #icon><NIcon :component="StarOutline" :size="10" /></template>
                              {{ t('pages.hermesModels.modelStatus.setGlobalDefault') }}
                            </NButton>
                          </template>
                        </div>
                      </div>
                    </div>
                    <NText v-else depth="3">{{ t('pages.hermesModels.currentConfig.noModels') }}</NText>
                  </div>
                </NCard>
              </NGridItem>
            </NGrid>

            <!-- 查看可用模型按钮 -->
            <div style="margin-top: 12px;">
              <NButton
                type="primary"
                secondary
                class="app-toolbar-btn"
                :loading="availableModelsLoading"
                :disabled="!displayProvider?.base_url"
                @click="fetchAvailableModels"
              >
                <template #icon><NIcon :component="SearchOutline" /></template>
                {{ t('pages.hermesModels.availableModels.fetchButton') }}
              </NButton>
            </div>

            <!-- 可用模型列表 -->
            <div v-if="showAvailableModels" class="available-models-section">
              <NText strong class="section-title">
                {{ t('pages.hermesModels.availableModels.title') }}
                <NText v-if="availableModels.length > 0" depth="3" style="font-weight: normal; margin-left: 8px;">
                  ({{ availableModels.length }})
                </NText>
              </NText>
              
              <!-- 图例说明 -->
              <NSpace :size="16" style="margin-bottom: 16px;">
                <NSpace :size="4" align="center">
                  <div class="status-dot status-dot--default"></div>
                  <NText depth="3" style="font-size: 12px;">{{ t('pages.hermesModels.modelStatus.default') }}</NText>
                  <NText v-if="modelStatusCounts.default > 0" type="success" style="font-size: 12px; font-weight: 600;">
                    ({{ modelStatusCounts.default }})
                  </NText>
                </NSpace>
                <NSpace :size="4" align="center">
                  <div class="status-dot status-dot--available"></div>
                  <NText depth="3" style="font-size: 12px;">{{ t('pages.hermesModels.modelStatus.available') }}</NText>
                  <NText v-if="modelStatusCounts.available > 0" depth="3" style="font-size: 12px; font-weight: 600;">
                    ({{ modelStatusCounts.available }})
                  </NText>
                </NSpace>
              </NSpace>
              
              <NSpin :show="availableModelsLoading">
                <div v-if="availableModels.length > 0" class="models-grid">
                  <div
                    v-for="model in availableModels"
                    :key="model.id"
                    class="model-card"
                    :class="{
                      'model-card--default': model.id === currentModelFromConfig,
                      'model-card--available': model.id !== currentModelFromConfig,
                    }"
                  >
                    <div class="model-card-header">
                      <div class="model-card-status">
                        <div 
                          class="status-dot" 
                          :class="{
                            'status-dot--default': model.id === currentModelFromConfig,
                            'status-dot--available': model.id !== currentModelFromConfig,
                          }"
                        ></div>
                      </div>
                      <NText class="model-card-name" :title="model.id">{{ model.id }}</NText>
                    </div>
                    
                    <div class="model-card-body">
                      <NText v-if="model.name && model.name !== model.id" depth="3" style="font-size: 12px;">
                        {{ model.name }}
                      </NText>
                    </div>
                    
                    <div class="model-card-footer">
                      <!-- 全局默认模型 -->
                      <template v-if="isGlobalDefaultModel(model.id)">
                        <NTag type="success" size="small" :bordered="false" round>
                          <template #icon><NIcon :component="StarOutline" :size="12" /></template>
                          {{ t('pages.hermesModels.modelStatus.globalDefault') }}
                        </NTag>
                      </template>
                      
                      <!-- 可用模型 - 显示设为全局默认按钮 -->
                      <template v-else>
                        <NButton
                          size="tiny"
                          type="primary"
                          secondary
                          round
                          @click.stop="openSetDefaultModelModal(model.id)"
                        >
                          <template #icon><NIcon :component="StarOutline" :size="12" /></template>
                          {{ t('pages.hermesModels.modelStatus.setGlobalDefault') }}
                        </NButton>
                      </template>
                    </div>
                  </div>
                </div>
                <NText v-else-if="!availableModelsLoading" depth="3" class="empty-hint">
                  {{ t('pages.hermesModels.availableModels.empty') }}
                </NText>
              </NSpin>
            </div>
          </div>

          <!-- 已配置的 Provider 列表 -->
          <div class="configured-providers-section">
            <NText strong class="section-title">{{ t('pages.hermesModels.configuredProviders.title') }}</NText>
            
            <NSpin :show="modelStore.envLoading">
              <div v-if="configuredProviders.length > 0" class="provider-grid">
                <NCard
                  v-for="provider in configuredProviders"
                  :key="provider.id"
                  class="app-card provider-info-card"
                  :class="{ 'provider-info-card--selected': isProviderSelected(provider.id, 'configured') }"
                  :bordered="false"
                  hoverable
                  @click="selectProvider({ id: provider.id, name: provider.name, base_url: provider.baseUrl, type: 'configured' })"
                >
                  <div class="provider-info-content">
                    <NSpace align="center" :size="8">
                      <NIcon :component="KeyOutline" :size="16" class="provider-icon" />
                      <NText strong>{{ provider.name }}</NText>
                      <NTag v-if="provider.recommended" type="success" size="small" :bordered="false" round>
                        {{ t('pages.hermesModels.providerConfig.recommended') }}
                      </NTag>
                      <NTag v-if="isProviderSelected(provider.id, 'configured')" type="info" size="small" :bordered="false" round>
                        {{ t('pages.hermesModels.configuredProviders.selected') }}
                      </NTag>
                    </NSpace>
                    <div class="provider-details">
                      <div class="detail-row">
                        <NText depth="3" class="detail-label">API Key:</NText>
                        <NText class="detail-value">{{ provider.apiKeyDisplay }}</NText>
                      </div>
                      <div v-if="provider.baseUrl" class="detail-row">
                        <NText depth="3" class="detail-label">Base URL:</NText>
                        <NText class="detail-value">{{ provider.baseUrl }}</NText>
                      </div>
                    </div>
                  </div>
                </NCard>
              </div>
              <NText v-else depth="3" class="empty-hint">
                {{ t('pages.hermesModels.configuredProviders.empty') }}
              </NText>
            </NSpin>
          </div>

          <!-- 自定义端点列表 -->
          <div v-if="customProviders.length > 0" class="custom-endpoints-section">
            <NText strong class="section-title">{{ t('pages.hermesModels.customProvider.divider') }}</NText>
            
            <div class="provider-grid">
              <NCard
                v-for="provider in customProviders"
                :key="provider.name"
                class="app-card provider-info-card"
                :class="{ 'provider-info-card--selected': isProviderSelected(provider.name, 'custom') }"
                :bordered="false"
                hoverable
                @click="selectProvider({ id: provider.name, name: provider.name, base_url: provider.base_url, type: 'custom' })"
              >
                <div class="provider-info-content">
                  <NSpace align="center" :size="8">
                    <NIcon :component="ServerOutline" :size="16" class="provider-icon" />
                    <NText strong>{{ provider.name }}</NText>
                    <NTag v-if="isProviderSelected(provider.name, 'custom')" type="info" size="small" :bordered="false" round>
                      {{ t('pages.hermesModels.configuredProviders.selected') }}
                    </NTag>
                  </NSpace>
                  <div class="provider-details">
                    <div class="detail-row">
                      <NText depth="3" class="detail-label">Base URL:</NText>
                      <NText class="detail-value">{{ provider.base_url }}</NText>
                    </div>
                    <div v-if="provider.api_key" class="detail-row">
                      <NText depth="3" class="detail-label">API Key:</NText>
                      <NText class="detail-value">{{ maskApiKey(provider.api_key) }}</NText>
                    </div>
                  </div>
                </div>
              </NCard>
            </div>
          </div>
        </NTabPane>

        <!-- Provider 配置标签页 -->
        <NTabPane name="providers" :tab="t('pages.hermesModels.tabs.providers')">
          <NSpin :show="modelStore.envLoading">
            <!-- Provider 卡片列表 -->
            <div class="provider-list">
              <div
                v-for="provider in HERMES_PROVIDERS"
                :key="provider.id"
                class="provider-card"
              >
                <div class="provider-header">
                  <div class="provider-info">
                    <NSpace :size="8" align="center">
                      <NIcon :component="KeyOutline" :size="18" class="provider-icon" />
                      <NText strong class="provider-name">{{ provider.name }}</NText>
                      <NTag
                        v-if="provider.recommended"
                        type="success"
                        size="small"
                        :bordered="false"
                        round
                      >
                        {{ t('pages.hermesModels.providerConfig.recommended') }}
                      </NTag>
                    </NSpace>
                    <NText v-if="provider.description" depth="3" class="provider-description">
                      {{ provider.description }}
                    </NText>
                  </div>
                  <div class="provider-status">
                    <NTag
                      :type="isProviderConfigured(provider) ? 'success' : 'default'"
                      :bordered="false"
                      round
                      size="small"
                    >
                      {{ isProviderConfigured(provider) ? t('pages.hermesModels.providerConfig.configured') : t('pages.hermesModels.providerConfig.notConfigured') }}
                    </NTag>
                  </div>
                </div>

                <!-- 已配置时显示信息 -->
                <div v-if="isProviderConfigured(provider)" class="provider-config-info">
                  <div class="config-item">
                    <NText depth="3" class="config-label">API Key:</NText>
                    <NText class="config-value">{{ getProviderDisplayApiKey(provider) }}</NText>
                    <NButton
                      v-if="getProviderEnvVar(provider)?.masked && !revealedKeys.has(provider.envKey)"
                      size="tiny"
                      quaternary
                      class="app-toolbar-btn"
                      @click="handleRevealKey(provider)"
                    >
                      <template #icon><NIcon :component="EyeOutline" :size="14" /></template>
                    </NButton>
                  </div>
                  <div v-if="provider.baseUrlKey" class="config-item">
                    <NText depth="3" class="config-label">Base URL:</NText>
                    <NText class="config-value">{{ getProviderDisplayBaseUrlValue(provider) }}</NText>
                    <NButton
                      v-if="getProviderDisplayBaseUrl(provider)?.masked && !revealedKeys.has(provider.baseUrlKey)"
                      size="tiny"
                      quaternary
                      class="app-toolbar-btn"
                      @click="handleRevealBaseUrl(provider)"
                    >
                      <template #icon><NIcon :component="EyeOutline" :size="14" /></template>
                    </NButton>
                  </div>
                </div>

                <!-- 操作按钮 -->
                <div class="provider-actions">
                  <NButton
                    v-if="!isProviderConfigured(provider)"
                    size="small"
                    type="primary"
                    secondary
                    class="app-toolbar-btn"
                    @click="handleOpenConfig(provider)"
                  >
                    <template #icon><NIcon :component="KeyOutline" /></template>
                    {{ t('pages.hermesModels.providerConfig.configure') }}
                  </NButton>
                  <template v-else>
                    <NButton
                      size="small"
                      secondary
                      class="app-toolbar-btn"
                      @click="handleEditConfig(provider)"
                    >
                      <template #icon><NIcon :component="CreateOutline" /></template>
                      {{ t('pages.hermesModels.providerConfig.edit') }}
                    </NButton>
                    <NButton
                      size="small"
                      type="error"
                      secondary
                      class="app-toolbar-btn"
                      @click="handleDeleteConfig(provider)"
                    >
                      <template #icon><NIcon :component="TrashOutline" /></template>
                      {{ t('pages.hermesModels.providerConfig.delete') }}
                    </NButton>
                  </template>
                  <NButton
                    v-if="provider.docsUrl"
                    size="small"
                    quaternary
                    tag="a"
                    :href="provider.docsUrl"
                    target="_blank"
                    class="app-toolbar-btn"
                  >
                    <template #icon><NIcon :component="LinkOutline" /></template>
                    {{ t('pages.hermesModels.providerConfig.docs') }}
                  </NButton>
                </div>
              </div>
            </div>

            <!-- 自定义端点分隔线 -->
            <NDivider style="margin: 16px 0;">
              <NSpace :size="8" align="center">
                <NIcon :component="ServerOutline" :size="16" />
                <NText depth="3">{{ t('pages.hermesModels.customProvider.divider') }}</NText>
              </NSpace>
            </NDivider>

            <!-- 自定义端点列表 -->
            <div class="provider-list">
              <div
                v-for="provider in customProviders"
                :key="provider.name"
                class="provider-card"
              >
                <div class="provider-header">
                  <div class="provider-info">
                    <NSpace :size="8" align="center">
                      <NIcon :component="ServerOutline" :size="18" class="provider-icon" />
                      <NText strong class="provider-name">{{ provider.name }}</NText>
                    </NSpace>
                  </div>
                  <div class="provider-status">
                    <NTag type="success" :bordered="false" round size="small">
                      {{ t('pages.hermesModels.providerConfig.configured') }}
                    </NTag>
                  </div>
                </div>

                <div class="provider-config-info">
                  <div class="config-item">
                    <NText depth="3" class="config-label">Base URL:</NText>
                    <NText class="config-value">{{ provider.base_url }}</NText>
                  </div>
                  <div v-if="provider.api_key" class="config-item">
                    <NText depth="3" class="config-label">API Key:</NText>
                    <NText class="config-value">{{ maskApiKey(provider.api_key) }}</NText>
                  </div>
                  <div v-if="provider.model" class="config-item">
                    <NText depth="3" class="config-label">Model:</NText>
                    <NText class="config-value">{{ provider.model }}</NText>
                  </div>
                  <div v-if="provider.context_window" class="config-item">
                    <NText depth="3" class="config-label">Context:</NText>
                    <NText class="config-value">{{ provider.context_window.toLocaleString() }} tokens</NText>
                  </div>
                </div>

                <div class="provider-actions">
                  <NButton
                    size="small"
                    secondary
                    class="app-toolbar-btn"
                    @click="handleEditCustomProvider(provider)"
                  >
                    <template #icon><NIcon :component="CreateOutline" /></template>
                    {{ t('pages.hermesModels.providerConfig.edit') }}
                  </NButton>
                  <NButton
                    size="small"
                    type="error"
                    secondary
                    class="app-toolbar-btn"
                    @click="handleDeleteCustomProvider(provider.name)"
                  >
                    <template #icon><NIcon :component="TrashOutline" /></template>
                    {{ t('pages.hermesModels.providerConfig.delete') }}
                  </NButton>
                </div>
              </div>

              <!-- 添加自定义端点按钮 -->
              <NButton
                size="small"
                type="primary"
                dashed
                block
                class="app-toolbar-btn"
                style="margin-top: 8px;"
                @click="handleOpenCustomProviderForm"
              >
                <template #icon><NIcon :component="AddOutline" /></template>
                {{ t('pages.hermesModels.customProvider.add') }}
              </NButton>
            </div>
          </NSpin>
        </NTabPane>
      </NTabs>
    </NCard>

    <!-- Provider 配置表单弹窗 -->
    <div v-if="showConfigForm && editingProvider" class="config-form-overlay" @click.self="handleCancelConfig">
      <NCard class="config-form-card" :bordered="false">
        <template #header>
          <NSpace align="center" :size="8">
            <NIcon :component="KeyOutline" :size="18" />
            <NText strong>
              {{ isProviderConfigured(editingProvider) ? t('pages.hermesModels.providerConfig.editTitle') : t('pages.hermesModels.providerConfig.configureTitle') }}
              - {{ editingProvider.name }}
            </NText>
          </NSpace>
        </template>

        <NSpace vertical :size="16">
          <div>
            <NText strong style="font-size: 14px; display: block; margin-bottom: 8px;">
              API Key
            </NText>
            <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 8px;">
              {{ isProviderConfigured(editingProvider) ? t('pages.hermesModels.providerConfig.editHint') : t('pages.hermesModels.providerConfig.apiKeyHint') }}
            </NText>
            <NInput
              v-model:value="configFormApiKey"
              type="password"
              show-password-on="click"
              :placeholder="t('pages.hermesModels.providerConfig.apiKeyPlaceholder')"
            />
          </div>

          <div v-if="editingProvider.baseUrlKey">
            <NText strong style="font-size: 14px; display: block; margin-bottom: 8px;">
              Base URL
            </NText>
            <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 8px;">
              {{ t('pages.hermesModels.providerConfig.baseUrlHint') }}
            </NText>
            <NInput
              v-model:value="configFormBaseUrl"
              :placeholder="editingProvider.defaultBaseUrl || ''"
            />
          </div>

          <div>
            <NText strong style="font-size: 14px; display: block; margin-bottom: 8px;">
              {{ t('pages.hermesModels.providerConfig.defaultModel') }}
              <NTag v-if="!editingProvider.supportsModelList" type="error" size="small" :bordered="false" round style="margin-left: 4px;">
                {{ t('common.required') }}
              </NTag>
            </NText>
            <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 8px;">
              {{ editingProvider.supportsModelList ? t('pages.hermesModels.providerConfig.defaultModelHint') : t('pages.hermesModels.providerConfig.defaultModelHintCustom') }}
            </NText>
            <NSpace :size="8" align="center">
              <NSelect
                v-model:value="configFormModel"
                :options="configFormModels.map(m => ({ label: m.id, value: m.id }))"
                :placeholder="t('pages.hermesModels.providerConfig.defaultModelPlaceholder')"
                :loading="configFormModelsLoading"
                filterable
                tag
                clearable
                style="flex: 1; min-width: 200px;"
              />
              <NButton
                v-if="editingProvider.supportsModelList"
                secondary
                class="app-toolbar-btn"
                :loading="configFormModelsLoading"
                :disabled="!configFormBaseUrl.trim() && !editingProvider.defaultBaseUrl"
                @click="fetchConfigFormModels"
              >
                <template #icon><NIcon :component="RefreshOutline" :size="16" /></template>
                {{ t('pages.hermesModels.customProvider.fetchModels') }}
              </NButton>
            </NSpace>
            <NText v-if="configFormModels.length > 0" depth="3" style="font-size: 12px; display: block; margin-top: 4px;">
              {{ t('pages.hermesModels.customProvider.modelsAvailable', { count: configFormModels.length }) }}
            </NText>
          </div>

          <NSpace :size="8" justify="end">
            <NButton class="app-toolbar-btn" @click="handleCancelConfig">
              {{ t('common.cancel') }}
            </NButton>
            <NButton
              type="primary"
              class="app-toolbar-btn"
              :loading="configFormSaving"
              :disabled="(!configFormApiKey.trim() && !isProviderConfigured(editingProvider)) || (!editingProvider.supportsModelList && !configFormModel.trim())"
              @click="handleSaveConfig"
            >
              {{ t('common.save') }}
            </NButton>
          </NSpace>
        </NSpace>
      </NCard>
    </div>

    <!-- 自定义端点表单弹窗 -->
    <div v-if="showCustomProviderForm" class="config-form-overlay" @click.self="handleCancelCustomProviderForm">
      <NCard class="config-form-card" :bordered="false">
        <template #header>
          <NSpace align="center" :size="8">
            <NIcon :component="ServerOutline" :size="18" />
            <NText strong>
              {{ editingCustomProvider ? t('pages.hermesModels.customProvider.editTitle') : t('pages.hermesModels.customProvider.addTitle') }}
            </NText>
          </NSpace>
        </template>

        <NSpace vertical :size="16">
          <div>
            <NText strong style="font-size: 14px; display: block; margin-bottom: 8px;">
              {{ t('pages.hermesModels.customProvider.name') }}
              <NTag type="error" size="small" :bordered="false" round style="margin-left: 4px;">
                {{ t('common.required') }}
              </NTag>
            </NText>
            <NInput
              v-model:value="customProviderFormName"
              :placeholder="t('pages.hermesModels.customProvider.namePlaceholder')"
            />
          </div>

          <div>
            <NText strong style="font-size: 14px; display: block; margin-bottom: 8px;">
              Base URL
              <NTag type="error" size="small" :bordered="false" round style="margin-left: 4px;">
                {{ t('common.required') }}
              </NTag>
            </NText>
            <NInput
              v-model:value="customProviderFormBaseUrl"
              placeholder="https://api.example.com/v1"
            />
          </div>

          <div>
            <NText strong style="font-size: 14px; display: block; margin-bottom: 8px;">
              API Key
            </NText>
            <NInput
              v-model:value="customProviderFormApiKey"
              type="password"
              show-password-on="click"
              :placeholder="editingCustomProvider 
                ? t('pages.hermesModels.customProvider.apiKeyEditHint')
                : t('pages.hermesModels.customProvider.apiKeyPlaceholder')"
            />
          </div>

          <div>
            <NText strong style="font-size: 14px; display: block; margin-bottom: 8px;">
              {{ t('pages.hermesModels.customProvider.defaultModel') }}
            </NText>
            <NSpace :size="8" align="center">
              <NSelect
                v-model:value="customProviderFormModel"
                :options="customProviderFormModels.map(m => ({ label: m.id, value: m.id }))"
                :placeholder="t('pages.hermesModels.customProvider.defaultModelPlaceholder')"
                :loading="customProviderFormModelsLoading"
                filterable
                tag
                clearable
                style="flex: 1; min-width: 200px;"
              />
              <NButton
                secondary
                class="app-toolbar-btn"
                :loading="customProviderFormModelsLoading"
                :disabled="!customProviderFormBaseUrl.trim()"
                @click="fetchCustomProviderFormModels"
              >
                <template #icon><NIcon :component="RefreshOutline" :size="16" /></template>
                {{ t('pages.hermesModels.customProvider.fetchModels') }}
              </NButton>
            </NSpace>
            <NText v-if="customProviderFormModels.length > 0" depth="3" style="font-size: 12px; display: block; margin-top: 4px;">
              {{ t('pages.hermesModels.customProvider.modelsAvailable', { count: customProviderFormModels.length }) }}
            </NText>
          </div>

          <!-- 上下文窗口大小 -->
          <div>
            <NText strong style="font-size: 14px; display: block; margin-bottom: 8px;">
              {{ t('pages.hermesModels.customProvider.contextWindow') }}
            </NText>
            <NInputNumber
              v-model:value="customProviderFormContextWindow"
              :placeholder="t('pages.hermesModels.customProvider.contextWindowPlaceholder')"
              :min="1"
              :max="10000000"
              clearable
              style="width: 100%;"
            />
            <NText depth="3" style="font-size: 12px; display: block; margin-top: 4px;">
              {{ t('pages.hermesModels.customProvider.contextWindowHint') }}
            </NText>
          </div>

          <NSpace :size="8" justify="end">
            <NButton class="app-toolbar-btn" @click="handleCancelCustomProviderForm">
              {{ t('common.cancel') }}
            </NButton>
            <NButton
              type="primary"
              class="app-toolbar-btn"
              :loading="customProviderFormSaving"
              :disabled="!customProviderFormName.trim() || !customProviderFormBaseUrl.trim()"
              @click="handleSaveCustomProvider"
            >
              {{ t('common.save') }}
            </NButton>
          </NSpace>
        </NSpace>
      </NCard>
    </div>

    <!-- 设置默认模型弹窗 -->
    <NModal
      v-model:show="showSetDefaultModelModal"
      preset="dialog"
      :title="t('pages.hermesModels.modelStatus.setDefaultTitle')"
      :positive-text="t('common.confirm')"
      :negative-text="t('common.cancel')"
      :loading="setDefaultModelSaving"
      @positive-click="confirmSetDefaultModel"
    >
      <NSpace vertical :size="16">
        <div>
          <NText depth="3">{{ t('pages.hermesModels.modelStatus.setModelConfirm', { model: setDefaultModelId }) }}</NText>
        </div>
        <div>
          <NText strong style="font-size: 14px; display: block; margin-bottom: 8px;">
            {{ t('pages.hermesModels.customProvider.contextWindow') }}
          </NText>
          <NInputNumber
            v-model:value="setDefaultModelContextWindow"
            :placeholder="t('pages.hermesModels.customProvider.contextWindowPlaceholder')"
            :min="1"
            :max="10000000"
            clearable
            style="width: 100%;"
          />
          <NText depth="3" style="font-size: 12px; display: block; margin-top: 4px;">
            {{ t('pages.hermesModels.customProvider.contextWindowHint') }}
          </NText>
        </div>
      </NSpace>
    </NModal>
  </div>
</template>

<style scoped>
.hermes-models-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ---- 页面标题 ---- */

.hermes-models-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.hermes-models-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

/* ---- 概览统计面板 ---- */

.hermes-stats-panel {
  background: linear-gradient(135deg, rgba(22, 163, 74, 0.08), rgba(59, 130, 246, 0.08));
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.stat-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius, 8px);
  flex-shrink: 0;
}

.stat-icon--blue {
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
}

.stat-icon--green {
  background: rgba(22, 163, 74, 0.12);
  color: #16a34a;
}

.stat-icon--purple {
  background: rgba(139, 92, 246, 0.12);
  color: #8b5cf6;
}

.stat-icon--orange {
  background: rgba(249, 115, 22, 0.12);
  color: #f97316;
}

.stat-content {
  min-width: 0;
}

.stat-label {
  font-size: 12px;
  display: block;
}

.stat-value {
  font-size: 22px;
  font-weight: 600;
  margin-top: 4px;
  line-height: 1.2;
}

.stat-value--text {
  font-size: 16px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat-value--small {
  font-size: 13px;
  max-width: 200px;
}

/* ---- 当前配置区域 ---- */

.current-config-section,
.configured-providers-section,
.custom-endpoints-section {
  margin-bottom: 20px;
}

.section-title {
  display: block;
  font-size: 14px;
  margin-bottom: 12px;
  color: var(--text-color);
}

.config-card {
  background: rgba(59, 130, 246, 0.04);
}

.config-card--selected {
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.config-card-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.config-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.config-icon {
  color: #3b82f6;
}

.config-card-value {
  margin-top: 4px;
}

.config-value-text {
  font-size: 16px;
  font-weight: 600;
  word-break: break-all;
}

.config-card-sub {
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.added-models-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.added-model-card {
  display: flex;
  flex-direction: column;
  background: rgba(59, 130, 246, 0.04);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 8px;
  padding: 10px;
  min-height: 80px;
  transition: all 0.2s ease;
}

.added-model-card:hover {
  background: rgba(59, 130, 246, 0.08);
  border-color: rgba(59, 130, 246, 0.4);
}

.added-model-card--default {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.08) 0%, rgba(34, 197, 94, 0.04) 100%);
  border-color: rgba(34, 197, 94, 0.3);
}

.added-model-card--default:hover {
  border-color: rgba(34, 197, 94, 0.5);
}

.added-model-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.added-model-card-name {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.added-model-card-body {
  flex: 1;
}

.added-model-card-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
  min-height: 24px;
}

/* ---- Provider 网格 ---- */

.provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.provider-info-card {
  background: rgba(139, 92, 246, 0.04);
  cursor: pointer;
  transition: all 0.2s ease;
}

.provider-info-card:hover {
  background: rgba(139, 92, 246, 0.08);
}

.provider-info-card--selected {
  background: rgba(59, 130, 246, 0.12);
  border: 2px solid rgba(59, 130, 246, 0.4);
}

.provider-info-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.provider-icon {
  color: #8b5cf6;
}

.provider-details {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-label {
  font-size: 12px;
  min-width: 60px;
}

.detail-value {
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-hint {
  display: block;
  text-align: center;
  padding: 24px;
  font-size: 13px;
}

/* ---- 可用模型列表 ---- */

.available-models-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.models-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.model-card {
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px;
  min-height: 100px;
  transition: all 0.2s ease;
  cursor: default;
}

.model-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.model-card--default {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.08) 0%, rgba(34, 197, 94, 0.04) 100%);
  border-color: rgba(34, 197, 94, 0.3);
}

.model-card--default:hover {
  border-color: rgba(34, 197, 94, 0.5);
  box-shadow: 0 2px 12px rgba(34, 197, 94, 0.15);
}

.model-card--added {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(59, 130, 246, 0.04) 100%);
  border-color: rgba(59, 130, 246, 0.3);
}

.model-card--added:hover {
  border-color: rgba(59, 130, 246, 0.5);
  box-shadow: 0 2px 12px rgba(59, 130, 246, 0.15);
}

.model-card--available {
  background: var(--bg-card);
  border-color: var(--border-color);
}

.model-card--available:hover {
  border-color: rgba(156, 163, 175, 0.5);
}

.model-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.model-card-status {
  flex-shrink: 0;
}

.model-card-name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.model-card-body {
  flex: 1;
  min-height: 20px;
}

.model-card-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
  min-height: 28px;
}

/* ---- 模型状态 ---- */

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot--default {
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
}

.status-dot--added {
  background: #3b82f6;
  box-shadow: 0 0 6px rgba(59, 130, 246, 0.5);
}

.status-dot--available {
  background: #9ca3af;
}

/* ---- 搜索与筛选栏 ---- */

.hermes-filter-bar {
  margin-bottom: 16px;
}

/* ---- 模型卡片 ---- */

.model-name {
  font-size: 15px;
}

.model-description {
  font-size: 13px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.model-card-actions {
  margin-top: 4px;
}

/* ---- 空状态 ---- */

.empty-state {
  display: block;
  text-align: center;
  padding: 40px 0;
}

/* ---- Provider 配置 ---- */

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.provider-card {
  padding: 16px;
  border-radius: var(--radius, 8px);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.provider-card:hover {
  background: var(--bg-card-hover, rgba(59, 130, 246, 0.08));
  border-color: var(--border-color-hover, rgba(59, 130, 246, 0.3));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.provider-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.provider-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.provider-icon {
  color: var(--text-color);
}

.provider-name {
  font-size: 15px;
}

.provider-description {
  font-size: 13px;
}

.provider-status {
  flex-shrink: 0;
}

.provider-config-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  margin-bottom: 12px;
  border-radius: var(--radius, 6px);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
}

.config-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.config-label {
  font-size: 12px;
  min-width: 70px;
  flex-shrink: 0;
}

.config-value {
  font-size: 13px;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* ---- 配置表单弹窗 ---- */

.config-form-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.config-form-card {
  width: 100%;
  max-width: 480px;
  margin: 16px;
}

/* ---- Button hover animations ---- */

.app-toolbar-btn {
  transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
}

.app-toolbar-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}

.app-toolbar-btn:active {
  transform: translateY(0);
  box-shadow: none;
}

.app-toolbar-btn--refresh:hover {
  opacity: 0.85;
}
</style>
