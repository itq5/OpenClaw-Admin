import { ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { OpenClawWebSocket } from '@/api/websocket'
import { RPCClient } from '@/api/rpc-client'
import { ConnectionState } from '@/api/types'
import { useAuthStore } from './auth'

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function normalizeGatewayMethods(payload: unknown): string[] {
  const row = asRecord(payload)
  const features = asRecord(row.features)
  if (!Array.isArray(features.methods)) return []

  return features.methods
    .filter((method): method is string => typeof method === 'string')
    .map((method) => method.trim())
    .filter(Boolean)
}

export const useWebSocketStore = defineStore('websocket', () => {
  const state = ref<ConnectionState>(ConnectionState.DISCONNECTED)
  const lastError = ref<string | null>(null)
  const reconnectAttempts = ref(0)
  const gatewayMethods = ref<string[]>([])
  const gatewayVersion = ref<string | null>(null)
  const updateAvailable = ref<{ currentVersion: string; latestVersion: string; channel: string } | null>(null)
  let listenersBound = false
  const persistentListeners = new Map<string, Set<(...args: unknown[]) => void>>()

  function createWebSocket(): OpenClawWebSocket {
    const authStore = useAuthStore()
    return new OpenClawWebSocket({
      getToken: () => authStore.getToken(),
    })
  }

  const ws = shallowRef<OpenClawWebSocket>(createWebSocket())
  const rpc = shallowRef<RPCClient>(new RPCClient(ws.value))

  function rebindPersistentListeners() {
    persistentListeners.forEach((handlers, event) => {
      handlers.forEach((handler) => {
        ws.value.on(event, handler)
      })
    })
  }

  function bindListeners() {
    if (listenersBound) return

    ws.value.on('stateChange', (newState: unknown) => {
      state.value = newState as ConnectionState
    })

    ws.value.on('reconnecting', (attempts: unknown) => {
      reconnectAttempts.value = attempts as number
    })

    ws.value.on('error', (error: unknown) => {
      lastError.value = error as string
    })

    ws.value.on('failed', (reason: unknown) => {
      lastError.value = reason as string
    })

    ws.value.on('connected', (payload: unknown) => {
      console.log('[WebSocketStore] Connected payload:', payload)
      gatewayMethods.value = normalizeGatewayMethods(payload)
      const row = asRecord(payload)
      console.log('[WebSocketStore] Row:', row)
      gatewayVersion.value = typeof row.version === 'string' ? row.version : null
      console.log('[WebSocketStore] Gateway version:', gatewayVersion.value)
      const updateInfo = row.updateAvailable
      console.log('[WebSocketStore] Update info:', updateInfo)
      if (updateInfo && typeof updateInfo === 'object' && 'currentVersion' in updateInfo && 'latestVersion' in updateInfo) {
        console.log('[WebSocketStore] Setting updateAvailable:', updateInfo)
        updateAvailable.value = updateInfo as { currentVersion: string; latestVersion: string; channel: string }
      } else {
        console.log('[WebSocketStore] Setting updateAvailable to null')
        updateAvailable.value = null
      }
      console.log('[WebSocketStore] Update available:', updateAvailable.value)
    })

    ws.value.on('disconnected', (code: unknown, reason: unknown) => {
      if (state.value !== ConnectionState.DISCONNECTED && state.value !== ConnectionState.FAILED) {
        lastError.value = `Connection closed (code: ${String(code)}, reason: ${String(reason || 'n/a')})`
      }
    })

    listenersBound = true
  }

  function connect(url?: string) {
    lastError.value = null

    ws.value.dispose()
    ws.value = createWebSocket()
    rpc.value = new RPCClient(ws.value)
    listenersBound = false

    bindListeners()
    rebindPersistentListeners()
    ws.value.connect(url)
  }

  function disconnect() {
    ws.value.disconnect()
    gatewayMethods.value = []
    gatewayVersion.value = null
    updateAvailable.value = null
  }

  function subscribe(event: string, handler: (...args: unknown[]) => void): () => void {
    if (!persistentListeners.has(event)) {
      persistentListeners.set(event, new Set())
    }
    persistentListeners.get(event)!.add(handler)
    
    ws.value.on(event, handler)
    
    return () => {
      persistentListeners.get(event)?.delete(handler)
      ws.value.off(event, handler)
    }
  }

  function supportsAnyMethod(methods: string[]): boolean {
    if (gatewayMethods.value.length === 0) return false
    const methodSet = new Set(gatewayMethods.value)
    return methods.some((method) => methodSet.has(method))
  }

  return {
    state,
    lastError,
    reconnectAttempts,
    gatewayMethods,
    gatewayVersion,
    updateAvailable,
    ws,
    rpc,
    connect,
    disconnect,
    subscribe,
    supportsAnyMethod,
  }
})
