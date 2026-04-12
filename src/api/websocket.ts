import { ConnectionState, type RPCFrame, type RPCEvent, type RPCResponse } from './types'
import { ApiClient } from './http-client'

type EventHandler = (...args: unknown[]) => void

export interface WebSocketConfig {
  url?: string
  auth?: string
  reconnect?: boolean
  reconnectInterval?: number
  maxReconnectAttempts?: number
  getToken?: () => string | null
}

const DEFAULT_CONFIG: Required<Omit<WebSocketConfig, 'auth' | 'getToken'>> & { auth?: string; getToken?: () => string | null } = {
  url: '',
  reconnect: true,
  reconnectInterval: 3000,
  maxReconnectAttempts: 20,
  auth: undefined,
  getToken: undefined,
}

export class OpenClawWebSocket {
  private apiClient: ApiClient
  private config: Required<Omit<WebSocketConfig, 'auth' | 'getToken'>> & { auth?: string; getToken?: () => string | null }
  private listeners = new Map<string, Set<EventHandler>>()
  private _state: ConnectionState = ConnectionState.DISCONNECTED

  get state(): ConnectionState {
    return this._state
  }

  constructor(config?: Partial<WebSocketConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.apiClient = new ApiClient({
      baseUrl: this.config.url || '',
      reconnectInterval: this.config.reconnectInterval,
      maxReconnectAttempts: this.config.maxReconnectAttempts,
      getToken: this.config.getToken,
    })

    this.bindApiClientEvents()
  }

  private bindApiClientEvents(): void {
    this.apiClient.on('stateChange', (state: unknown) => {
      this._state = state as ConnectionState
      this.emit('stateChange', state)
    })

    this.apiClient.on('reconnecting', (attempts: unknown, delay: unknown) => {
      this.emit('reconnecting', attempts, delay)
    })

    this.apiClient.on('error', (error: unknown) => {
      this.emit('error', error)
    })

    this.apiClient.on('failed', (reason: unknown) => {
      this.emit('failed', reason)
    })

    this.apiClient.on('connected', (payload: unknown) => {
      this.emit('connected', payload)
    })

    this.apiClient.on('disconnected', (code: unknown, reason: unknown) => {
      this.emit('disconnected', code, reason)
    })

    this.apiClient.on('event', (evt: unknown) => {
      const event = evt as RPCEvent
      this.emit('event', event)
      this.emit(`event:${event.event}`, event.payload)
    })

    this.apiClient.on('backupProgress', (data: unknown) => {
      this.emit('backupProgress', data)
    })
  }

  connect(url?: string, auth?: string): void {
    if (url) this.config.url = url
    if (auth !== undefined) this.config.auth = auth

    this._state = ConnectionState.CONNECTING
    this.emit('stateChange', ConnectionState.CONNECTING)

    this.apiClient.connect()
  }

  disconnect(): void {
    this._state = ConnectionState.DISCONNECTED
    this.apiClient.disconnect()
    this.emit('stateChange', ConnectionState.DISCONNECTED)
  }

  dispose(): void {
    this.disconnect()
    this.apiClient.dispose()
    this.listeners.clear()
  }

  async send(data: RPCFrame): Promise<void> {
    if (data.type !== 'req') {
      return
    }

    try {
      const payload = await this.apiClient.rpc(data.method, data.params)
      const response: RPCResponse<unknown> = {
        type: 'res',
        id: data.id,
        ok: true,
        payload,
      }
      this.emit(`rpc:${data.id}`, response)
    } catch (err) {
      const response: RPCResponse<unknown> = {
        type: 'res',
        id: data.id,
        ok: false,
        error: {
          message: err instanceof Error ? err.message : 'RPC call failed',
        },
      }
      this.emit(`rpc:${data.id}`, response)
    }
  }

  on(event: string, handler: EventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler)
    return () => this.off(event, handler)
  }

  off(event: string, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler)
  }

  private emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((handler) => {
      try {
        handler(...args)
      } catch (e) {
        console.error(`[WebSocket] Event handler error for "${event}":`, e)
      }
    })
  }
}
