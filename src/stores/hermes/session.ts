import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useHermesConnectionStore } from './connection'
import { useHermesChatStore } from './chat'
import type { HermesSession, HermesSearchResult } from '@/api/hermes/types'

export const useHermesSessionStore = defineStore('hermes-session', () => {
  // ---- 状态 ----

  const sessions = ref<HermesSession[]>([])
  const loading = ref(false)
  const searchQuery = ref('')
  const searchResults = ref<HermesSearchResult | null>(null)
  const lastError = ref<string | null>(null)

  // ---- 方法 ----

  /**
   * 加载会话列表
   */
  async function fetchSessions() {
    const connStore = useHermesConnectionStore()

    const client = await connStore.getClientAsync()
    if (!client) {
      throw new Error('Hermes 未连接')
    }

    loading.value = true
    lastError.value = null

    try {
      sessions.value = await client.listSessions()
      searchResults.value = null
    } catch (error) {
      sessions.value = []
      lastError.value = error instanceof Error ? error.message : String(error)
      console.error('[HermesSessionStore] fetchSessions failed:', error)
    } finally {
      loading.value = false
    }
  }

  /**
   * 搜索会话
   */
  async function searchSessions(query: string) {
    const trimmed = query.trim()
    searchQuery.value = trimmed

    if (!trimmed) {
      searchResults.value = null
      return
    }

    const connStore = useHermesConnectionStore()
    const client = await connStore.getClientAsync()
    if (!client) {
      throw new Error('Hermes 未连接')
    }

    loading.value = true
    lastError.value = null

    try {
      searchResults.value = await client.searchSessions(trimmed)
    } catch (error) {
      searchResults.value = null
      lastError.value = error instanceof Error ? error.message : String(error)
      console.error('[HermesSessionStore] searchSessions failed:', error)
    } finally {
      loading.value = false
    }
  }

  /**
   * 删除会话
   */
  async function deleteSession(id: string) {
    const connStore = useHermesConnectionStore()
    const client = await connStore.getClientAsync()
    if (!client) {
      throw new Error('Hermes 未连接')
    }

    lastError.value = null

    try {
      await client.deleteSession(id)
      sessions.value = sessions.value.filter((s) => s.id !== id)
      // 如果搜索结果中也有，一并移除
      if (searchResults.value) {
        searchResults.value = {
          ...searchResults.value,
          sessions: searchResults.value.sessions.filter((s) => s.id !== id),
          total: searchResults.value.total - 1,
        }
      }
      // 如果删除的是当前聊天会话，清除聊天状态
      const chatStore = useHermesChatStore()
      if (chatStore.currentSessionId === id) {
        chatStore.clearMessages()
        console.log('[HermesSessionStore] Cleared chat state for deleted session:', id)
      }
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      console.error('[HermesSessionStore] deleteSession failed:', error)
      throw error
    }
  }

  /**
   * 获取会话详情（不缓存在 store 中，直接返回）
   */
  async function getSessionDetail(id: string) {
    const connStore = useHermesConnectionStore()
    const client = await connStore.getClientAsync()
    if (!client) {
      throw new Error('Hermes 未连接')
    }

    lastError.value = null

    try {
      return await client.getSession(id)
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      console.error('[HermesSessionStore] getSessionDetail failed:', error)
      throw error
    }
  }

  /**
   * 清空搜索
   */
  function clearSearch() {
    searchQuery.value = ''
    searchResults.value = null
  }

  return {
    // 状态
    sessions,
    loading,
    searchQuery,
    searchResults,
    lastError,
    // 方法
    fetchSessions,
    searchSessions,
    deleteSession,
    getSessionDetail,
    clearSearch,
  }
})
