import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useHermesConnectionStore } from './connection'
import type { HermesSkill } from '@/api/hermes/types'

export const useHermesSkillStore = defineStore('hermes-skill', () => {
  // ---- 状态 ----

  const skills = ref<HermesSkill[]>([])
  const loading = ref(false)
  const lastError = ref<string | null>(null)

  // ---- 方法 ----

  /**
   * 加载技能列表
   */
  async function fetchSkills() {
    const connStore = useHermesConnectionStore()
    const client = await connStore.getClientAsync()
    if (!client) {
      throw new Error('Hermes 未连接')
    }

    loading.value = true
    lastError.value = null

    try {
      const result = await client.listSkills()
      console.log('[HermesSkillStore] Skills response:', result)
      if (result && result.length > 0) {
        console.log('[HermesSkillStore] First skill sample:', JSON.stringify(result[0], null, 2))
      }
      skills.value = result
    } catch (error) {
      skills.value = []
      lastError.value = error instanceof Error ? error.message : String(error)
      console.error('[HermesSkillStore] fetchSkills failed:', error)
    } finally {
      loading.value = false
    }
  }

  /**
   * 切换技能启用状态
   */
  async function toggleSkill(name: string, enabled: boolean) {
    const connStore = useHermesConnectionStore()
    const client = await connStore.getClientAsync()
    if (!client) {
      throw new Error('Hermes 未连接')
    }

    lastError.value = null

    try {
      await client.toggleSkill(name, enabled)
      // Update local list
      const idx = skills.value.findIndex((s) => s.name === name)
      if (idx >= 0) {
        const list = [...skills.value]
        list[idx] = { ...list[idx]!, enabled }
        skills.value = list
      }
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      console.error('[HermesSkillStore] toggleSkill failed:', error)
      throw error
    }
  }

  return {
    // 状态
    skills,
    loading,
    lastError,
    // 方法
    fetchSkills,
    toggleSkill,
  }
})
