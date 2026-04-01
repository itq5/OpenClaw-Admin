import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useWebSocketStore } from './websocket'
import { useRpcSafe } from '@/composables/useRpcSafe'
import type { OpenClawConfig, ConfigPatch } from '@/api/types'

export const useConfigStore = defineStore('config', () => {
  const config = ref<OpenClawConfig | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const lastError = ref<string | null>(null)

  const wsStore = useWebSocketStore()
  const rpc = useRpcSafe()

  async function fetchConfig() {
    loading.value = true
    lastError.value = null
    try {
      config.value = await rpc.call(() => wsStore.rpc.getConfig(), {
        label: 'getConfig', timeout: 12000, retries: 1,
      })
    } catch (error) {
      config.value = null
      lastError.value = error instanceof Error ? error.message : String(error)
      console.error('[ConfigStore] fetchConfig failed:', error)
    } finally {
      loading.value = false
    }
  }

  async function patchConfig(patches: ConfigPatch[]) {
    saving.value = true
    lastError.value = null
    try {
      await rpc.call(() => wsStore.rpc.patchConfig(patches), {
        label: 'patchConfig', timeout: 15000, retries: 1,
      })
      await fetchConfig()
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      saving.value = false
    }
  }

  async function setConfig(newConfig: OpenClawConfig) {
    saving.value = true
    lastError.value = null
    try {
      await rpc.call(() => wsStore.rpc.setConfig(newConfig), {
        label: 'setConfig', timeout: 15000, retries: 1,
      })
      await fetchConfig()
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      saving.value = false
    }
  }

  async function applyConfig() {
    saving.value = true
    lastError.value = null
    try {
      await rpc.call(() => wsStore.rpc.applyConfig(), {
        label: 'applyConfig', timeout: 15000, retries: 0,
      })
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      saving.value = false
    }
  }

  return {
    config,
    loading,
    saving,
    lastError,
    fetchConfig,
    patchConfig,
    setConfig,
    applyConfig,
  }
})
