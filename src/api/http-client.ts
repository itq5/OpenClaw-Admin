import { ConnectionState, type RPCResponse, type RPCEvent } from './types'

type EventHandler = (...args: unknown[]) => void

export interface ApiClientConfig {
  baseUrl?: string
  reconnectInterval?: number
  maxReconnectAttempts?: number
  getToken?: () => string | null
}

const DEFAULT_CONFIG: Required<ApiClientConfig> = {
  baseUrl: '',
  reconnectInterval: 3000,
  maxReconnectAttempts: 20,
  getToken: () => null,
}

export class ApiClient {
  private config: Required<ApiClientConfig>
  private listeners = new Map<string, Set<EventHandler>>()
  private eventSource: EventSource | null = null
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _state: ConnectionState = ConnectionState.DISCONNECTED
  private clientId: string | null = null
  private closing = false
  private readonly handlePageHide = () => {
    this.closeEventSource(true)
  }

  get state(): ConnectionState {
    return this._state
  }

  constructor(config?: Partial<ApiClientConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.handlePageHide)
    }
  }

  connect(): void {
    this._state = ConnectionState.CONNECTING
    this.emit('stateChange', ConnectionState.CONNECTING)
    this.reconnectAttempts = 0
    this.createEventSource()
  }

  disconnect(): void {
    this.clearTimers()
    this._state = ConnectionState.DISCONNECTED
    this.closeEventSource(true)
    this.emit('stateChange', ConnectionState.DISCONNECTED)
  }

  dispose(): void {
    this.disconnect()
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.handlePageHide)
    }
  }

  private createEventSource(): void {
    try {
      const url = this.config.baseUrl
        ? `${this.config.baseUrl}/api/events`
        : '/api/events'

      console.log('[ApiClient] Creating EventSource:', url)

      this.closeEventSource(true)
      this.closing = false
      this.eventSource = new EventSource(url)

      this.eventSource.onopen = () => {
        console.log('[ApiClient] EventSource opened')
        this.closing = false
        this.reconnectAttempts = 0
      }

      this.eventSource.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data)
      }

      this.eventSource.onerror = (error) => {
        if (this.closing || this._state === ConnectionState.DISCONNECTED) {
          return
        }
        console.error('[ApiClient] EventSource error:', error)
        console.error('[ApiClient] EventSource readyState:', this.eventSource?.readyState)
        this.handleDisconnect()
      }
    } catch (e) {
      console.error('[ApiClient] Connection failed:', e)
      this.scheduleReconnect()
    }
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data)
      console.log('[ApiClient] Received message type:', message.type, 'data:', JSON.stringify(message).substring(0, 200))

      switch (message.type) {
        case 'connected':
          this.clientId = message.clientId
          console.log('[ApiClient] Connected with clientId:', this.clientId)
          break

        case 'gatewayState':
          console.log('[ApiClient] Gateway state:', message.state, 'version:', message.version)
          const connectedPayload = {
            version: message.version,
            updateAvailable: message.updateAvailable,
            features: message.features,
          }
          if (message.state === 'connected') {
            this._state = ConnectionState.CONNECTED
            this.emit('stateChange', ConnectionState.CONNECTED)
            this.emit('connected', connectedPayload)
          } else if (message.state === 'disconnected' || message.state === 'failed') {
            if (this._state === ConnectionState.CONNECTED) {
              this._state = ConnectionState.RECONNECTING
              this.emit('stateChange', ConnectionState.RECONNECTING)
            }
          } else if (message.state === 'connecting') {
            this._state = ConnectionState.CONNECTING
            this.emit('stateChange', ConnectionState.CONNECTING)
          }
          break

        case 'event':
          const evt = message as { event: string; payload: unknown }
          queueMicrotask(() => {
            this.emit('event', { type: 'event', event: evt.event, payload: evt.payload } as RPCEvent)
            this.emit(`event:${evt.event}`, evt.payload)
          })
          break

        case 'backupProgress':
          queueMicrotask(() => {
            this.emit('backupProgress', message)
          })
          break
      }
    } catch (e) {
      console.error('[ApiClient] Failed to parse message:', e)
    }
  }

  private handleDisconnect(): void {
    console.log('[ApiClient] Disconnected, current state:', this._state)

    this.closeEventSource(false)

    this.emit('disconnected', 0, 'SSE disconnected')

    const shouldReconnect =
      this._state !== ConnectionState.DISCONNECTED &&
      this._state !== ConnectionState.FAILED

    if (shouldReconnect) {
      console.log('[ApiClient] Scheduling reconnect...')
      this.scheduleReconnect()
    } else {
      console.log('[ApiClient] Not reconnecting, state:', this._state)
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('[ApiClient] Max reconnect attempts reached:', this.reconnectAttempts)
      this._state = ConnectionState.FAILED
      this.emit('stateChange', ConnectionState.FAILED)
      this.emit('failed', 'Max reconnect attempts reached')
      return
    }

    this._state = ConnectionState.RECONNECTING
    this.emit('stateChange', ConnectionState.RECONNECTING)

    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(1.5, this.reconnectAttempts),
      30000
    )
    this.reconnectAttempts++
    
    console.log('[ApiClient] Reconnecting in', delay, 'ms, attempt', this.reconnectAttempts)

    this.reconnectTimer = setTimeout(() => {
      this.createEventSource()
    }, delay)

    this.emit('reconnecting', this.reconnectAttempts, delay)
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private closeEventSource(intentional: boolean): void {
    this.closing = intentional
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
  }

  async rpc<T = unknown>(method: string, params?: unknown): Promise<T> {
    const url = this.config.baseUrl
      ? `${this.config.baseUrl}/api/rpc`
      : '/api/rpc'

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    const token = this.config.getToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method, params }),
    })

    if (response.status === 401) {
      throw new Error('Unauthorized')
    }

    const result: RPCResponse<T> = await response.json()

    if (!result.ok) {
      throw new Error(result.error?.message || 'RPC call failed')
    }

    return result.payload as T
  }

  async health(): Promise<{ ok: boolean; gateway: string; clients: number }> {
    const url = this.config.baseUrl
      ? `${this.config.baseUrl}/api/health`
      : '/api/health'

    const response = await fetch(url)
    return response.json()
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
    const handlers = this.listeners.get(event)
    if (!handlers || handlers.size === 0) return
    
    handlers.forEach((handler) => {
      try {
        handler(...args)
      } catch (e) {
        console.error(`[ApiClient] Event handler error for "${event}":`, e)
      }
    })
  }
}
