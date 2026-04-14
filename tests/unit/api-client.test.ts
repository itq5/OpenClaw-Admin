import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '@/api/http-client'
import { ConnectionState } from '@/api/types'

type GatewayStateMessage = {
  type: 'gatewayState'
  state: string
  version?: string
  updateAvailable?: {
    currentVersion: string
    latestVersion: string
    channel: string
  }
  features?: {
    methods?: string[]
  }
}

function dispatchGatewayState(client: ApiClient, message: GatewayStateMessage): void {
  ;(client as unknown as { handleMessage: (data: string) => void }).handleMessage(JSON.stringify(message))
}

class MockEventSource {
  static instances: MockEventSource[] = []

  readonly url: string
  readyState = 1
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  close(): void {
    this.readyState = 2
  }
}

describe('ApiClient gatewayState handling', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    MockEventSource.instances = []
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('emits connected once and forwards features from gatewayState', () => {
    const client = new ApiClient()
    const stateChanges: string[] = []
    const connectedPayloads: unknown[] = []

    client.on('stateChange', (state) => {
      stateChanges.push(state as string)
    })
    client.on('connected', (payload) => {
      connectedPayloads.push(payload)
    })

    const updateAvailable = {
      currentVersion: '2026.4.5',
      latestVersion: '2026.4.9',
      channel: 'latest',
    }
    const features = {
      methods: ['health', 'status', 'agents.list'],
    }

    dispatchGatewayState(client, {
      type: 'gatewayState',
      state: 'connected',
      version: '2026.4.5',
      updateAvailable,
      features,
    })

    expect(client.state).toBe(ConnectionState.CONNECTED)
    expect(stateChanges).toEqual([ConnectionState.CONNECTED])
    expect(connectedPayloads).toEqual([
      {
        version: '2026.4.5',
        updateAvailable,
        features,
      },
    ])
  })

  it('transitions to reconnecting when a connected gateway disconnects', () => {
    const client = new ApiClient()
    const stateChanges: string[] = []

    client.on('stateChange', (state) => {
      stateChanges.push(state as string)
    })

    dispatchGatewayState(client, {
      type: 'gatewayState',
      state: 'connected',
      features: { methods: ['health'] },
    })
    dispatchGatewayState(client, {
      type: 'gatewayState',
      state: 'disconnected',
    })

    expect(client.state).toBe(ConnectionState.RECONNECTING)
    expect(stateChanges).toEqual([
      ConnectionState.CONNECTED,
      ConnectionState.RECONNECTING,
    ])
  })

  it('suppresses EventSource errors when the page is being hidden', () => {
    vi.stubGlobal('EventSource', MockEventSource)

    const client = new ApiClient()
    client.connect()

    expect(MockEventSource.instances).toHaveLength(1)

    const source = MockEventSource.instances[0]
    window.dispatchEvent(new Event('pagehide'))
    source.onerror?.(new Event('error'))

    expect(console.error).not.toHaveBeenCalled()

    client.dispose()
  })
})
