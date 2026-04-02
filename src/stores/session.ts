import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useWebSocketStore } from './websocket'
import { useRpcSafe } from '@/composables/useRpcSafe'
import type { Session, SessionDetail, SessionExport } from '@/api/types'

export const useSessionStore = defineStore('session', () => {
  const sessions = ref<Session[]>([])
  const currentSession = ref<SessionDetail | null>(null)
  const loading = ref(false)

  const wsStore = useWebSocketStore()
  const rpc = useRpcSafe()

  function parseUsageNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value))
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed))
    }
    return undefined
  }

  function mergeUsageIntoSessions(baseSessions: Session[], usage: unknown): Session[] {
    if (!Array.isArray(baseSessions) || baseSessions.length === 0) return baseSessions
    if (!usage || typeof usage !== 'object') return baseSessions

    const usageRow = usage as { sessions?: unknown[] }
    const usageList = Array.isArray(usageRow.sessions) ? usageRow.sessions : []
    if (usageList.length === 0) return baseSessions

    const usageMap = new Map<
      string,
      {
        messageCount?: number
        input?: number
        output?: number
        totalTokens?: number
        label?: string
      }
    >()

    for (const item of usageList) {
      if (!item || typeof item !== 'object') continue
      const row = item as {
        key?: unknown
        sessionKey?: unknown
        id?: unknown
        label?: unknown
        usage?: {
          input?: unknown
          output?: unknown
          totalTokens?: unknown
          tokens?: unknown
          total?: unknown
          messageCounts?: { total?: unknown }
        }
      }
      const keyCandidate = row.key ?? row.sessionKey ?? row.id
      const key = typeof keyCandidate === 'string' ? keyCandidate.trim() : ''
      if (!key) continue

      const usageData = row.usage || {}
      const labelValue = row.label
      usageMap.set(key, {
        messageCount: parseUsageNumber(usageData.messageCounts?.total),
        input: parseUsageNumber(usageData.input),
        output: parseUsageNumber(usageData.output),
        totalTokens: parseUsageNumber(usageData.totalTokens ?? usageData.tokens ?? usageData.total),
        label: typeof labelValue === 'string' ? labelValue.trim() : undefined,
      })
    }

    if (usageMap.size === 0) return baseSessions

    return baseSessions.map((session) => {
      const usageData = usageMap.get(session.key)
      if (!usageData) return session

      let changed = false
      const next: Session = { ...session }

      if (usageData.messageCount !== undefined && usageData.messageCount > session.messageCount) {
        next.messageCount = usageData.messageCount
        changed = true
      }

      const hasTokenData =
        usageData.input !== undefined ||
        usageData.output !== undefined ||
        usageData.totalTokens !== undefined

      if (hasTokenData) {
        const currentUsage = session.tokenUsage
        let totalInput = usageData.input ?? currentUsage?.totalInput
        let totalOutput = usageData.output ?? currentUsage?.totalOutput

        if (totalInput === undefined && totalOutput === undefined && usageData.totalTokens !== undefined) {
          totalInput = usageData.totalTokens
          totalOutput = 0
        }

        if (totalInput !== undefined || totalOutput !== undefined) {
          const normalizedInput = Math.max(0, Math.floor(totalInput ?? 0))
          const normalizedOutput = Math.max(0, Math.floor(totalOutput ?? 0))
          const currentInput = currentUsage?.totalInput ?? -1
          const currentOutput = currentUsage?.totalOutput ?? -1
          if (normalizedInput !== currentInput || normalizedOutput !== currentOutput) {
            next.tokenUsage = {
              totalInput: normalizedInput,
              totalOutput: normalizedOutput,
            }
            changed = true
          }
        }
      }

      if (usageData.label && usageData.label !== session.label) {
        next.label = usageData.label
        changed = true
      }

      return changed ? next : session
    })
  }

  async function fetchSessions() {
    loading.value = true
    try {
      const list = await rpc.call(() => wsStore.rpc.listSessions(), {
        label: 'listSessions',
        timeout: 10000,
        retries: 1,
      })
      if (list.length === 0) {
        sessions.value = list
        return
      }

      const hasMessageCount = list.some((item) => item.messageCount > 0)
      const hasMissingTokenUsage = list.some((item) => !item.tokenUsage)
      if (hasMessageCount && !hasMissingTokenUsage) {
        sessions.value = list
        return
      }

      try {
        const usage = await rpc.call(
          () =>
            wsStore.rpc.getSessionsUsage({
              limit: Math.max(200, list.length * 4),
            }),
          { label: 'getSessionsUsage', timeout: 60000, retries: 1 }
        )
        sessions.value = mergeUsageIntoSessions(list, usage)
      } catch {
        sessions.value = list
      }
    } catch (error) {
      sessions.value = []
      console.error('[SessionStore] fetchSessions failed:', error)
    } finally {
      loading.value = false
    }
  }

  async function fetchSession(key: string) {
    loading.value = true
    try {
      currentSession.value = await rpc.call(() => wsStore.rpc.getSession(key), {
        label: 'getSession',
        timeout: 10000,
      })
    } catch (error) {
      currentSession.value = null
      console.error('[SessionStore] fetchSession failed:', error)
    } finally {
      loading.value = false
    }
  }

  async function resetSession(key: string) {
    await wsStore.rpc.resetSession(key)
    await fetchSessions()
  }

  async function newSession(key: string) {
    await wsStore.rpc.newSession(key)
    await fetchSessions()
  }

  async function deleteSession(key: string) {
    await wsStore.rpc.deleteSession(key)
    sessions.value = sessions.value.filter((s) => s.key !== key)
  }

  async function spawnSession(params: {
    agentId?: string
    channel?: string
    peer?: string
    label?: string
  }): Promise<string> {
    const result = await wsStore.rpc.spawnSession(params)
    return result.sessionKey
  }

  async function createSession(params: {
    agentId?: string
    channel?: string
    peer?: string
    label?: string
  }): Promise<string> {
    const agentId = params.agentId || 'main'
    const channel = params.channel || 'main'
    const peer = params.peer || `webchat-${Date.now()}`
    const sessionKey = `agent:${agentId}:${channel}:dm:${peer}`
    const idempotencyKey = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

    await wsStore.rpc.sendChatMessage({
      sessionKey,
      message: '/new',
      idempotencyKey,
    })

    // Fire label patch and fetchSessions concurrently — no artificial 1500ms wait
    const bgOps: Promise<unknown>[] = []
    if (params.label) {
      bgOps.push(wsStore.rpc.patchSession({ sessionKey, label: params.label }))
    }
    bgOps.push(fetchSessions())
    await Promise.all(bgOps)
    return sessionKey
  }

  async function patchSessionLabel(sessionKey: string, label: string): Promise<void> {
    await wsStore.rpc.patchSession({ sessionKey, label })
    await fetchSessions()
  }

  async function exportSession(key: string): Promise<SessionExport> {
    return await wsStore.rpc.exportSession(key)
  }

  return {
    sessions,
    currentSession,
    loading,
    fetchSessions,
    fetchSession,
    resetSession,
    newSession,
    deleteSession,
    spawnSession,
    createSession,
    patchSessionLabel,
    exportSession,
  }
})
