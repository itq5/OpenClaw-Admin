import WebSocket from 'ws'
import { randomUUID } from 'crypto'
import EventEmitter from 'events'
import { createHash, generateKeyPairSync, sign } from 'crypto'

const APP_VERSION = process.env.VITE_APP_VERSION || process.env.npm_package_version || '0.2.3'

export class OpenClawGateway extends EventEmitter {
  constructor(url, authToken, authPassword) {
    super()
    this.url = url
    this.authToken = authToken
    this.authPassword = authPassword // Gateway 密码认证
    this.ws = null
    this.isConnected = false
    this.pendingCalls = new Map()
    this.connectId = null
    this.nonce = null
    this.connectSent = false
    this.reconnectTimer = null
    this.heartbeatTimer = null
    this.deviceIdentity = null
  }

  async connect() {
    if (this.ws) {
      this.ws.close()
    }

    // URL query 参数：token 优先，password 作为备选
    const authParam = this.authToken || this.authPassword || ''
    const wsUrl = authParam ? `${this.url}?auth=${authParam}` : this.url
    
    try {
      this.ws = new WebSocket(wsUrl)
      
      this.ws.on('open', () => {
        this.connectId = `connect-${Date.now()}`
        this.nonce = null
        this.connectSent = false
        this.emit('stateChange', 'connecting')
        
        setTimeout(() => {
          if (!this.connectSent) {
            this.sendConnect()
          }
        }, 500)
      })

      this.ws.on('message', (data) => {
        this.handleMessage(data)
      })

      this.ws.on('close', (code, reason) => {
        this.handleDisconnect(code, reason.toString())
      })

      this.ws.on('error', (err) => {
        this.emit('error', err)
      })
    } catch (err) {
      this.emit('error', err)
      this.scheduleReconnect()
    }
  }

  async sendConnect() {
    if (this.connectSent || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }
    
    this.connectSent = true

    const connectParams = await this.buildConnectParams()

    const frame = {
      type: 'req',
      id: this.connectId,
      method: 'connect',
      params: connectParams,
    }

    this.ws.send(JSON.stringify(frame))
  }

