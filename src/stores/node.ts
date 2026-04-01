import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useWebSocketStore } from './websocket'
import { useRpcSafe } from '@/composables/useRpcSafe'
import type { DeviceNode, NodeInvokeParams } from '@/api/types'

export const useNodeStore = defineStore('node', () => {
  const nodes = ref<DeviceNode[]>([])
  const loading = ref(false)

  const wsStore = useWebSocketStore()
  const rpc = useRpcSafe()

  async function fetchNodes() {
    loading.value = true
    try {
      nodes.value = await rpc.call(() => wsStore.rpc.listNodes(), {
        label: 'listNodes', timeout: 10000, retries: 1,
      })
    } catch (error) {
      nodes.value = []
      console.error('[NodeStore] fetchNodes failed:', error)
    } finally {
      loading.value = false
    }
  }

  async function invokeNode(params: NodeInvokeParams) {
    return await rpc.call(() => wsStore.rpc.invokeNode(params), {
      label: 'invokeNode', timeout: 30000, retries: 0,
    })
  }

  async function requestPairing(nodeId: string) {
    await rpc.call(() => wsStore.rpc.requestNodePairing(nodeId), {
      label: 'requestNodePairing', timeout: 15000, retries: 0,
    })
  }

  async function approvePairing(nodeId: string, code: string) {
    await rpc.call(() => wsStore.rpc.approveNodePairing(nodeId, code), {
      label: 'approveNodePairing', timeout: 15000, retries: 0,
    })
    await fetchNodes()
  }

  return {
    nodes,
    loading,
    fetchNodes,
    invokeNode,
    requestPairing,
    approvePairing,
  }
})
