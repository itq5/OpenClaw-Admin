import { ref, onUnmounted } from 'vue'
import { defineStore } from 'pinia'
import { useHermesConnectionStore } from './connection'
import type { HermesMessage, ModelSelection } from '@/api/hermes/types'

export interface ToolCallProgress {
  toolCallId: string
  toolName: string
  phase: 'start' | 'update' | 'result'
  argsPreview?: string
  partialPreview?: string
  resultPreview?: string
  isError?: boolean
  startedAt?: number
  completedAt?: number
  duration?: number
  status: 'pending' | 'running' | 'completed' | 'error'
  emoji?: string
}

const AUTO_REFRESH_INTERVAL = 3000 // 3秒刷新一次

export const useHermesChatStore = defineStore('hermes-chat', () => {
  // ---- 状态 ----

  const messages = ref<HermesMessage[]>([])
  const currentSessionId = ref<string | null>(null)
  const currentSessionModel = ref<string | undefined>(undefined)
  const loading = ref(false)
  const streaming = ref(false)
  const streamingText = ref('')
  const error = ref<string | null>(null)
  const abortController = ref<AbortController | null>(null)

  // 工具调用进度追踪
  const activeToolCalls = ref<ToolCallProgress[]>([])

  // 自动刷新相关
  let autoRefreshTimer: ReturnType<typeof setInterval> | null = null
  const autoRefreshEnabled = ref(false)
  const lastMessageCount = ref(0)

  // ---- 方法 ----

  /**
   * 发送消息（SSE 流式）
   */
  async function sendMessage(
    content: string,
    options?: { 
      model?: string
      modelSelection?: ModelSelection
      sessionId?: string 
    },
  ) {
    const text = content.trim()
    if (!text) return

    const connStore = useHermesConnectionStore()
    const client = await connStore.getClientAsync()
    if (!client) {
      throw new Error('Hermes 未连接，请先连接 Hermes 网关')
    }

    // 如果传入了 sessionId，更新当前会话
    if (options?.sessionId) {
      currentSessionId.value = options.sessionId
    }

    // 确定使用的模型
    const modelName = options?.modelSelection?.modelId || options?.model || 'hermes-agent'
    const providerName = options?.modelSelection?.providerName
    const baseUrl = options?.modelSelection?.baseUrl

    console.log('[HermesChatStore] sendMessage called:', {
      text: text.substring(0, 50),
      currentSessionId: currentSessionId.value,
      optionsSessionId: options?.sessionId,
      optionsModel: options?.model,
      modelSelection: options?.modelSelection,
      effectiveModel: modelName,
      providerName,
      baseUrl,
    })

    // 添加用户消息到列表
    const userMessage: HermesMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    }
    messages.value = [...messages.value, userMessage]

    // 准备助手消息占位
    const assistantMessageId = `assistant-${Date.now()}`
    console.log('[HermesChatStore] Creating assistant message with model:', modelName)
    const assistantMessage: HermesMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      model: modelName,
      provider: providerName,
    }
    messages.value = [...messages.value, assistantMessage]
    console.log('[HermesChatStore] Assistant message created:', assistantMessage)

    // 重置流式状态
    streaming.value = true
    streamingText.value = ''
    error.value = null
    activeToolCalls.value = []

    // 创建 AbortController
    abortController.value = new AbortController()

    return new Promise<void>((resolve, reject) => {
      client.sendChatStream(
        [{ role: 'user', content: text }],
        // onDelta
        (deltaText: string) => {
          streamingText.value += deltaText
          // 实时更新助手消息内容（直接修改属性，避免频繁创建新数组）
          const idx = messages.value.findIndex((m) => m.id === assistantMessageId)
          if (idx >= 0) {
            messages.value[idx]!.content = streamingText.value
            // 触发响应式更新
            messages.value = [...messages.value]
          }
        },
        currentSessionId.value || undefined,
        modelName,
        // onToolCall
        (tool: any) => {
          const now = Date.now()
          
          // Handle Hermes-style tool events
          if (tool?.type === 'hermes-tool') {
            const toolName = tool.tool || tool.toolName || 'unknown'
            const toolCallId = tool.id || `hermes-tool-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
            const label = tool.label || ''
            const emoji = tool.emoji || '🔧'
            
            // Add new tool call
            activeToolCalls.value = [
              ...activeToolCalls.value,
              {
                toolCallId,
                toolName,
                phase: 'start',
                argsPreview: label,
                emoji,
                startedAt: now,
                status: 'running',
              },
            ]
            
            // Add tool call request message to message list
            // This ensures the tool call request is visible in the message list
            const toolCallMessage: HermesMessage = {
              id: `tool-call-${toolCallId}`,
              role: 'assistant',
              content: JSON.stringify({
                type: 'tool_call',
                id: toolCallId,
                name: toolName,
                arguments: label,
                emoji,
              }),
              timestamp: new Date().toISOString(),
            }
            
            // Insert before the assistant message placeholder
            const assistantIdx = messages.value.findIndex((m) => m.id === assistantMessageId)
            if (assistantIdx >= 0) {
              const updated = [...messages.value]
              updated.splice(assistantIdx, 0, toolCallMessage)
              messages.value = updated
            }
            return
          }
          
          const toolName = tool?.function?.name || tool?.toolName || 'unknown'
          const toolCallId = tool?.id || tool?.toolCallId || `tool-${Date.now()}`
          
          // 处理工具调用结果
          if (tool?.phase === 'result') {
            const existingIdx = activeToolCalls.value.findIndex((t) => t.toolCallId === toolCallId)
            if (existingIdx >= 0) {
              const existing = activeToolCalls.value[existingIdx]!
              const duration = existing.startedAt ? now - existing.startedAt : undefined
              const updated = [...activeToolCalls.value]
              updated[existingIdx] = {
                ...existing,
                phase: 'result',
                resultPreview: tool?.result,
                completedAt: now,
                duration,
                status: tool?.isError ? 'error' : 'completed',
                isError: tool?.isError,
              }
              activeToolCalls.value = updated
            } else {
              activeToolCalls.value = [
                ...activeToolCalls.value,
                {
                  toolCallId,
                  toolName,
                  phase: 'result',
                  resultPreview: tool?.result,
                  startedAt: now,
                  completedAt: now,
                  duration: 0,
                  status: tool?.isError ? 'error' : 'completed',
                  isError: tool?.isError,
                },
              ]
            }
            return
          }
          
          // 处理工具调用开始/更新
          const argsPreview = tool?.function?.arguments
            ? typeof tool.function.arguments === 'string'
              ? tool.function.arguments
              : JSON.stringify(tool.function.arguments, null, 2)
            : undefined

          // Check if this tool call already exists (update)
          const existingIdx = activeToolCalls.value.findIndex((t) => t.toolCallId === toolCallId)
          if (existingIdx >= 0) {
            const updated = [...activeToolCalls.value]
            updated[existingIdx] = {
              ...updated[existingIdx]!,
              phase: 'update',
              partialPreview: argsPreview,
              status: 'running',
            }
            activeToolCalls.value = updated
          } else {
            activeToolCalls.value = [
              ...activeToolCalls.value,
              {
                toolCallId,
                toolName,
                phase: 'start',
                argsPreview,
                startedAt: now,
                status: 'running',
              },
            ]
          }
        },
        // onDone
        () => {
          streaming.value = false
          abortController.value = null
          // 确保最终内容写入消息，并添加模型信息
          const idx = messages.value.findIndex((m) => m.id === assistantMessageId)
          if (idx >= 0) {
            const updated = [...messages.value]
            const existingMsg = updated[idx]!
            updated[idx] = { 
              ...existingMsg, 
              content: streamingText.value,
              model: options?.model || existingMsg.model,
            }
            messages.value = updated
          }
          
          // 将所有还在 running 状态的工具调用更新为 completed
          // 并从消息列表中查找工具结果
          const now = Date.now()
          const toolMessages = messages.value.filter((m) => m.role === 'tool')
          
          const completedToolCalls = activeToolCalls.value.map((tc, tcIdx) => {
            if (tc.status === 'running') {
              // 尝试从消息列表中查找对应的工具结果
              // 使用索引匹配，因为 Hermes 的工具调用没有唯一 ID
              const toolMsg = toolMessages[tcIdx]
              let resultPreview = tc.resultPreview
              
              if (toolMsg && !resultPreview) {
                // 解析工具消息内容
                try {
                  const parsed = JSON.parse(toolMsg.content)
                  resultPreview = parsed.output || parsed.result || parsed.content || toolMsg.content
                  if (typeof resultPreview !== 'string') {
                    resultPreview = JSON.stringify(resultPreview, null, 2)
                  }
                } catch {
                  resultPreview = toolMsg.content
                }
              }
              
              return {
                ...tc,
                status: 'completed' as const,
                phase: 'result' as const,
                completedAt: now,
                duration: tc.startedAt ? now - tc.startedAt : undefined,
                resultPreview,
              }
            }
            return tc
          })
          activeToolCalls.value = completedToolCalls
          
          // 为每个已完成的工具调用添加工具结果消息
          // 在对应的工具调用请求消息之后插入
          for (let tcIdx = 0; tcIdx < completedToolCalls.length; tcIdx++) {
            const tc = completedToolCalls[tcIdx]
            if (!tc || !tc.resultPreview) continue
            
            // 查找对应的工具调用请求消息
            const toolCallMsgId = `tool-call-${tc.toolCallId}`
            const toolCallMsgIdx = messages.value.findIndex((m) => m.id === toolCallMsgId)
            
            // 检查是否已经有对应的工具结果消息
            const existingResultIdx = messages.value.findIndex((m) => 
              m.role === 'tool' && m.toolCallId === tc.toolCallId
            )
            
            if (existingResultIdx < 0) {
              // 创建工具结果消息
              const toolResultMessage: HermesMessage = {
                id: `tool-result-${tc.toolCallId}`,
                role: 'tool',
                content: tc.resultPreview,
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                timestamp: new Date().toISOString(),
                isError: tc.isError,
              }
              
              // 在工具调用请求消息之后插入工具结果消息
              const insertIdx = toolCallMsgIdx >= 0 ? toolCallMsgIdx + 1 : messages.value.length - 1
              const updated = [...messages.value]
              updated.splice(insertIdx, 0, toolResultMessage)
              messages.value = updated
            }
          }
          
          resolve()
        },
        // onError
        (err: string) => {
          streaming.value = false
          error.value = err
          abortController.value = null
          reject(new Error(err))
        },
        abortController.value?.signal,
        // onSessionId
        (sessionId: string) => {
          // 只有在当前没有会话ID时（新会话），才更新 session_id
          // 如果是老会话，不要更新，否则会导致消息显示在新会话中
          if (sessionId && !currentSessionId.value) {
            console.log('[HermesChatStore] New session created with id:', sessionId)
            currentSessionId.value = sessionId
          } else if (sessionId && sessionId !== currentSessionId.value) {
            // 如果 API 返回了不同的 session_id，记录警告但不更新
            console.warn('[HermesChatStore] API returned different session_id:', sessionId, 'current:', currentSessionId.value, '- keeping current')
          }
        },
        // onModel
        (model: string) => {
          // 更新助手消息的模型名称
          const idx = messages.value.findIndex((m) => m.id === assistantMessageId)
          if (idx >= 0 && model) {
            const updated = [...messages.value]
            updated[idx] = { ...updated[idx]!, model }
            messages.value = updated
            console.log('[HermesChatStore] Updated assistant message model:', model)
          }
        },
        // endpointOptions
        { providerName, baseUrl },
      )
    })
  }

  /**
   * 停止生成
   */
  async function stopGeneration() {
    if (abortController.value) {
      abortController.value.abort()
      abortController.value = null
    }

    streaming.value = false
  }

  /**
   * 加载会话消息
   */
  async function loadSessionMessages(sessionId: string, sessionModel?: string) {
    const connStore = useHermesConnectionStore()
    const client = await connStore.getClientAsync()
    if (!client) {
      throw new Error('Hermes 未连接')
    }

    console.log('[HermesChatStore] loadSessionMessages called:', {
      sessionId,
      sessionModel,
      previousCurrentSessionId: currentSessionId.value,
    })

    currentSessionId.value = sessionId
    currentSessionModel.value = sessionModel
    loading.value = true
    error.value = null

    console.log('[HermesChatStore] currentSessionId set to:', currentSessionId.value)

    try {
      const msgs = await client.getSessionMessages(sessionId)
      console.log('[HermesChatStore] Loaded messages:', msgs.length)
      
      lastMessageCount.value = msgs.length
      
      // 处理历史消息：从助手消息的 tool_calls 中提取工具名称，关联到工具结果消息
      const processedMsgs: HermesMessage[] = []
      const toolCallMap = new Map<string, string>() // toolCallId -> toolName
      let lastToolCallName: string | undefined // 记录最近的工具调用名称
      
      for (let i = 0; i < msgs.length; i++) {
        const msg = msgs[i]!
        
        // 检查助手消息是否包含 tool_calls（直接在消息对象上，不是在 content 中）
        if (msg.role === 'assistant') {
          // 检查消息对象上的 tool_calls 字段
          const rawMsg = msg as unknown as Record<string, unknown>
          const toolCalls = rawMsg.tool_calls as Array<{ id?: string; function?: { name?: string }; name?: string }> | null
          
          if (toolCalls && Array.isArray(toolCalls)) {
            for (const tc of toolCalls) {
              const tcName = tc.function?.name || tc.name
              if (tc.id && tcName) {
                toolCallMap.set(tc.id, tcName)
                lastToolCallName = tcName
              }
            }
          }
          
          // 也尝试从 content 解析（兼容旧格式）
          if (msg.content) {
            try {
              const contentObj = JSON.parse(msg.content)
              if (contentObj.tool_calls && Array.isArray(contentObj.tool_calls)) {
                for (const tc of contentObj.tool_calls) {
                  if (tc.id && (tc.function?.name || tc.name || tc.tool_name)) {
                    toolCallMap.set(tc.id, tc.function?.name || tc.name || tc.tool_name)
                    lastToolCallName = tc.function?.name || tc.name || tc.tool_name
                  }
                }
              }
            } catch {
              // content 不是 JSON
            }
          }
        }
        
        // 处理工具消息：尝试从多个来源获取工具名称
        if (msg.role === 'tool') {
          let toolName = msg.toolName || msg.name
          
          // 如果没有 toolName，尝试从 content 解析
          if (!toolName && msg.content) {
            try {
              const parsed = JSON.parse(msg.content)
              toolName = parsed.tool_name || parsed.name || parsed.toolName
            } catch {
              // ignore
            }
          }
          
          // 如果还是没有，尝试从 toolCallMap 获取
          if (!toolName && msg.toolCallId) {
            toolName = toolCallMap.get(msg.toolCallId)
          }
          
          // 如果还是没有，使用最近的工具调用名称
          if (!toolName && lastToolCallName) {
            toolName = lastToolCallName
          }
          
          // 如果还是没有，尝试从相邻的助手消息推断
          if (!toolName && i > 0) {
            const prevMsg = processedMsgs[processedMsgs.length - 1]
            if (prevMsg?.role === 'assistant') {
              const rawPrevMsg = prevMsg as unknown as Record<string, unknown>
              const prevToolCalls = rawPrevMsg.tool_calls as Array<{ function?: { name?: string }; name?: string }> | null
              if (prevToolCalls && prevToolCalls.length > 0) {
                const lastTc = prevToolCalls[prevToolCalls.length - 1]
                toolName = lastTc?.function?.name || lastTc?.name
              }
            }
          }
          
          processedMsgs.push({
            ...msg,
            toolName: toolName || undefined,
          })
        } else if (msg.role === 'assistant' && !msg.model && sessionModel) {
          processedMsgs.push({ ...msg, model: sessionModel })
        } else {
          processedMsgs.push(msg)
        }
      }
      
      messages.value = processedMsgs
      console.log('[HermesChatStore] Processed messages, toolCallMap size:', toolCallMap.size)
    } catch (err) {
      messages.value = []
      error.value = err instanceof Error ? err.message : String(err)
      console.error('[HermesChatStore] loadSessionMessages failed:', err)
    } finally {
      loading.value = false
    }
  }

  /**
   * 静默刷新当前会话消息（用于自动刷新，不显示 loading）
   */
  async function refreshCurrentSessionMessages() {
    if (!currentSessionId.value || streaming.value) return

    const connStore = useHermesConnectionStore()
    const client = await connStore.getClientAsync()
    if (!client) return

    try {
      const msgs = await client.getSessionMessages(currentSessionId.value)
      
      // 只有当消息数量变化时才更新（避免不必要的 UI 刷新）
      if (msgs.length !== lastMessageCount.value) {
        console.log('[HermesChatStore] Session messages updated:', lastMessageCount.value, '->', msgs.length)
        lastMessageCount.value = msgs.length
        
        // 处理消息（简化版，复用 loadSessionMessages 的逻辑）
        const processedMsgs: HermesMessage[] = []
        const toolCallMap = new Map<string, string>()
        let lastToolCallName: string | undefined
        
        for (let i = 0; i < msgs.length; i++) {
          const msg = msgs[i]!
          
          if (msg.role === 'assistant') {
            const rawMsg = msg as unknown as Record<string, unknown>
            const toolCalls = rawMsg.tool_calls as Array<{ id?: string; function?: { name?: string }; name?: string }> | null
            
            if (toolCalls && Array.isArray(toolCalls)) {
              for (const tc of toolCalls) {
                const tcName = tc.function?.name || tc.name
                if (tc.id && tcName) {
                  toolCallMap.set(tc.id, tcName)
                  lastToolCallName = tcName
                }
              }
            }
            
            if (msg.content) {
              try {
                const contentObj = JSON.parse(msg.content)
                if (contentObj.tool_calls && Array.isArray(contentObj.tool_calls)) {
                  for (const tc of contentObj.tool_calls) {
                    if (tc.id && (tc.function?.name || tc.name || tc.tool_name)) {
                      toolCallMap.set(tc.id, tc.function?.name || tc.name || tc.tool_name)
                      lastToolCallName = tc.function?.name || tc.name || tc.tool_name
                    }
                  }
                }
              } catch {
                // ignore
              }
            }
          }
          
          if (msg.role === 'tool') {
            let toolName = msg.toolName || msg.name
            
            if (!toolName && msg.content) {
              try {
                const parsed = JSON.parse(msg.content)
                toolName = parsed.tool_name || parsed.name || parsed.toolName
              } catch {
                // ignore
              }
            }
            
            if (!toolName && msg.toolCallId) {
              toolName = toolCallMap.get(msg.toolCallId)
            }
            
            if (!toolName && lastToolCallName) {
              toolName = lastToolCallName
            }
            
            if (!toolName && i > 0) {
              const prevMsg = processedMsgs[processedMsgs.length - 1]
              if (prevMsg?.role === 'assistant') {
                const rawPrevMsg = prevMsg as unknown as Record<string, unknown>
                const prevToolCalls = rawPrevMsg.tool_calls as Array<{ function?: { name?: string }; name?: string }> | null
                if (prevToolCalls && prevToolCalls.length > 0) {
                  const lastTc = prevToolCalls[prevToolCalls.length - 1]
                  toolName = lastTc?.function?.name || lastTc?.name
                }
              }
            }
            
            processedMsgs.push({
              ...msg,
              toolName: toolName || undefined,
            })
          } else if (msg.role === 'assistant' && !msg.model && currentSessionModel.value) {
            processedMsgs.push({ ...msg, model: currentSessionModel.value })
          } else {
            processedMsgs.push(msg)
          }
        }
        
        messages.value = processedMsgs
      }
    } catch (err) {
      console.error('[HermesChatStore] refreshCurrentSessionMessages failed:', err)
    }
  }

  /**
   * 启动自动刷新
   */
  function startAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer)
    }
    autoRefreshEnabled.value = true
    autoRefreshTimer = setInterval(() => {
      refreshCurrentSessionMessages()
    }, AUTO_REFRESH_INTERVAL)
    console.log('[HermesChatStore] Auto-refresh started')
  }

  /**
   * 停止自动刷新
   */
  function stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer)
      autoRefreshTimer = null
    }
    autoRefreshEnabled.value = false
    console.log('[HermesChatStore] Auto-refresh stopped')
  }

  /**
   * 清空消息
   */
  function clearMessages() {
    stopAutoRefresh()
    messages.value = []
    streamingText.value = ''
    error.value = null
    activeToolCalls.value = []
    currentSessionId.value = null
    currentSessionModel.value = undefined
    lastMessageCount.value = 0
    if (abortController.value) {
      abortController.value.abort()
      abortController.value = null
    }
  }

  /**
   * 设置当前会话 ID（不加载消息）
   */
  function setSessionId(sessionId: string | null) {
    currentSessionId.value = sessionId
  }

  return {
    // 状态
    messages,
    currentSessionId,
    currentSessionModel,
    loading,
    streaming,
    streamingText,
    error,
    abortController,
    activeToolCalls,
    autoRefreshEnabled,
    // 方法
    sendMessage,
    stopGeneration,
    loadSessionMessages,
    refreshCurrentSessionMessages,
    startAutoRefresh,
    stopAutoRefresh,
    clearMessages,
    setSessionId,
  }
})