  async buildConnectParams() {
    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'cli',
        displayName: 'OpenClaw Web Backend',
        version: APP_VERSION,
        platform: process.platform,
        mode: 'cli',
      },
      role: 'operator',
      scopes: ['operator.read', 'operator.write', 'operator.admin'],
      caps: ['tool-events'],
      commands: [],
      permissions: {},
      auth: {
        token: this.authToken || '',
        password: this.authPassword || '', // 支持 password 认证
      },
      locale: 'zh-CN',
      userAgent: `OpenClaw-Web-Backend/${APP_VERSION}`,
    }

    try {
      if (!this.deviceIdentity) {
        this.deviceIdentity = await this.generateDeviceIdentity()
      }

      const signedAtMs = Date.now()
      const payload = this.buildDeviceAuthPayload({
        deviceId: this.deviceIdentity.deviceId,
        clientId: params.client.id,
        clientMode: params.client.mode,
        role: params.role,
        scopes: params.scopes,
        signedAtMs,
        token: params.auth.token ?? null,
        nonce: this.nonce || null,
      })

      const signature = await this.signDevicePayload(
        this.deviceIdentity.privateKey,
        payload
      )

      params.device = {
        id: this.deviceIdentity.deviceId,
        publicKey: this.deviceIdentity.publicKey,
        signature,
        signedAt: signedAtMs,
        ...(this.nonce ? { nonce: this.nonce } : {}),
      }
    } catch (e) {
      console.log('[Gateway] Device identity generation failed, using legacy mode:', e.message)
    }

    return params
  }

  async generateDeviceIdentity() {
    const { publicKey, privateKey } = this.generateEd25519KeyPair()
    const publicKeyRaw = Buffer.from(publicKey, 'base64')
    const deviceId = this.bytesToHex(createHash('sha256').update(publicKeyRaw).digest())

    return {
      deviceId,
      publicKey,
      privateKey,
    }
  }

  generateEd25519KeyPair() {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    
    const publicKeyRaw = publicKey.export({ type: 'spki', format: 'der' }).slice(-32)
    const privateKeyRaw = privateKey.export({ type: 'pkcs8', format: 'der' }).slice(-32)
    
    return {
      publicKey: this.base64UrlEncode(publicKeyRaw),
      privateKey: this.base64UrlEncode(privateKeyRaw),
    }
  }

  buildDeviceAuthPayload(params) {
    const version = params.nonce ? 'v2' : 'v1'
    const scopes = params.scopes.join(',')
    const token = params.token ?? ''
    const base = [
      version,
      params.deviceId,
      params.clientId,
      params.clientMode,
      params.role,
      scopes,
      String(params.signedAtMs),
      token,
    ]
    if (version === 'v2') {
      base.push(params.nonce ?? '')
    }
    return base.join('|')
  }

  async signDevicePayload(privateKeyBase64Url, payload) {
    const privateKeyRaw = Buffer.from(
      privateKeyBase64Url.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    )
    const data = Buffer.from(payload, 'utf-8')

    const signature = sign(null, data, {
      key: Buffer.concat([
        Buffer.from('302e020100300506032b657004220420', 'hex'),
        privateKeyRaw,
      ]),
      format: 'der',
      type: 'pkcs8',
    })

    return this.base64UrlEncode(signature.slice(-64))
  }

  base64UrlEncode(buffer) {
    return buffer.toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')
  }

  bytesToHex(bytes) {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  handleMessage(data) {
    try {
      const frame = JSON.parse(data.toString())

      if (frame.type === 'event') {
        if (frame.event === 'connect.challenge') {
          this.nonce = frame.payload?.nonce
          if (this.nonce && !this.connectSent) {
            this.sendConnect()
          }
        } else {
          this.emit('event', frame.event, frame.payload)
        }
        return
      }

      if (frame.type === 'res') {
        if (frame.id === this.connectId) {
          this.handleConnectResponse(frame)
          return
        }

        const pending = this.pendingCalls.get(frame.id)
        if (pending) {
          this.pendingCalls.delete(frame.id)
          clearTimeout(pending.timer)
          if (frame.ok) {
            pending.resolve(frame.payload)
          } else {
            pending.reject(new Error(frame.error?.message || 'RPC call failed'))
          }
        }
      }
    } catch (e) {
      console.error('[Gateway] Failed to handle message:', e.message)
    }
  }

  handleConnectResponse(frame) {
    this.connectId = null

    if (frame.ok) {
      this.isConnected = true
      this.emit('stateChange', 'connected')
      this.emit('connected', frame.payload)
      this.startHeartbeat()
      
      console.log('[Gateway] Connected payload keys:', Object.keys(frame.payload || {}))
      
      const snapshot = frame.payload?.snapshot
      console.log('[Gateway] Snapshot keys:', snapshot ? Object.keys(snapshot) : 'No snapshot')
      
      const updateInfo = snapshot?.updateAvailable
      const serverVersion = frame.payload?.server?.version
      console.log('[Gateway] Update info:', updateInfo)
      console.log('[Gateway] Server version:', serverVersion)
      
      if (updateInfo) {
        console.log('[Gateway] Emitting version event with:', updateInfo)
        this.emit('version', updateInfo)
      } else if (serverVersion) {
        // 如果没有updateAvailable，但有server.version，则使用server.version
        console.log('[Gateway] Emitting version event with server version:', serverVersion)
        this.emit('version', { currentVersion: serverVersion, latestVersion: serverVersion, channel: 'latest' })
      } else {
        console.log('[Gateway] No version info found')
      }
    } else {
      const error = frame.error?.message || 'Connection failed'
      this.emit('error', new Error(error))
      this.emit('stateChange', 'failed')
      this.ws?.close()
    }
  }

  handleDisconnect(code, reason) {
    this.isConnected = false
    this.connectSent = false
    this.connectId = null
    this.clearTimers()
    
    this.emit('stateChange', 'disconnected')
    this.emit('disconnected', code, reason)

    for (const [id, pending] of this.pendingCalls) {
      pending.reject(new Error('Connection closed'))
    }
    this.pendingCalls.clear()

    this.scheduleReconnect()
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 3000)
  }

  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
        this.call('health').catch(() => {})
      }
    }, 30000)
  }

  clearTimers() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  call(method, params, timeout = 160000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'))
        return
      }

      const id = `rpc-${randomUUID()}`
      const frame = { type: 'req', id, method, params }

      const timer = setTimeout(() => {
        this.pendingCalls.delete(id)
        reject(new Error(`RPC call "${method}" timed out`))
      }, timeout)

      this.pendingCalls.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify(frame))
    })
  }

  disconnect() {
    this.clearTimers()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.isConnected = false
  }
}
