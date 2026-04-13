import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'
import { dirname, join, resolve, basename, extname, sep, dirname as pathDirname } from 'path'
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, unlinkSync, stat, promises as fsPromises, createReadStream, createWriteStream, copyFileSync, readlinkSync, symlinkSync, renameSync, realpath } from 'fs'
import { OpenClawGateway } from './gateway.js'
import { parse } from 'dotenv'
import os from 'os'
import multer from 'multer'
import checkDiskSpace from 'check-disk-space'
import { execSync } from 'child_process'
import pty from 'node-pty'
import db, { createBackupRecord, updateBackupRecord, getBackupRecord, getBackupRecords, getBackupRecordsCount, deleteBackupRecord } from './database.js'
import { registerOfficeRoutes, migrateOfficeTables } from './office.js'
import { registerMyWorldRoutes, migrateMyWorldTables } from './myworld.js'
import auditRoutes from './routes/audit.routes.js'
import batchRoutes from './routes/batch.routes.js'
import searchRoutes from './routes/search.routes.js'
import statsRoutes from './routes/stats.routes.js'
import rbacRoutes from './routes/rbac.routes.js'
import themesRoutes from './routes/themes.routes.js'
import importExportRoutes from './routes/import-export.routes.js'
import monitoringRoutes from './routes/monitoring.routes.js'
import { applyConfigUpdate, sanitizeConfigForClient } from './config-sanitizer.js'
import {
  hashPassword, verifyPassword, generateToken, createSession,
  validateSession, invalidateSession, invalidateAllUserSessions,
  getUserById, getUserByUsername, getUserPermissions, userHasPermission,
  userHasAnyPermission, getUserRoles, attachAuth, requireAuth,
  requirePermission, requireAnyPermission, requireRole,
  createAuditLog, getAuditLogs, cleanupExpiredSessions
} from './auth.js'
import {
  createNotification, getNotifications, getUnreadCount,
  markNotificationRead, markAllNotificationsRead,
  deleteNotification, cleanupExpiredNotifications,
  sendImmediateNotification, NOTIFICATION_TYPES, NOTIFICATION_PRIORITIES
} from './notifications.js'
import { collectLocalSystemMetrics } from './system-metrics.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const envPath = join(__dirname, '../.env')

function loadEnvConfig() {
  if (!existsSync(envPath)) {
    return {
      PORT: 3001,
      OPENCLAW_WS_URL: 'ws://localhost:18789',
      OPENCLAW_AUTH_TOKEN: '',
      OPENCLAW_AUTH_PASSWORD: '',
      DEV_FRONTEND_URL: 'http://localhost:3000',
      AUTH_USERNAME: '',
      AUTH_PASSWORD: '',
      MEDIA_DIR: '',
      LOG_LEVEL: 'INFO',
    }
  }
  const content = readFileSync(envPath, 'utf-8')
  const parsed = parse(content)
  return {
    PORT: parsed.PORT || 3001,
    OPENCLAW_WS_URL: parsed.OPENCLAW_WS_URL || 'ws://localhost:18789',
    OPENCLAW_AUTH_TOKEN: parsed.OPENCLAW_AUTH_TOKEN || '',
    OPENCLAW_AUTH_PASSWORD: parsed.OPENCLAW_AUTH_PASSWORD || '',
    DEV_FRONTEND_URL: parsed.DEV_FRONTEND_URL || 'http://localhost:3000',
    AUTH_USERNAME: parsed.AUTH_USERNAME || '',
    AUTH_PASSWORD: parsed.AUTH_PASSWORD || '',
    MEDIA_DIR: parsed.MEDIA_DIR || '',
    LOG_LEVEL: parsed.LOG_LEVEL || 'INFO',
  }
}

let envConfig = loadEnvConfig()

const isDebug = envConfig.LOG_LEVEL === 'DEBUG'

function debug(...args) {
  if (isDebug) {
    console.log('[DEBUG]', ...args)
  }
}

const app = express()
const server = createServer(app)

const distPath = join(__dirname, '../dist')
const hasDist = existsSync(join(distPath, 'index.html'))

const sessions = new Map()

// Security: CORS configuration with allowed origins
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:10001').split(',')

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true)
    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      console.warn(`[CORS] Blocked origin: ${origin}`)
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'X-Request-Id'],
  maxAge: 86400,
}))
app.use(express.json({ limit: '1mb' })) // Prevent large payload DoS
app.use(express.urlencoded({ extended: true, limit: '1mb' }))
app.use(express.json())

// Security: HTTP headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:")
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  next()
})

// Cookie parser (simple inline)
app.use((req, res, next) => {
  const cookieHeader = req.headers.cookie
  req.cookies = {}
  if (cookieHeader) {
    for (const pair of cookieHeader.split(';')) {
      const idx = pair.indexOf('=')
      if (idx > 0) {
        const key = pair.slice(0, idx).trim()
        const val = pair.slice(idx + 1).trim()
        req.cookies[key] = val
      }
    }
  }
  next()
})

// Attach auth for all routes (optional auth - won't block)
app.use(attachAuth)

// ========== SECURITY HARDENING: Global Security Headers ==========
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  res.setHeader('X-Request-Id', randomUUID())
  next()
})

// ========== SECURITY HARDENING: Global API Rate Limiting ==========
const _globalRateLimits = new Map()
const _GLOBAL_RATE_WINDOW = 60 * 1000
const _GLOBAL_RATE_MAX = 200

app.use((req, res, next) => {
  // Skip rate limiting for health check and static assets
  if (req.path === '/api/health' || req.path === '/' || req.path.startsWith('/dist') || req.path.startsWith('/public')) {
    return next()
  }
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    req.ip ||
    'unknown'
  const now = Date.now()
  let record = _globalRateLimits.get(ip)
  if (!record || now > record.windowStart + _GLOBAL_RATE_WINDOW) {
    record = { count: 1, windowStart: now }
    _globalRateLimits.set(ip, record)
    return next()
  }
  record.count++
  if (record.count > _GLOBAL_RATE_MAX) {
    res.setHeader('Retry-After', Math.ceil((record.windowStart + _GLOBAL_RATE_WINDOW - now) / 1000))
    return res.status(429).json({ ok: false, error: 'Too Many Requests', code: 'RATE_LIMITED', retryAfter: Math.ceil((record.windowStart + _GLOBAL_RATE_WINDOW - now) / 1000) })
  }
  res.setHeader('X-RateLimit-Limit', String(_GLOBAL_RATE_MAX))
  res.setHeader('X-RateLimit-Remaining', String(_GLOBAL_RATE_MAX - record.count))
  res.setHeader('X-RateLimit-Reset', String(Math.ceil((record.windowStart + _GLOBAL_RATE_WINDOW - now) / 1000)))
  next()
})

// ========== SECURITY HARDENING: Brute Force Tracker (shared with login) ==========
const _bruteForceTracker = new Map()
const _BRUTE_FORCE_THRESHOLD = 200
const _BRUTE_FORCE_WINDOW = 5 * 60 * 1000

function _recordBruteForce(ip) {
  const now = Date.now()
  let record = _bruteForceTracker.get(ip)
  if (!record || now > record.windowStart + _BRUTE_FORCE_WINDOW) {
    record = { count: 1, windowStart: now, releaseAt: null }
    _bruteForceTracker.set(ip, record)
    return false
  }
  record.count++
  if (record.count >= _BRUTE_FORCE_THRESHOLD) {
    record.releaseAt = now + _BRUTE_FORCE_WINDOW * 2
    console.warn(`[Security] IP ${ip} blocked for excessive requests`)
    return true
  }
  return false
}

function _isIpBlocked(ip) {
  const record = _bruteForceTracker.get(ip)
  if (!record) return false
  if (Date.now() > record.releaseAt) { _bruteForceTracker.delete(ip); return false }
  return true
}



let gateway = new OpenClawGateway(envConfig.OPENCLAW_WS_URL, envConfig.OPENCLAW_AUTH_TOKEN, envConfig.OPENCLAW_AUTH_PASSWORD, envConfig.LOG_LEVEL)

const sseClients = new Map()

const terminalSessions = new Map()
const desktopSessions = new Map()

function cleanupTerminalSession(sessionId) {
  const session = terminalSessions.get(sessionId)
  if (!session) return false
  
  try {
    if (session.ptyProcess) {
      session.ptyProcess.kill()
    }
  } catch (e) {
    debug('[Terminal] Error killing PTY process:', e.message)
  }
  
  terminalSessions.delete(sessionId)
  console.log(`[Terminal] Session ${sessionId} cleaned up`)
  return true
}

function cleanupAllTerminalSessions() {
  const sessionIds = [...terminalSessions.keys()]
  console.log(`[Terminal] Cleaning up ${sessionIds.length} terminal sessions...`)
  for (const sessionId of sessionIds) {
    cleanupTerminalSession(sessionId)
  }
}

function cleanupOrphanedSessions() {
  const now = Date.now()
  const STALE_THRESHOLD = 30 * 60 * 1000
  
  for (const [sessionId, session] of terminalSessions) {
    const isStale = session.lastHeartbeat && (now - session.lastHeartbeat) > STALE_THRESHOLD
    const hasDeadResponse = !session.res || session.res.writableEnded || session.res.destroyed
    
    if (isStale || hasDeadResponse) {
      console.log(`[Terminal] Cleaning up orphaned session ${sessionId} (stale: ${isStale}, dead response: ${hasDeadResponse})`)
      cleanupTerminalSession(sessionId)
    }
  }
}

setInterval(cleanupOrphanedSessions, 5 * 60 * 1000)

let gatewayVersion = null
let updateInfo = null

gateway.on('connected', () => {
  console.log('[Gateway] Connected to OpenClaw')
})

gateway.on('version', (info) => {
  debug('Gateway version info:', info)
  updateInfo = info
  gatewayVersion = info.currentVersion
  broadcastSSE({ type: 'gatewayState', state: 'connected', version: info.currentVersion, updateAvailable: info })
})

gateway.on('disconnected', () => {
  console.log('[Gateway] Disconnected from OpenClaw')
  gatewayVersion = null
  broadcastSSE({ type: 'gatewayState', state: 'disconnected' })
})

gateway.on('error', (err) => {
  console.error('[Gateway] Error:', err.message)
  debug('Error stack:', err.stack)
})

gateway.on('event', (event, payload) => {
  debug('Gateway event:', event, 'payload keys:', payload ? Object.keys(payload) : null)
  broadcastSSE({ type: 'event', event, payload })
})

gateway.on('stateChange', (state) => {
  debug('Gateway state changed to:', state)
  broadcastSSE({ type: 'gatewayState', state })
})

debug('Connecting to Gateway at:', envConfig.OPENCLAW_WS_URL)
gateway.connect()

function broadcastSSE(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`
  for (const [id, client] of sseClients) {
    try {
      client.res.write(message)
    } catch (e) {
      sseClients.delete(id)
    }
  }
}

function isAuthEnabled() {
  return Boolean(envConfig.AUTH_USERNAME && envConfig.AUTH_PASSWORD)
}

function getAuthTokenFromRequest(req) {
  return req.headers.authorization?.replace('Bearer ', '') || req.cookies?.session_token || null
}

function getEnvSessionFromRequest(req) {
  if (!isAuthEnabled()) return null
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    req.ip ||
    'unknown'

  if (_isIpBlocked(ip)) {
    return { blocked: true }
  }

  const token = getAuthTokenFromRequest(req)
  if (!token) return null
  const session = sessions.get(token)
  if (!session) return null
  if (session.expires < Date.now()) {
    sessions.delete(token)
    return null
  }
  return { token, session }
}

function buildEnvAuthContext(token, session) {
  return {
    sessionId: token,
    userId: `env:${session.username}`,
    username: session.username,
    displayName: session.username,
    role: 'admin',
    permissions: ['perm_system_admin'],
    expiresAt: session.expires,
    isEnvAuth: true,
  }
}

function applyAuthContext(req, authContext) {
  req.auth = authContext
  req.user = authContext
    ? {
        id: authContext.userId,
        username: authContext.username,
        role: authContext.role,
        permissions: authContext.permissions,
      }
    : null
  req.sessionId = authContext?.sessionId || null
}

function checkAuth(req) {
  if (!isAuthEnabled()) return true
  if (req.auth) return true
  const envSession = getEnvSessionFromRequest(req)
  if (!envSession || envSession.blocked) return false
  return true
}

function authMiddleware(req, res, next) {
  if (!isAuthEnabled()) return next()
  if (req.auth) {
    return next()
  }

  const envSession = getEnvSessionFromRequest(req)
  if (envSession?.token && envSession.session) {
    applyAuthContext(req, buildEnvAuthContext(envSession.token, envSession.session))
    return next()
  }

  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

app.use((req, _res, next) => {
  if (req.auth || !isAuthEnabled()) {
    return next()
  }

  const envSession = getEnvSessionFromRequest(req)
  if (envSession?.token && envSession.session) {
    applyAuthContext(req, buildEnvAuthContext(envSession.token, envSession.session))
  }

  next()
})

app.get('/api/auth/config', (req, res) => {
  res.json({
    enabled: isAuthEnabled(),
  })
})

app.post('/api/auth/login', (req, res) => {
  if (!isAuthEnabled()) {
    return res.json({ ok: true, message: 'Auth disabled' })
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    req.ip ||
    'unknown'

  // SECURITY: Check brute force IP block
  if (_isIpBlocked(ip)) {
    const record = _bruteForceTracker.get(ip)
    const remaining = Math.ceil((record.releaseAt - Date.now()) / 1000)
    return res.status(429).json({
      ok: false,
      error: 'Too many failed attempts. Please try again later.',
      code: 'IP_LOCKED',
      retryAfter: remaining,
    })
  }

  const { username, password } = req.body

  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'Username and password required' })
  }

  // SECURITY: Type validation
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ ok: false, error: 'Invalid request format' })
  }

  // SECURITY: Username format validation (prevent injection)
  if (!/^[a-zA-Z0-9_\-\.]{1,64}$/.test(username)) {
    return res.status(400).json({ ok: false, error: 'Invalid username format' })
  }

  if (username !== envConfig.AUTH_USERNAME || password !== envConfig.AUTH_PASSWORD) {
    // SECURITY: Record brute force attempt
    _recordBruteForce(ip)

    // SECURITY: Audit log failed login
    if (typeof createAuditLog === 'function') {
      createAuditLog({
        username,
        action: 'LOGIN_FAILED',
        resource: 'auth',
        details: { reason: 'invalid_credentials' },
        ipAddress: ip,
        userAgent: req.get('User-Agent'),
        status: 'failure',
      }).catch(() => {})
    }

    return res.status(401).json({ ok: false, error: 'Invalid credentials' })
  }

  // SECURITY: Audit log successful login
  if (typeof createAuditLog === 'function') {
    createAuditLog({
      username,
      action: 'LOGIN_SUCCESS',
      resource: 'auth',
      details: {},
      ipAddress: ip,
      userAgent: req.get('User-Agent'),
      status: 'success',
    }).catch(() => {})
  }

  const token = randomUUID()
  const expires = Date.now() + 24 * 60 * 60 * 1000

  sessions.set(token, { username, expires })

  // SECURITY: Set secure cookie flags (HttpOnly, SameSite)
  const isProduction = process.env.NODE_ENV === 'production' || process.env.https === 'on'
  const cookieValue = `session_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${24 * 60 * 60}${isProduction ? '; Secure' : ''}`
  res.setHeader('Set-Cookie', cookieValue)

  res.json({
    ok: true,
    token,
    user: {
      id: `env:${username}`,
      username,
      role: 'admin',
      permissions: ['perm_system_admin'],
    },
  })
})

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (token) {
    sessions.delete(token)
  }
  res.json({ ok: true })
})

app.get('/api/auth/check', authMiddleware, (req, res) => {
  res.json({
    ok: true,
    authenticated: true,
    user: req.user,
    sessionId: req.sessionId,
  })
})

function parseEnvFile(content) {
  const result = {}
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

function stringifyEnvFile(data) {
  const lines = []
  for (const [key, value] of Object.entries(data)) {
    const escaped = value.includes('\n') || value.includes('"') || value.includes("'")
      ? `"${value.replace(/"/g, '\\"')}"`
      : value
    lines.push(`${key}=${escaped}`)
  }
  return lines.join('\n') + '\n'
}

app.get('/api/config', authMiddleware, (req, res) => {
  try {
    if (!existsSync(envPath)) {
      return res.json({ ok: true, config: {} })
    }
    const content = readFileSync(envPath, 'utf-8')
    const config = parseEnvFile(content)
    res.json({ ok: true, config: sanitizeConfigForClient(config) })
  } catch (err) {
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

// SECURITY: Config write requires config:write permission
// Note: We use requirePermission from auth.js
app.post('/api/config', authMiddleware, (req, res) => {
  try {
    const existingContent = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : ''
    const existing = parseEnvFile(existingContent)

    const nextConfig = applyConfigUpdate(existing, req.body || {})
    const newContent = stringifyEnvFile(nextConfig)
    writeFileSync(envPath, newContent, 'utf-8')
    
    const oldConfig = { ...envConfig }
    envConfig = loadEnvConfig()
    
    const wsUrlChanged = oldConfig.OPENCLAW_WS_URL !== envConfig.OPENCLAW_WS_URL
    const tokenChanged = oldConfig.OPENCLAW_AUTH_TOKEN !== envConfig.OPENCLAW_AUTH_TOKEN
    const passwordChanged = oldConfig.OPENCLAW_AUTH_PASSWORD !== envConfig.OPENCLAW_AUTH_PASSWORD
    
    if (wsUrlChanged || tokenChanged || passwordChanged) {
      console.log('[Config] Gateway config changed, reconnecting...')
      gateway.disconnect()
      gateway = new OpenClawGateway(envConfig.OPENCLAW_WS_URL, envConfig.OPENCLAW_AUTH_TOKEN, envConfig.OPENCLAW_AUTH_PASSWORD)
      
      gateway.on('connected', (info) => {
        console.log('[Gateway] Connected to OpenClaw:', info?.server?.version)
        broadcastSSE({ type: 'gatewayState', state: 'connected' })
      })
      gateway.on('disconnected', () => {
        console.log('[Gateway] Disconnected from OpenClaw')
        broadcastSSE({ type: 'gatewayState', state: 'disconnected' })
      })
      gateway.on('error', (err) => {
        console.error('[Gateway] Error:', err.message)
      })
      gateway.on('event', (event, payload) => {
        broadcastSSE({ type: 'event', event, payload })
      })
      gateway.on('stateChange', (state) => {
        broadcastSSE({ type: 'gatewayState', state })
      })
      gateway.connect()
    }
    
    console.log('[Config] Configuration reloaded')
    res.json({ ok: true, message: 'Configuration saved and reloaded.' })
  } catch (err) {
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    gateway: gateway.isConnected ? 'connected' : 'disconnected',
    clients: sseClients.size,
  })
})

app.get('/api/npm/versions', async (req, res) => {
  try {
    const response = await fetch('https://registry.npmjs.org/openclaw')
    if (!response.ok) {
      throw new Error('Failed to fetch versions from npm')
    }
    const data = await response.json()
    const versions = Object.keys(data.versions || {})
    
    // 过滤并排序版本号
    const validVersions = versions.filter(version => /^\d+\.\d+\.\d+/.test(version))
    validVersions.sort((a, b) => {
      const aParts = a.split('.').map(Number)
      const bParts = b.split('.').map(Number)
      
      for (let i = 0; i < 3; i++) {
        const aVal = aParts[i] || 0
        const bVal = bParts[i] || 0
        if (aVal !== bVal) {
          return bVal - aVal
        }
      }
      return 0
    })
    
    res.json({ versions: validVersions })
  } catch (error) {
    console.error('[Server] Failed to fetch npm versions:', error.message)
    res.status(500).json({ error: 'Failed to fetch versions from npm' })
  }
})

// SECURITY: npm update requires admin role (system changes)
app.post('/api/npm/update', requireRole('admin'), async (req, res) => {
  try {
    const { version } = req.body
    const packageSpec = version ? `openclaw@${version}` : 'openclaw@latest'
    
    console.log(`[Server] Updating OpenClaw via npm: ${packageSpec}`)
    
    // 执行npm更新命令
    // Security: Whitelist for allowed packages
    const ALLOWED_PACKAGES = ['openclaw', 'pm2', 'nodemon', 'typescript', 'tsx']
    const packageName = packageSpec.split('@')[0]
    if (!ALLOWED_PACKAGES.includes(packageName)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid package',
        message: `Package '${packageName}' is not in the allowed list: ${ALLOWED_PACKAGES.join(', ')}`
      })
    }

    // Sanitize package spec to prevent command injection
    const sanitizedSpec = packageSpec.replace(/[^a-zA-Z0-9@.-]/g, '')
    if (sanitizedSpec !== packageSpec) {
      return res.status(400).json({
        success: false,
        error: 'Invalid package spec',
        message: 'Package spec contains invalid characters'
      })
    }

    const { execSync } = await import('child_process')
    const output = execSync(`npm install -g ${sanitizedSpec}`, {
      encoding: 'utf8',
      timeout: 120000 // 2分钟超时
    })

    console.log('[Server] npm update output:', output)

    res.json({
      ok: true,
      message: `Successfully updated to ${packageSpec}`,
      output: output
    })
  } catch (error) {
    console.error('[Server] Failed to update OpenClaw via npm:', error.message)
    res.status(500).json({
      ok: false,
      error: error.message,
      stdout: error.stdout,
      stderr: error.stderr
    })
  }
})

let lastNetworkStats = null
let lastNetworkTime = null

function getNetworkStats() {
  const platform = os.platform()
  let bytesReceived = 0
  let bytesSent = 0

  try {
    if (platform === 'win32') {
      const output = execSync(
        'powershell -NoProfile -Command "Get-NetAdapterStatistics | ConvertTo-Json"',
        { encoding: 'utf8', timeout: 5000 }
      )
      const stats = JSON.parse(output || '[]')
      const adapters = Array.isArray(stats) ? stats : [stats]
      for (const adapter of adapters) {
        if (adapter) {
          bytesReceived += Number(adapter.ReceivedBytes) || 0
          bytesSent += Number(adapter.SentBytes) || 0
        }
      }
    } else {
      const netDev = readFileSync('/proc/net/dev', 'utf8')
      const lines = netDev.trim().split('\n').slice(2)
      for (const line of lines) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 10) {
          const iface = parts[0].replace(':', '')
          if (iface === 'lo') continue
          bytesReceived += parseInt(parts[1], 10) || 0
          bytesSent += parseInt(parts[9], 10) || 0
        }
      }
    }
  } catch {
    bytesReceived = 0
    bytesSent = 0
  }

  return { bytesReceived, bytesSent }
}

async function getDiskSpace() {
  try {
    const platform = os.platform()
    let checkPath = '/'
    if (platform === 'win32') {
      checkPath = process.env.SystemDrive || 'C:\\'
    }
    const diskSpace = await checkDiskSpace(checkPath)
    return {
      total: diskSpace.size,
      free: diskSpace.free,
      used: diskSpace.size - diskSpace.free,
    }
  } catch {
    return { total: 0, free: 0, used: 0 }
  }
}

app.get('/api/system/metrics', authMiddleware, async (req, res) => {
  try {
    const metrics = collectLocalSystemMetrics()

    let presence = []
    try {
      if (gateway.isConnected) {
        presence = await gateway.call('system-presence')
        if (!Array.isArray(presence)) {
          presence = presence?.presence || presence?.items || presence?.list || []
        }
      }
    } catch {
      presence = []
    }

    let uptime = os.uptime()
    try {
      if (gateway.isConnected) {
        const health = await gateway.call('health')
        uptime = health?.uptime || uptime
      }
    } catch {
      // use os uptime
    }

    metrics.uptime = uptime

    res.json({
      ok: true,
      metrics,
      presence,
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

const WORKSPACE_BASE = join(__dirname, '..')

const agentWorkspaceCache = new Map()

function expandHomePath(path) {
  if (!path) return path
  if (path.startsWith('~')) {
    return join(os.homedir(), path.slice(1))
  }
  return path
}

async function safePath(userPath, workspaceBase) {
  if (!workspaceBase) return null
  
  const expandedBase = resolve(expandHomePath(workspaceBase))
  const targetPath = resolve(expandedBase, userPath || '')
  
  // Security: Resolve symbolic links to prevent symlink attacks
  let realPath
  try {
    if (await fsPromises.stat(targetPath).catch(() => null)) {
      realPath = await fsPromises.realpath(targetPath)
    } else {
      // For non-existent paths, resolve the parent directory
      const parentDir = pathDirname(targetPath)
      if (await fsPromises.stat(parentDir).catch(() => null)) {
        const realParentDir = await fsPromises.realpath(parentDir)
        realPath = join(realParentDir, basename(targetPath))
      } else {
        realPath = targetPath
      }
    }
  } catch (e) {
    realPath = targetPath
  }
  
  const normalizedBase = expandedBase.toLowerCase()
  const normalizedTarget = realPath.toLowerCase()
  
  if (!normalizedTarget.startsWith(normalizedBase)) {
    console.log('[Files] Path escape detected:', { 
      base: expandedBase, 
      target: realPath,
      userPath 
    })
    return null
  }
  
  return realPath
}

async function getAgentWorkspace(agentId) {
  if (agentWorkspaceCache.has(agentId)) {
    const cached = agentWorkspaceCache.get(agentId)
    if (Date.now() - cached.timestamp < 60000) {
      return cached.workspace
    }
  }
  
  if (!gateway.isConnected) {
    return null
  }
  
  try {
    const result = await gateway.call('agents.files.list', { agentId })
    const workspace = result?.workspace || result?.dir || result?.path
    if (workspace) {
      agentWorkspaceCache.set(agentId, { workspace, timestamp: Date.now() })
    }
    return workspace
  } catch (e) {
    console.error('[Files] Failed to get agent workspace:', e.message)
    return null
  }
}

app.get('/api/agents/workspace', authMiddleware, async (req, res) => {
  try {
    const agentId = req.query.agentId || 'main'
    
    if (!gateway.isConnected) {
      return res.status(503).json({ ok: false, error: { message: 'Gateway not connected' } })
    }
    
    const workspace = await getAgentWorkspace(agentId)
    
    if (!workspace) {
      return res.status(404).json({ ok: false, error: { message: 'Could not determine agent workspace' } })
    }
    
    res.json({
      ok: true,
      agentId,
      workspace,
      expandedPath: expandHomePath(workspace)
    })
  } catch (err) {
    console.error('[Agents] Workspace error:', err)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

app.get('/api/files/list', authMiddleware, async (req, res) => {
  try {
    const relPath = req.query.path || ''
    const workspaceParam = req.query.workspace || ''
    
    if (!workspaceParam) {
      return res.status(400).json({ ok: false, error: { message: 'Workspace parameter is required' } })
    }
    
    const workspaceBase = expandHomePath(workspaceParam)
    const absPath = safePath(relPath, workspaceBase)
    
    console.log('[Files] List:', { relPath, workspaceParam, workspaceBase, absPath })
    
    if (!absPath) {
      return res.status(400).json({ ok: false, error: { message: 'Invalid path' } })
    }
    
    if (!existsSync(absPath)) {
      return res.json({ ok: true, files: [], path: relPath, workspaceRoot: workspaceBase })
    }
    
    const stats = statSync(absPath)
    if (!stats.isDirectory()) {
      return res.json({ ok: true, files: [], path: relPath, workspaceRoot: workspaceBase })
    }
    
    const entries = readdirSync(absPath, { withFileTypes: true })
    const files = entries.map(entry => {
      const fullPath = join(absPath, entry.name)
      let size = 0
      let mtime = 0
      
      try {
        const s = statSync(fullPath)
        size = s.size
        mtime = s.mtimeMs
      } catch {}
      
      const entryRelPath = relPath ? `${relPath}/${entry.name}` : entry.name
      
      return {
        name: entry.name,
        path: entryRelPath.replace(/\\/g, '/'),
        type: entry.isDirectory() ? 'directory' : 'file',
        isDirectory: entry.isDirectory(),
        size: entry.isFile() ? size : undefined,
        updatedAtMs: mtime,
        extension: entry.isFile() ? extname(entry.name).slice(1).toLowerCase() : undefined,
      }
    })
    
    files.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    
    res.json({ 
      ok: true, 
      files,
      path: relPath,
      workspaceRoot: workspaceBase
    })
  } catch (err) {
    console.error('[Files] List error:', err)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

app.get('/api/files/get', authMiddleware, async (req, res) => {
  try {
    let relPath = req.query.path || req.query.name
    const workspaceParam = req.query.workspace || ''
    const binary = req.query.binary === 'true'
    
    if (!relPath) {
      return res.status(400).json({ ok: false, error: { message: 'Path is required' } })
    }
    
    if (!workspaceParam) {
      return res.status(400).json({ ok: false, error: { message: 'Workspace parameter is required' } })
    }
    
    // Handle double URL encoding from img src
    try {
      let decoded = decodeURIComponent(relPath)
      // Check if it was double-encoded
      if (decoded.includes('%')) {
        decoded = decodeURIComponent(decoded)
      }
      relPath = decoded
    } catch (e) {
      // If decode fails, use original
    }
    
    const workspaceBase = expandHomePath(workspaceParam)
    const absPath = safePath(relPath, workspaceBase)
    
    console.log('[Files] Get:', { relPath, workspaceParam, absPath, binary })
    
    if (!absPath) {
      return res.status(400).json({ ok: false, error: { message: 'Invalid path' } })
    }
    
    if (!existsSync(absPath)) {
      return res.status(404).json({ ok: false, error: { message: 'File not found' } })
    }
    
    const stats = statSync(absPath)
    if (stats.isDirectory()) {
      return res.status(400).json({ ok: false, error: { message: 'Cannot read directory' } })
    }
    
    const ext = extname(absPath).slice(1).toLowerCase()
    const imgExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']
    const pdfExts = ['pdf']
    
    if (binary && imgExts.includes(ext)) {
      const contentTypeMap = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        svg: 'image/svg+xml',
        webp: 'image/webp',
        ico: 'image/x-icon',
        bmp: 'image/bmp',
      }
      
      const contentType = contentTypeMap[ext] || 'application/octet-stream'
      res.setHeader('Content-Type', contentType)
      res.setHeader('Content-Length', stats.size)
      
      const stream = createReadStream(absPath)
      stream.pipe(res)
      
      stream.on('error', (err) => {
        console.error('[Files] Stream error:', err.message)
        if (!res.headersSent) {
          res.status(500).json({ ok: false, error: { message: err.message } })
        }
      })
      return
    }
    
    if (binary && pdfExts.includes(ext)) {
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Length', stats.size)
      
      const stream = createReadStream(absPath)
      stream.pipe(res)
      
      stream.on('error', (err) => {
        console.error('[Files] PDF stream error:', err.message)
        if (!res.headersSent) {
          res.status(500).json({ ok: false, error: { message: err.message } })
        }
      })
      return
    }
    
    if (imgExts.includes(ext)) {
      const buffer = readFileSync(absPath)
      const base64 = buffer.toString('base64')
      res.json({
        ok: true,
        file: {
          name: basename(absPath),
          path: relPath,
          content: base64,
          isBase64: true,
          size: stats.size,
          updatedAtMs: stats.mtimeMs,
          extension: ext,
        }
      })
    } else {
      const content = readFileSync(absPath, 'utf-8')
      res.json({
        ok: true,
        file: {
          name: basename(absPath),
          path: relPath,
          content,
          size: stats.size,
          updatedAtMs: stats.mtimeMs,
          extension: ext,
        }
      })
    }
  } catch (err) {
    console.error('[Files] Get error:', err)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

app.post('/api/files/set', authMiddleware, async (req, res) => {
  try {
    const { path: relPath, name, content, workspace: workspaceParam } = req.body
    const filePath = relPath || name
    
    if (!filePath) {
      return res.status(400).json({ ok: false, error: { message: 'Path is required' } })
    }
    
    if (!workspaceParam) {
      return res.status(400).json({ ok: false, error: { message: 'Workspace parameter is required' } })
    }
    
    const workspaceBase = expandHomePath(workspaceParam)
    const absPath = safePath(filePath, workspaceBase)
    
    console.log('[Files] Set:', { filePath, workspaceParam, absPath })
    
    if (!absPath) {
      return res.status(400).json({ ok: false, error: { message: 'Invalid path' } })
    }
    
    const parentDir = dirname(absPath)
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true })
    }
    
    if (content === null || content === undefined) {
      if (existsSync(absPath)) {
        unlinkSync(absPath)
      }
      res.json({ ok: true, deleted: true })
    } else {
      writeFileSync(absPath, content, 'utf-8')
      const stats = statSync(absPath)
      res.json({
        ok: true,
        file: {
          name: basename(absPath),
          path: filePath,
          size: stats.size,
          updatedAtMs: stats.mtimeMs,
        }
      })
    }
  } catch (err) {
    console.error('[Files] Set error:', err)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

app.post('/api/files/mkdir', authMiddleware, async (req, res) => {
  try {
    const { path: relPath, name, workspace: workspaceParam } = req.body
    const dirPath = relPath || name
    
    if (!dirPath) {
      return res.status(400).json({ ok: false, error: { message: 'Path is required' } })
    }
    
    if (!workspaceParam) {
      return res.status(400).json({ ok: false, error: { message: 'Workspace parameter is required' } })
    }
    
    const workspaceBase = expandHomePath(workspaceParam)
    const absPath = safePath(dirPath, workspaceBase)
    
    console.log('[Files] Mkdir:', { dirPath, workspaceParam, absPath })
    
    if (!absPath) {
      return res.status(400).json({ ok: false, error: { message: 'Invalid path' } })
    }
    
    if (existsSync(absPath)) {
      return res.status(400).json({ ok: false, error: { message: 'Already exists' } })
    }
    
    mkdirSync(absPath, { recursive: true })
    
    res.json({
      ok: true,
      directory: {
        name: basename(absPath),
        path: dirPath,
      }
    })
  } catch (err) {
    console.error('[Files] Mkdir error:', err)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

// SECURITY: Files delete requires files:manage permission
app.post('/api/files/delete', authMiddleware, requirePermission('files:manage'), async (req, res) => {
  try {
    const { path: relPath, name, workspace: workspaceParam } = req.body
    const filePath = relPath || name
    
    if (!filePath) {
      return res.status(400).json({ ok: false, error: { message: 'Path is required' } })
    }
    
    if (!workspaceParam) {
      return res.status(400).json({ ok: false, error: { message: 'Workspace parameter is required' } })
    }
    
    const workspaceBase = expandHomePath(workspaceParam)
    const absPath = safePath(filePath, workspaceBase)
    
    console.log('[Files] Delete:', { filePath, workspaceParam, absPath })
    
    if (!absPath) {
      return res.status(400).json({ ok: false, error: { message: 'Invalid path' } })
    }
    
    if (!existsSync(absPath)) {
      return res.status(404).json({ ok: false, error: { message: 'Not found' } })
    }
    
    rmSync(absPath, { recursive: true, force: true })
    
    res.json({ ok: true, deleted: true })
  } catch (err) {
    console.error('[Files] Delete error:', err)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

app.post('/api/files/rename', authMiddleware, async (req, res) => {
  try {
    const { oldPath, newPath, workspace: workspaceParam } = req.body
    
    if (!oldPath || !newPath) {
      return res.status(400).json({ ok: false, error: { message: 'Old path and new path are required' } })
    }
    
    if (!workspaceParam) {
      return res.status(400).json({ ok: false, error: { message: 'Workspace parameter is required' } })
    }
    
    const workspaceBase = expandHomePath(workspaceParam)
    const absOldPath = safePath(oldPath, workspaceBase)
    const absNewPath = safePath(newPath, workspaceBase)
    
    console.log('[Files] Rename:', { oldPath, newPath, absOldPath, absNewPath })
    
    if (!absOldPath || !absNewPath) {
      return res.status(400).json({ ok: false, error: { message: 'Invalid path' } })
    }
    
    if (!existsSync(absOldPath)) {
      return res.status(404).json({ ok: false, error: { message: 'Source not found' } })
    }
    
    if (existsSync(absNewPath)) {
      return res.status(400).json({ ok: false, error: { message: 'Target already exists' } })
    }
    
    const { renameSync } = await import('fs')
    renameSync(absOldPath, absNewPath)
    
    res.json({ 
      ok: true, 
      renamed: true,
      oldPath,
      newPath 
    })
  } catch (err) {
    console.error('[Files] Rename error:', err)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
})

app.post('/api/files/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const file = req.file
    const relPath = req.body.path
    const workspaceParam = req.body.workspace
    
    if (!file) {
      return res.status(400).json({ ok: false, error: { message: 'No file uploaded' } })
    }
    
    if (!relPath) {
      return res.status(400).json({ ok: false, error: { message: 'Path is required' } })
    }
    
    if (!workspaceParam) {
      return res.status(400).json({ ok: false, error: { message: 'Workspace parameter is required' } })
    }
    
    const workspaceBase = expandHomePath(workspaceParam)
    const absPath = safePath(relPath, workspaceBase)
    
    console.log('[Files] Upload:', { relPath, workspaceParam, absPath, size: file.size })
    
    if (!absPath) {
      return res.status(400).json({ ok: false, error: { message: 'Invalid path' } })
    }
    
    const parentDir = dirname(absPath)
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true })
    }
    
    await fsPromises.writeFile(absPath, file.buffer)
    
    const stats = statSync(absPath)
    res.json({
      ok: true,
      file: {
        name: basename(absPath),
        path: relPath,
        size: stats.size,
        updatedAtMs: stats.mtimeMs,
      }
    })
  } catch (err) {
    console.error('[Files] Upload error:', err)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

app.get('/api/status', authMiddleware, async (req, res) => {
  try {
    if (!gateway.isConnected) {
      return res.status(503).json({ error: 'Gateway not connected' })
    }
    const status = await gateway.call('status')
    res.json({ ok: true, payload: status })
  } catch (err) {
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

// SECURITY: RPC method whitelist to prevent arbitrary gateway calls
const _rpcMethodWhitelist = new Set([
  'status', 'health', 'agents.list', 'agents.files.list',
  'system-presence', 'gateway.status', 'runtime.list',
  'config.get', 'config.set', 'sessions.list', 'memory.list',
])
// Also allow methods starting with these prefixes
const _rpcPrefixWhitelist = ['gateway.', 'agent.', 'node.']

app.post('/api/rpc', authMiddleware, async (req, res) => {
  const { method, params } = req.body

  if (!method) {
    return res.status(400).json({ error: 'Method is required' })
  }

  // SECURITY: Validate method name format (prevent injection)
  if (typeof method !== 'string' || !/^[a-zA-Z0-9_\-\.]+$/.test(method)) {
    return res.status(400).json({ error: 'Invalid method name' })
  }

  // SECURITY: Check method whitelist
  const isAllowed = _rpcMethodWhitelist.has(method) ||
    _rpcPrefixWhitelist.some(prefix => method.startsWith(prefix))
  if (!isAllowed) {
    console.warn(`[Security] RPC method not whitelisted: ${method}`)
    return res.status(403).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' })
  }

  if (!gateway.isConnected) {
    return res.status(503).json({ error: 'Gateway not connected' })
  }

  try {
    const result = await gateway.call(method, params)
    res.json({ ok: true, payload: result })
  } catch (err) {
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

app.get('/api/events', authMiddleware, (req, res) => {
  debug('[SSE] New client connecting, auth check passed')
  
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const clientId = randomUUID()
  sseClients.set(clientId, { res, subscriptions: new Set(['*']) })
  debug('[SSE] Client connected:', clientId, 'total clients:', sseClients.size)

  res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`)

  const initialState = gateway.isConnected ? 'connected' : 'disconnected'
  debug('[SSE] Sending initial state to client:', clientId, 'state:', initialState, 'gatewayVersion:', gatewayVersion)
  res.write(`data: ${JSON.stringify({ 
    type: 'gatewayState', 
    state: initialState,
    version: initialState === 'connected' ? gatewayVersion : null,
    updateAvailable: initialState === 'connected' ? updateInfo : null
  })}\n\n`)

  req.on('close', () => {
    sseClients.delete(clientId)
    debug('[SSE] Client disconnected:', clientId, 'remaining clients:', sseClients.size)
  })
})

app.get('/api/terminal/stream', authMiddleware, (req, res) => {
  const cols = parseInt(req.query.cols) || 120
  const rows = parseInt(req.query.rows) || 36
  const nodeId = req.query.nodeId || 'local'

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const sessionId = randomUUID()
  const now = Date.now()
  
  const sendEvent = (type, data = {}) => {
    try {
      const event = { type, sessionId, ...data }
      res.write(`data: ${JSON.stringify(event)}\n\n`)
      return true
    } catch (e) {
      console.error('[Terminal] Error sending event:', e.message)
      return false
    }
  }

  try {
    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'
    
    // Security: Limit shell command execution
    const ALLOWED_SHELLS = ['/bin/bash', '/bin/sh', '/usr/bin/zsh']
    if (!ALLOWED_SHELLS.includes(shell)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Shell not allowed'
      })
    }
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.env.HOME || process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color' }
    })

    terminalSessions.set(sessionId, { 
      ptyProcess, 
      nodeId, 
      res, 
      createdAt: now,
      lastHeartbeat: now 
    })

    ptyProcess.onData((data) => {
      try {
        const sent = sendEvent('output', { data })
        if (!sent) {
          console.log(`[Terminal] Failed to send output for session ${sessionId}, cleaning up`)
          cleanupTerminalSession(sessionId)
        }
      } catch (e) {
        console.error('[Terminal] Error sending output:', e.message)
        cleanupTerminalSession(sessionId)
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      console.log(`[Terminal] Session ${sessionId} exited with code ${exitCode}`)
      sendEvent('disconnected', { message: `Process exited with code ${exitCode}` })
      cleanupTerminalSession(sessionId)
    })

    console.log(`[Terminal] Session ${sessionId} created (shell: ${shell}, size: ${cols}x${rows})`)
    sendEvent('connected', { cols, rows })

    req.on('close', () => {
      console.log(`[Terminal] Client disconnected, cleaning up session ${sessionId}`)
      cleanupTerminalSession(sessionId)
    })

    req.on('error', (err) => {
      console.error(`[Terminal] Request error for session ${sessionId}:`, err.message)
      cleanupTerminalSession(sessionId)
    })

  } catch (err) {
    console.error('[Terminal] Failed to create PTY:', err.message)
    sendEvent('error', { message: `Failed to create terminal: ${err.message}` })
    res.end()
  }
})

app.post('/api/terminal/input', authMiddleware, (req, res) => {
  const { sessionId, data } = req.body

  if (!sessionId || !data) {
    return res.status(400).json({ ok: false, error: { message: 'sessionId and data are required' } })
  }

  const session = terminalSessions.get(sessionId)
  if (!session) {
    return res.status(404).json({ ok: false, error: { message: 'Session not found' } })
  }

  try {
    session.ptyProcess.write(data)
    res.json({ ok: true })
  } catch (err) {
    console.error('[Terminal] Error writing to PTY:', err.message)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

app.post('/api/terminal/resize', authMiddleware, (req, res) => {
  const { sessionId, cols, rows } = req.body

  if (!sessionId || cols === undefined || rows === undefined) {
    return res.status(400).json({ ok: false, error: { message: 'sessionId, cols, and rows are required' } })
  }

  const session = terminalSessions.get(sessionId)
  if (!session) {
    return res.status(404).json({ ok: false, error: { message: 'Session not found' } })
  }

  try {
    session.ptyProcess.resize(cols, rows)
    res.json({ ok: true, cols, rows })
  } catch (err) {
    console.error('[Terminal] Error resizing PTY:', err.message)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

// SECURITY: Terminal destroy requires terminal:access permission
app.post('/api/terminal/destroy', authMiddleware, requirePermission('terminal:access'), (req, res) => {
  const { sessionId } = req.body

  if (!sessionId) {
    return res.status(400).json({ ok: false, error: { message: 'sessionId is required' } })
  }

  const cleaned = cleanupTerminalSession(sessionId)
  if (cleaned) {
    console.log(`[Terminal] Session ${sessionId} destroyed via API`)
  }
  res.json({ ok: true, message: cleaned ? 'Session destroyed' : 'Session already destroyed' })
})

app.post('/api/terminal/heartbeat', authMiddleware, (req, res) => {
  const { sessionId } = req.body

  if (!sessionId) {
    return res.status(400).json({ ok: false, error: { message: 'sessionId is required' } })
  }

  const session = terminalSessions.get(sessionId)
  if (!session) {
    return res.status(404).json({ ok: false, error: { message: 'Session not found' } })
  }

  session.lastHeartbeat = Date.now()
  res.json({ ok: true })
})

// ============ Remote Desktop API ============

const { spawn } = await import('child_process')

async function findFreeDisplay() {
  for (let i = 99; i >= 1; i--) {
    const lockFile = `/tmp/.X${i}-lock`
    if (!existsSync(lockFile)) {
      return i
    }
  }
  return 99
}

async function startXvfbDisplay(width, height, depth = 24) {
  const displayNum = await findFreeDisplay()
  const display = `:${displayNum}`
  
  const xvfb = spawn('Xvfb', [
    display,
    '-screen', '0', `${width}x${height}x${depth}`,
    '-ac',
    '-nolisten', 'tcp',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Xvfb startup timeout'))
    }, 5000)
    
    xvfb.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
    
    setTimeout(() => {
      clearTimeout(timeout)
      resolve(true)
    }, 500)
  })
  
  return { display, process: xvfb }
}

async function startX11vnc(display, password) {
  const args = [
    '-display', display,
    '-forever',
    '-shared',
    '-rfbport', '0',
    '-nopw',
  ]
  
  if (password) {
    args.push('-passwd', password)
  }
  
  const vnc = spawn('x11vnc', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  
  let port = null
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('x11vnc startup timeout'))
    }, 10000)
    
    vnc.stderr.on('data', (data) => {
      const str = data.toString()
      const portMatch = str.match(/PORT=(\d+)/)
      if (portMatch) {
        port = parseInt(portMatch[1], 10)
        clearTimeout(timeout)
        resolve(true)
      }
    })
    
    vnc.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
  
  return { process: vnc, port }
}

function startFFmpegCapture(display, width, height, fps = 15, quality = 5) {
  const args = [
    '-f', 'x11grab',
    '-draw_mouse', '1',
    '-video_size', `${width}x${height}`,
    '-framerate', String(fps),
    '-i', display,
    '-vf', `scale=${width}:${height}`,
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-q:v', String(quality),
    '-',
  ]
  
  const ffmpeg = spawn('ffmpeg', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  
  return ffmpeg
}

function parseMJPEGFrames(ffmpeg, onFrame) {
  let buffer = Buffer.alloc(0)
  const SOI = Buffer.from([0xFF, 0xD8])
  const EOI = Buffer.from([0xFF, 0xD9])
  
  ffmpeg.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    
    let start = 0
    while (true) {
      const soiIndex = buffer.indexOf(SOI, start)
      if (soiIndex === -1) break
      
      const eoiIndex = buffer.indexOf(EOI, soiIndex)
      if (eoiIndex === -1) break
      
      const frame = buffer.slice(soiIndex, eoiIndex + 2)
      onFrame(frame)
      start = eoiIndex + 2
    }
    
    if (start > 0) {
      buffer = buffer.slice(start)
    }
  })
  
  return ffmpeg
}

async function captureLinuxDesktopFast(display, width, height, quality = 30) {
  return new Promise((resolve) => {
    const args = [
      '-f', 'x11grab',
      '-draw_mouse', '1',
      '-video_size', `${width}x${height}`,
      '-i', display,
      '-vframes', '1',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-q:v', String(quality),
      '-',
    ]
    
    const proc = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    
    const chunks = []
    proc.stdout.on('data', (chunk) => chunks.push(chunk))
    proc.on('close', () => {
      if (chunks.length > 0) {
        resolve(Buffer.concat(chunks))
      } else {
        resolve(null)
      }
    })
    proc.on('error', () => resolve(null))
  })
}

async function captureLinuxDesktop(display, width, height) {
  return captureLinuxDesktopFast(display, width, height, 30)
}

async function captureWindowsDesktop() {
  return new Promise((resolve) => {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      $bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
      $encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
      $params = New-Object System.Drawing.Imaging.EncoderParameters(1)
      $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 50L)
      $stream = New-Object System.IO.MemoryStream
      $bitmap.Save($stream, $encoder, $params)
      [Convert]::ToBase64String($stream.ToArray())
    `
    
    const proc = spawn('powershell', ['-NoProfile', '-Command', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    
    let output = ''
    proc.stdout.on('data', (data) => output += data.toString())
    proc.on('close', () => {
      if (output) {
        try {
          resolve(Buffer.from(output.trim(), 'base64'))
        } catch {
          resolve(null)
        }
      } else {
        resolve(null)
      }
    })
    proc.on('error', () => resolve(null))
  })
}

app.get('/api/desktop/displays', authMiddleware, (req, res) => {
  if (process.platform === 'win32') {
    return res.json({ ok: true, displays: [], platform: 'windows' })
  }
  
  const displays = []
  const tmpDir = '/tmp'
  
  try {
    const files = readdirSync(tmpDir)
    const lockPattern = /^\.X(\d+)-lock$/
    
    for (const file of files) {
      const match = file.match(lockPattern)
      if (match) {
        const displayNum = match[1]
        displays.push({
          display: `:${displayNum}`,
          number: parseInt(displayNum, 10),
        })
      }
    }
    
    displays.sort((a, b) => b.number - a.number)
  } catch (e) {
    console.error('[Desktop] Failed to list displays:', e.message)
  }
  
  res.json({ ok: true, displays, platform: 'linux' })
})

app.get('/api/desktop/list', authMiddleware, (req, res) => {
  const sessions = []
  for (const [id, session] of desktopSessions) {
    sessions.push({
      id,
      nodeId: session.nodeId,
      nodeName: session.nodeName,
      platform: session.platform,
      status: session.status,
      width: session.width,
      height: session.height,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
    })
  }
  res.json({ ok: true, sessions })
})

// SECURITY: Desktop create requires desktop:access permission
app.post('/api/desktop/create', authMiddleware, requirePermission('desktop:access'), async (req, res) => {
  const { nodeId, width, height, host, port, password, display: inputDisplay } = req.body
  
  const sessionId = randomUUID()
  const platform = process.platform === 'win32' ? 'windows' : 'linux'
  
  const session = {
    id: sessionId,
    nodeId: nodeId || 'local',
    nodeName: nodeId || 'local',
    platform,
    status: 'creating',
    width: width || 1024,
    height: height || 768,
    host: host || 'localhost',
    port: port || 5900,
    password: password || '',
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    clients: new Set(),
    xvfbProcess: null,
    vncProcess: null,
    ffmpegProcess: null,
    display: null,
    frameBuffer: null,
    isExternalDisplay: false,
  }
  
  desktopSessions.set(sessionId, session)
  
  try {
    if (platform === 'linux') {
      if (inputDisplay) {
        console.log(`[Desktop] Using existing display ${inputDisplay} for session ${sessionId}...`)
        session.display = inputDisplay
        session.isExternalDisplay = true
      } else {
        console.log(`[Desktop] Starting Xvfb for session ${sessionId}...`)
        const { display, process: xvfb } = await startXvfbDisplay(session.width, session.height)
        session.display = display
        session.xvfbProcess = xvfb
        console.log(`[Desktop] Xvfb started on display ${display}`)
        
        try {
          console.log(`[Desktop] Starting x11vnc for session ${sessionId}...`)
          const { process: vnc, port: vncPort } = await startX11vnc(display, session.password)
          session.vncProcess = vnc
          session.port = vncPort
          console.log(`[Desktop] x11vnc started on port ${vncPort}`)
        } catch (vncErr) {
          console.log(`[Desktop] x11vnc not available, using screen capture: ${vncErr.message}`)
        }
        
        xvfb.on('exit', (code) => {
          console.log(`[Desktop] Xvfb exited for session ${sessionId} with code ${code}`)
          session.status = 'error'
        })
      }
    }
    
    session.status = 'ready'
    res.json({
      ok: true,
      sessionId,
      message: 'Desktop session created. Connect via SSE stream.',
      width: session.width,
      height: session.height,
      platform: session.platform,
      display: session.display,
      vncPort: session.port,
      isExternalDisplay: session.isExternalDisplay,
    })
  } catch (err) {
    console.error(`[Desktop] Failed to create session ${sessionId}:`, err.message)
    session.status = 'error'
    res.status(500).json({
      ok: false,
      error: { message: `Failed to create desktop session: ${err.message}` },
    })
  }
})

app.get('/api/desktop/stream', authMiddleware, (req, res) => {
  const sessionId = req.query.sessionId
  
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: { message: 'sessionId is required' } })
  }
  
  const session = desktopSessions.get(sessionId)
  if (!session) {
    return res.status(404).json({ ok: false, error: { message: 'Session not found' } })
  }
  
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  
  const sendEvent = (type, data = {}) => {
    const event = { type, sessionId, ...data }
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  
  session.clients.add(res)
  session.status = 'connected'
  session.lastActivityAt = Date.now()
  
  console.log(`[Desktop] Client connected to session ${sessionId}`)
  sendEvent('connected', { width: session.width, height: session.height })
  
  let ffmpegProcess = null
  let frameCount = 0
  let lastFrameTime = Date.now()
  
  if (session.platform === 'linux' && session.display) {
    ffmpegProcess = startFFmpegCapture(session.display, session.width, session.height, 15, 5)
    
    parseMJPEGFrames(ffmpegProcess, (frame) => {
      frameCount++
      const now = Date.now()
      if (now - lastFrameTime >= 100) {
        session.frameBuffer = frame
        sendEvent('frame', { 
          data: frame.toString('base64'),
          width: session.width,
          height: session.height,
          fps: Math.round(frameCount * 1000 / (now - lastFrameTime)),
        })
        frameCount = 0
        lastFrameTime = now
      }
    })
    
    ffmpegProcess.on('error', (err) => {
      console.error(`[Desktop] FFmpeg error for session ${sessionId}:`, err.message)
    })
    
    ffmpegProcess.on('exit', (code) => {
      console.log(`[Desktop] FFmpeg exited for session ${sessionId} with code ${code}`)
    })
  } else if (session.platform === 'windows') {
    const captureFrame = async () => {
      try {
        const frameBuffer = await captureWindowsDesktop()
        if (frameBuffer) {
          session.frameBuffer = frameBuffer
          sendEvent('frame', { 
            data: frameBuffer.toString('base64'),
            width: session.width,
            height: session.height,
          })
        }
      } catch (err) {
        console.error(`[Desktop] Frame capture error for session ${sessionId}:`, err.message)
      }
    }
    
    const frameInterval = setInterval(captureFrame, 100)
    
    req.on('close', () => {
      clearInterval(frameInterval)
      session.clients.delete(res)
      console.log(`[Desktop] Client disconnected from session ${sessionId}`)
      if (session.clients.size === 0) {
        session.status = 'disconnected'
      }
    })
    
    return
  }
  
  req.on('close', () => {
    if (ffmpegProcess) {
      ffmpegProcess.kill()
    }
    session.clients.delete(res)
    console.log(`[Desktop] Client disconnected from session ${sessionId}`)
    if (session.clients.size === 0) {
      session.status = 'disconnected'
    }
  })
})

app.post('/api/desktop/input/mouse', authMiddleware, (req, res) => {
  const { sessionId, x, y, button, buttons, type, wheelDeltaX, wheelDeltaY } = req.body
  
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: { message: 'sessionId is required' } })
  }
  
  const session = desktopSessions.get(sessionId)
  if (!session) {
    return res.status(404).json({ ok: false, error: { message: 'Session not found' } })
  }
  
  session.lastActivityAt = Date.now()
  
  if (session.platform === 'linux' && session.display) {
    try {
      let cmd = ''
      if (type === 'mousemove') {
        cmd = `DISPLAY=${session.display} xdotool mousemove ${x} ${y}`
      } else if (type === 'click') {
        const btn = button === 2 ? 3 : button === 3 ? 2 : button
        cmd = `DISPLAY=${session.display} xdotool mousemove ${x} ${y} click ${btn + 1}`
      } else if (type === 'wheel') {
        const deltaY = wheelDeltaY || 0
        const btn = deltaY > 0 ? 5 : 4
        const clicks = Math.abs(deltaY) > 50 ? 3 : 1
        cmd = `DISPLAY=${session.display} xdotool click --repeat ${clicks} ${btn}`
      }
      
      if (cmd) {
        spawn('sh', ['-c', cmd])
      }
    } catch (e) {
      console.error('[Desktop] Mouse input error:', e.message)
    }
  }
  
  res.json({ ok: true })
})

app.post('/api/desktop/input/keyboard', authMiddleware, (req, res) => {
  const { sessionId, key, code, keyCode, shiftKey, ctrlKey, altKey, metaKey, type } = req.body
  
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: { message: 'sessionId is required' } })
  }
  
  const session = desktopSessions.get(sessionId)
  if (!session) {
    return res.status(404).json({ ok: false, error: { message: 'Session not found' } })
  }
  
  session.lastActivityAt = Date.now()
  
  if (session.platform === 'linux' && session.display) {
    try {
      let keyName = key
      const specialKeys = {
        'Enter': 'Return',
        'Escape': 'Escape',
        'Backspace': 'BackSpace',
        'Tab': 'Tab',
        'ArrowUp': 'Up',
        'ArrowDown': 'Down',
        'ArrowLeft': 'Left',
        'ArrowRight': 'Right',
        'Control': 'Control_L',
        'Shift': 'Shift_L',
        'Alt': 'Alt_L',
        'Meta': 'Super_L',
        ' ': 'space',
      }
      
      if (specialKeys[key]) {
        keyName = specialKeys[key]
      }
      
      const modifiers = []
      if (ctrlKey) modifiers.push('ctrl')
      if (shiftKey) modifiers.push('shift')
      if (altKey) modifiers.push('alt')
      if (metaKey) modifiers.push('super')
      
      let cmd = ''
      if (type === 'keydown') {
        if (modifiers.length > 0) {
          cmd = `DISPLAY=${session.display} xdotool keydown ${modifiers.map(m => m).join(' ')} ${keyName}`
        } else {
          cmd = `DISPLAY=${session.display} xdotool keydown ${keyName}`
        }
      } else if (type === 'keyup') {
        cmd = `DISPLAY=${session.display} xdotool keyup ${keyName}`
      }
      
      if (cmd) {
        spawn('sh', ['-c', cmd])
      }
    } catch (e) {
      console.error('[Desktop] Keyboard input error:', e.message)
    }
  }
  
  res.json({ ok: true })
})

app.post('/api/desktop/input/clipboard', authMiddleware, (req, res) => {
  const { sessionId, text } = req.body
  
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: { message: 'sessionId is required' } })
  }
  
  const session = desktopSessions.get(sessionId)
  if (!session) {
    return res.status(404).json({ ok: false, error: { message: 'Session not found' } })
  }
  
  session.lastActivityAt = Date.now()
  
  res.json({ ok: true })
})

app.post('/api/desktop/resize', authMiddleware, (req, res) => {
  const { sessionId, width, height } = req.body
  
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: { message: 'sessionId is required' } })
  }
  
  const session = desktopSessions.get(sessionId)
  if (!session) {
    return res.status(404).json({ ok: false, error: { message: 'Session not found' } })
  }
  
  session.width = width || session.width
  session.height = height || session.height
  session.lastActivityAt = Date.now()
  
  for (const client of session.clients) {
    try {
      client.write(`data: ${JSON.stringify({ type: 'resized', sessionId, width: session.width, height: session.height })}\n\n`)
    } catch (e) {}
  }
  
  res.json({ ok: true, width: session.width, height: session.height })
})

app.post('/api/desktop/destroy', authMiddleware, (req, res) => {
  const { sessionId } = req.body
  
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: { message: 'sessionId is required' } })
  }
  
  const session = desktopSessions.get(sessionId)
  if (!session) {
    return res.json({ ok: true, message: 'Session already destroyed' })
  }
  
  for (const client of session.clients) {
    try {
      client.write(`data: ${JSON.stringify({ type: 'disconnected', sessionId, message: 'Session destroyed' })}\n\n`)
      client.end()
    } catch (e) {}
  }
  
  if (session.ffmpegProcess) {
    try {
      session.ffmpegProcess.kill()
      console.log(`[Desktop] FFmpeg killed for session ${sessionId}`)
    } catch (e) {}
  }
  
  if (session.vncProcess) {
    try {
      session.vncProcess.kill()
      console.log(`[Desktop] x11vnc killed for session ${sessionId}`)
    } catch (e) {}
  }
  
  if (session.xvfbProcess) {
    try {
      session.xvfbProcess.kill()
      console.log(`[Desktop] Xvfb killed for session ${sessionId}`)
    } catch (e) {}
  }
  
  desktopSessions.delete(sessionId)
  console.log(`[Desktop] Session ${sessionId} destroyed`)
  res.json({ ok: true })
})

app.post('/api/desktop/heartbeat', authMiddleware, (req, res) => {
  const { sessionId } = req.body
  
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: { message: 'sessionId is required' } })
  }
  
  const session = desktopSessions.get(sessionId)
  if (!session) {
    return res.status(404).json({ ok: false, error: { message: 'Session not found' } })
  }
  
  session.lastHeartbeat = Date.now()
  res.json({ ok: true })
})

function keyCodeToX11KeySym(keyCode, key) {
  const keyMap = {
    8: 0xFF08,
    9: 0xFF09,
    13: 0xFF0D,
    16: 0xFFE1,
    17: 0xFFE3,
    18: 0xFFE9,
    19: 0xFF13,
    20: 0xFFE5,
    27: 0xFF1B,
    32: 0x0020,
    33: 0xFF55,
    34: 0xFF56,
    35: 0xFF57,
    36: 0xFF50,
    37: 0xFF51,
    38: 0xFF52,
    39: 0xFF53,
    40: 0xFF54,
    45: 0xFF63,
    46: 0xFFFF,
    91: 0xFFEB,
    92: 0xFF67,
    93: 0xFF67,
    112: 0xFFBE,
    113: 0xFFBF,
    114: 0xFFC0,
    115: 0xFFC1,
    116: 0xFFC2,
    117: 0xFFC3,
    118: 0xFFC4,
    119: 0xFFC5,
    120: 0xFFC6,
    121: 0xFFC7,
    122: 0xFFC8,
    123: 0xFFC9,
    144: 0xFF7F,
    145: 0xFF14,
    186: 0x003B,
    187: 0x003D,
    188: 0x002C,
    189: 0x002D,
    190: 0x002E,
    191: 0x002F,
    192: 0x0060,
    219: 0x005B,
    220: 0x005C,
    221: 0x005D,
    222: 0x0027,
  }
  
  if (keyMap[keyCode]) {
    return keyMap[keyCode]
  }
  
  if (key && key.length === 1) {
    return key.charCodeAt(0)
  }
  
  return keyCode
}

// ============ Wizard API (Scenarios & Tasks) ============

// Scenarios API
app.get('/api/wizard/scenarios', authMiddleware, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM scenarios ORDER BY updated_at DESC').all()
    const scenarios = rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      agentSelectionMode: row.agent_selection_mode,
      selectedAgents: JSON.parse(row.selected_agents || '[]'),
      generatedAgents: JSON.parse(row.generated_agents || '[]'),
      bindings: JSON.parse(row.bindings || '[]'),
      tasks: JSON.parse(row.tasks || '[]'),
      executionLog: JSON.parse(row.execution_log || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
    res.json({ ok: true, scenarios })
  } catch (err) {
    console.error('[Wizard] Get scenarios error:', err)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

app.get('/api/wizard/scenarios/:id', authMiddleware, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(req.params.id)
    if (!row) {
      return res.status(404).json({ ok: false, error: { message: 'Scenario not found' } })
    }
    const scenario = {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      agentSelectionMode: row.agent_selection_mode,
      selectedAgents: JSON.parse(row.selected_agents || '[]'),
      generatedAgents: JSON.parse(row.generated_agents || '[]'),
      bindings: JSON.parse(row.bindings || '[]'),
      tasks: JSON.parse(row.tasks || '[]'),
      executionLog: JSON.parse(row.execution_log || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
    res.json({ ok: true, scenario })
  } catch (err) {
    console.error('[Wizard] Get scenario error:', err)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

app.post('/api/wizard/scenarios', authMiddleware, requirePermission('wizard:manage'), (req, res) => {
  try {
    const id = randomUUID()
    const now = Date.now()
    const { name, description, agentSelectionMode, selectedAgents, generatedAgents, bindings, tasks, status, executionLog } = req.body
    
    db.prepare(`
      INSERT INTO scenarios (id, name, description, status, agent_selection_mode, selected_agents, generated_agents, bindings, tasks, execution_log, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name || '',
      description || '',
      status || 'draft',
      agentSelectionMode || 'existing',
      JSON.stringify(selectedAgents || []),
      JSON.stringify(generatedAgents || []),
      JSON.stringify(bindings || []),
      JSON.stringify(tasks || []),
      JSON.stringify(executionLog || []),
      now,
      now
    )
    
    const scenario = {
      id,
      name: name || '',
      description: description || '',
      status: status || 'draft',
      agentSelectionMode: agentSelectionMode || 'existing',
      selectedAgents: selectedAgents || [],
      generatedAgents: generatedAgents || [],
      bindings: bindings || [],
      tasks: tasks || [],
      executionLog: executionLog || [],
      createdAt: now,
      updatedAt: now,
    }
    
    console.log('[Wizard] Created scenario:', id, name)
    res.json({ ok: true, scenario })
  } catch (err) {
    console.error('[Wizard] Create scenario error:', err)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

app.put('/api/wizard/scenarios/:id', authMiddleware, (req, res) => {
  try {
    const existing = db.prepare('SELECT id FROM scenarios WHERE id = ?').get(req.params.id)
    if (!existing) {
      return res.status(404).json({ ok: false, error: { message: 'Scenario not found' } })
    }
    
    const now = Date.now()
    const { name, description, status, agentSelectionMode, selectedAgents, generatedAgents, bindings, tasks, executionLog } = req.body
    
    db.prepare(`
      UPDATE scenarios 
      SET name = ?, description = ?, status = ?, agent_selection_mode = ?, selected_agents = ?, generated_agents = ?, bindings = ?, tasks = ?, execution_log = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name,
      description,
      status,
      agentSelectionMode,
      JSON.stringify(selectedAgents || []),
      JSON.stringify(generatedAgents || []),
      JSON.stringify(bindings || []),
      JSON.stringify(tasks || []),
      JSON.stringify(executionLog || []),
      now,
      req.params.id
    )
    
    console.log('[Wizard] Updated scenario:', req.params.id)
    res.json({ ok: true, updatedAt: now })
  } catch (err) {
    console.error('[Wizard] Update scenario error:', err)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

app.delete('/api/wizard/scenarios/:id', authMiddleware, (req, res) => {
  try {
    db.prepare('DELETE FROM tasks WHERE scenario_id = ?').run(req.params.id)
    db.prepare('DELETE FROM scenarios WHERE id = ?').run(req.params.id)
    
    console.log('[Wizard] Deleted scenario:', req.params.id)
    res.json({ ok: true })
  } catch (err) {
    console.error('[Wizard] Delete scenario error:', err)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

// Tasks API
app.get('/api/wizard/tasks', authMiddleware, (req, res) => {
  try {
    const scenarioId = req.query.scenarioId
    let rows
    if (scenarioId) {
      rows = db.prepare('SELECT * FROM tasks WHERE scenario_id = ? ORDER BY updated_at DESC').all(scenarioId)
    } else {
      rows = db.prepare('SELECT * FROM tasks ORDER BY updated_at DESC').all()
    }
    
    const tasks = rows.map(row => ({
      id: row.id,
      scenarioId: row.scenario_id,
      title: row.title,
      description: row.description,
      status: row.status,
      assignedAgents: JSON.parse(row.assigned_agents || '[]'),
      priority: row.priority,
      mode: row.mode,
      conversationHistory: JSON.parse(row.conversation_history || '[]'),
      executionHistory: JSON.parse(row.execution_history || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
    res.json({ ok: true, tasks })
  } catch (err) {
    console.error('[Wizard] Get tasks error:', err)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

app.get('/api/wizard/tasks/:id', authMiddleware, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
    if (!row) {
      return res.status(404).json({ ok: false, error: { message: 'Task not found' } })
    }
    const task = {
      id: row.id,
      scenarioId: row.scenario_id,
      title: row.title,
      description: row.description,
      status: row.status,
      assignedAgents: JSON.parse(row.assigned_agents || '[]'),
      priority: row.priority,
      mode: row.mode,
      conversationHistory: JSON.parse(row.conversation_history || '[]'),
      executionHistory: JSON.parse(row.execution_history || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
    res.json({ ok: true, task })
  } catch (err) {
    console.error('[Wizard] Get task error:', err)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

// Import/Export Routes
app.use('/api/import-export', importExportRoutes)

// Monitoring Routes
app.use('/api/monitoring', monitoringRoutes)

app.post('/api/wizard/tasks', authMiddleware, requirePermission('wizard:manage'), (req, res) => {
  try {
    const id = randomUUID()
    const now = Date.now()
    const { scenarioId, title, description, status, assignedAgents, priority, mode, conversationHistory, executionHistory } = req.body
    
    db.prepare(`
      INSERT INTO tasks (id, scenario_id, title, description, status, assigned_agents, priority, mode, conversation_history, execution_history, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      scenarioId || null,
      title || '',
      description || '',
      status || 'pending',
      JSON.stringify(assignedAgents || []),
      priority || 'medium',
      mode || 'default',
      JSON.stringify(conversationHistory || []),
      JSON.stringify(executionHistory || []),
      now,
      now
    )
    
    const task = {
      id,
      scenarioId: scenarioId || null,
      title: title || '',
      description: description || '',
      status: status || 'pending',
      assignedAgents: assignedAgents || [],
      priority: priority || 'medium',
      mode: mode || 'default',
      conversationHistory: conversationHistory || [],
      executionHistory: executionHistory || [],
      createdAt: now,
      updatedAt: now,
    }
    
    console.log('[Wizard] Created task:', id, title)
    res.json({ ok: true, task })
  } catch (err) {
    console.error('[Wizard] Create task error:', err)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

app.put('/api/wizard/tasks/:id', authMiddleware, (req, res) => {
  try {
    const existing = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.id)
    if (!existing) {
      return res.status(404).json({ ok: false, error: { message: 'Task not found' } })
    }
    
    const now = Date.now()
    const { scenarioId, title, description, status, assignedAgents, priority, mode, conversationHistory, executionHistory } = req.body
    
    db.prepare(`
      UPDATE tasks 
      SET scenario_id = ?, title = ?, description = ?, status = ?, assigned_agents = ?, priority = ?, mode = ?, conversation_history = ?, execution_history = ?, updated_at = ?
      WHERE id = ?
    `).run(
      scenarioId,
      title,
      description,
      status,
      JSON.stringify(assignedAgents || []),
      priority,
      mode,
      JSON.stringify(conversationHistory || []),
      JSON.stringify(executionHistory || []),
      now,
      req.params.id
    )
    
    console.log('[Wizard] Updated task:', req.params.id)
    res.json({ ok: true, updatedAt: now })
  } catch (err) {
    console.error('[Wizard] Update task error:', err)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

app.delete('/api/wizard/tasks/:id', authMiddleware, (req, res) => {
  try {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id)
    
    console.log('[Wizard] Deleted task:', req.params.id)
    res.json({ ok: true })
  } catch (err) {
    console.error('[Wizard] Delete task error:', err)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

// Media API endpoint
app.get('/api/media', (req, res) => {
  try {
    const path = req.query.path
    if (!path) {
      return res.status(400).json({ ok: false, error: { message: 'Path parameter is required' } })
    }
    
    console.log('[Media] Request path:', path)
    
    // SECURITY: Prevent directory traversal + null byte injection
    const safePath = path.replace(/\.\./g, '').replace(/[;\0\n\r]/g, '')
    const resolvedPath = resolve(mediaDir, safePath)
    // Ensure resolved path stays within mediaDir
    const resolvedMediaDir = resolve(mediaDir)
    if (!resolvedPath.startsWith(resolvedMediaDir + sep)) {
      console.warn("[Media] Path traversal attempt:", { mediaDir, safePath, resolvedPath })
      return res.status(403).json({ ok: false, error: { message: 'Access denied' } })
    }
    console.log('[Media] Safe path:', safePath)
    
    // 支持多个可能的媒体目录，按优先级搜索
    const possibleMediaDirs = []
    
    // 1. .env 文件中的 MEDIA_DIR（最高优先级）
    if (envConfig.MEDIA_DIR) {
      possibleMediaDirs.push(envConfig.MEDIA_DIR)
    }
    
    // 2. 系统环境变量 MEDIA_DIR
    if (process.env.MEDIA_DIR) {
      possibleMediaDirs.push(process.env.MEDIA_DIR)
    }
    
    // 3. OPENCLAW_HOME 推导的媒体目录
    const openclawHome = process.env.OPENCLAW_HOME
    if (openclawHome) {
      possibleMediaDirs.push(join(openclawHome, '.openclaw', 'media'))
    }
    
    // 4. 当前用户主目录
    possibleMediaDirs.push(join(os.homedir(), '.openclaw', 'media'))
    
    // 5. 常见的其他用户目录（适用于 root 运行但文件在 ubuntu 用户目录的情况）
    if (process.platform !== 'win32') {
      possibleMediaDirs.push('/home/ubuntu/.openclaw/media')
      possibleMediaDirs.push('/home/user/.openclaw/media')
    }
    
    // 去重
    const uniqueMediaDirs = [...new Set(possibleMediaDirs)]
    console.log('[Media] Searching in dirs:', uniqueMediaDirs)
    
    let foundFile = null
    let usedMediaDir = null
    
    for (const mediaDir of uniqueMediaDirs) {
      const fullPath = resolve(mediaDir, safePath)
      
      // 安全检查：确保路径在媒体目录内
      if (!fullPath.startsWith(mediaDir)) {
        continue
      }
      
      if (existsSync(fullPath)) {
        const stats = statSync(fullPath)
        if (stats.isFile()) {
          foundFile = fullPath
          usedMediaDir = mediaDir
          break
        }
      }
    }
    
    if (!foundFile) {
      console.log('[Media] File not found in any media dir:', safePath)
      return res.status(404).json({ ok: false, error: { message: 'File not found' } })
    }
    
    console.log('[Media] File found:', foundFile, '| Media dir:', usedMediaDir)
    
    const stats = statSync(foundFile)
    if (!stats.isFile()) {
      return res.status(400).json({ ok: false, error: { message: 'Not a file' } })
    }
    
    // Set appropriate content type based on file extension
    const ext = extname(foundFile).toLowerCase()
    const contentTypeMap = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml'
    }
    
    const contentType = contentTypeMap[ext] || 'application/octet-stream'
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', stats.size)
    
    // Stream the file
    const stream = createReadStream(foundFile)
    stream.pipe(res)
    
    stream.on('error', (err) => {
      console.error('[Media] Error streaming file:', err.message)
      res.status(500).json({ ok: false, error: { message: 'Internal server error' } })
    })
  } catch (err) {
    console.error('[Media] Error:', err.message)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

// ============================================================
// Backup & Restore API
// ============================================================

import { createGzip, createGunzip } from 'zlib'
import { pipeline, Readable } from 'stream'
import { pipeline as pipelinePromises } from 'stream/promises'
import { createHash } from 'crypto'
import archiver from 'archiver'
import unzipper from 'unzipper'
import AdmZip from 'adm-zip'

const BACKUP_DIR = join(__dirname, '../backups')
const DATA_DIR = join(__dirname, '../data')
const PROJECT_ROOT = join(__dirname, '..')
const WIZARD_DB_PATH = join(DATA_DIR, 'wizard.db')
const ENV_PATH = join(PROJECT_ROOT, '.env')

const backupTasks = new Map()

function ensureBackupDir() {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true })
  }
}

function generateTaskId() {
  return `backup-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function broadcastBackupProgress(taskId, progress) {
  broadcastSSE({
    type: 'backupProgress',
    taskId,
    ...progress
  })
}

async function executeOpenClawBackup(outputPath) {
  return new Promise((resolve, reject) => {
    const openclawHome = process.env.OPENCLAW_HOME
    
    let command, args, spawnOptions
    
    if (openclawHome && process.platform !== 'win32') {
      const username = openclawHome.split('/').pop()
      console.log(`[Backup] Running as user '${username}' with full environment`)
      
      command = 'su'
      args = ['-', username, '-c', `openclaw backup create --output ${outputPath}`]
      spawnOptions = { stdio: ['ignore', 'pipe', 'pipe'] }
    } else {
      command = 'openclaw'
      args = ['backup', 'create', '--output', outputPath]
      spawnOptions = {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        env: openclawHome 
          ? { ...process.env, HOME: openclawHome }
          : process.env
      }
      if (openclawHome) {
        console.log(`[Backup] Using OPENCLAW_HOME: ${openclawHome}`)
      }
    }
    
    const proc = spawn(command, args, spawnOptions)

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, stdout, stderr })
      } else {
        reject(new Error(`OpenClaw backup failed with code ${code}: ${stderr || stdout}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to execute openclaw backup: ${err.message}`))
    })
  })
}

async function extractOpenClawBackup(backupPath, tempDir) {
  return new Promise((resolve, reject) => {
    const homeDir = process.env.OPENCLAW_HOME || os.homedir()
    const openclawDir = join(homeDir, '.openclaw')
    console.log('[Restore] Target OpenClaw directory:', openclawDir)

    if (!existsSync(backupPath)) {
      return reject(new Error(`OpenClaw backup file not found: ${backupPath}`))
    }

    const stat = statSync(backupPath)
    if (stat.size === 0) {
      return reject(new Error('OpenClaw backup file is empty'))
    }

    console.log('[Restore] Extracting OpenClaw backup:', backupPath, 'size:', stat.size)

    const proc = spawn('tar', ['-xzf', backupPath, '-C', tempDir, '--ignore-zeros'], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let timeout = null

    const timeoutMs = Math.max(300000, Math.ceil(stat.size / 1024 / 1024) * 1000)
    console.log('[Restore] Setting timeout to', timeoutMs / 1000, 'seconds for', Math.ceil(stat.size / 1024 / 1024), 'MB file')

    timeout = setTimeout(() => {
      proc.kill()
      reject(new Error('OpenClaw backup extraction timed out'))
    }, timeoutMs)

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', async (code) => {
      clearTimeout(timeout)
      try {
        if (code !== 0 && stderr.includes('unexpected end of file')) {
          return reject(new Error('OpenClaw backup file is corrupted or incomplete'))
        }

        const items = readdirSync(tempDir, { withFileTypes: true })
        const backupRoot = items.find(item => item.isDirectory() && item.name.includes('openclaw-backup'))

        if (!backupRoot) {
          if (code !== 0 && stderr) {
            console.warn('[Restore] tar warnings:', stderr)
          }
          return reject(new Error('Invalid OpenClaw backup: no backup root directory found'))
        }

        const payloadPath = join(tempDir, backupRoot.name, 'payload')
        if (!existsSync(payloadPath)) {
          return reject(new Error('Invalid OpenClaw backup: no payload directory found'))
        }

        function findOpenClawDir(dir) {
          try {
            const items = readdirSync(dir, { withFileTypes: true })
            for (const item of items) {
              if (item.isDirectory()) {
                if (item.name === '.openclaw') {
                  return join(dir, item.name)
                }
                const found = findOpenClawDir(join(dir, item.name))
                if (found) return found
              }
            }
          } catch (e) {
            console.warn('[Restore] Error reading directory:', dir, e.message)
          }
          return null
        }

        const extractedOpenClawDir = findOpenClawDir(payloadPath)
        if (!extractedOpenClawDir) {
          return reject(new Error('Invalid OpenClaw backup: .openclaw directory not found in payload'))
        }

        function copyDirSync(src, dest, overwrite = false) {
          if (!existsSync(dest)) {
            mkdirSync(dest, { recursive: true })
          }
          const entries = readdirSync(src, { withFileTypes: true })
          for (const entry of entries) {
            const srcPath = join(src, entry.name)
            const destPath = join(dest, entry.name)
            try {
              if (entry.isDirectory()) {
                copyDirSync(srcPath, destPath, overwrite)
              } else if (entry.isSymbolicLink()) {
                if (overwrite) {
                  try { unlinkSync(destPath) } catch (e) { }
                } else if (existsSync(destPath)) {
                  continue
                }
                const linkTarget = readlinkSync(srcPath)
                symlinkSync(linkTarget, destPath)
              } else {
                if (existsSync(destPath)) {
                  if (overwrite) {
                    try {
                      unlinkSync(destPath)
                      copyFileSync(srcPath, destPath)
                    } catch (e) {
                      console.warn('[Restore] Could not overwrite (file may be locked):', destPath)
                    }
                  }
                } else {
                  copyFileSync(srcPath, destPath)
                }
              }
            } catch (e) {
              console.warn('[Restore] Error copying:', srcPath, e.message)
            }
          }
        }

        copyDirSync(extractedOpenClawDir, openclawDir, true)

        console.log('[Restore] OpenClaw backup restored to:', openclawDir)
        resolve({ success: true, stdout, stderr, warnings: code !== 0 ? stderr : null })
      } catch (err) {
        reject(new Error(`Failed to move extracted files: ${err.message}`))
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      reject(new Error(`Failed to extract OpenClaw backup: ${err.message}`))
    })
  })
}

async function createZipArchive(outputPath, files) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath)
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', () => {
      const size = archive.pointer()
      console.log('[Backup] ZIP archive created:', outputPath, 'size:', size)
      resolve({ size })
    })

    output.on('error', (err) => {
      console.error('[Backup] ZIP output error:', err.message)
      reject(err)
    })

    archive.on('error', (err) => {
      console.error('[Backup] ZIP archive error:', err.message)
      reject(err)
    })

    archive.on('warning', (err) => {
      console.warn('[Backup] ZIP archive warning:', err.message)
    })

    archive.pipe(output)

    let addedFiles = 0
    let totalSize = 0
    for (const file of files) {
      if (existsSync(file.path)) {
        const stat = statSync(file.path)
        console.log('[Backup] Adding to ZIP:', file.name, 'size:', stat.size)
        archive.file(file.path, { name: file.name })
        addedFiles++
        totalSize += stat.size
      } else {
        console.warn('[Backup] File not found, skipping:', file.path)
      }
    }

    console.log('[Backup] ZIP contains', addedFiles, 'files, total size:', totalSize)
    archive.finalize()
  })
}

async function extractZipArchive(zipPath, targetDir) {
  return new Promise((resolve, reject) => {
    try {
      if (!existsSync(zipPath)) {
        return reject(new Error(`ZIP file not found: ${zipPath}`))
      }

      const stat = statSync(zipPath)
      if (stat.size === 0) {
        return reject(new Error('ZIP file is empty'))
      }

      console.log('[Restore] Extracting ZIP:', zipPath, 'size:', stat.size)

      const zip = new AdmZip(zipPath)
      const zipEntries = zip.getEntries()

      console.log('[Restore] ZIP contains', zipEntries.length, 'entries')

      zip.extractAllTo(targetDir, true)

      console.log('[Restore] ZIP extraction completed to:', targetDir)
      resolve()
    } catch (err) {
      console.error('[Restore] ZIP extraction failed:', err.message)
      reject(new Error(`Failed to extract ZIP: ${err.message}`))
    }
  })
}

async function executeBackupTask(taskId, params = {}) {
  const task = backupTasks.get(taskId)
  if (!task) return

  createBackupRecord(taskId, 'create')
  const tempDir = join(os.tmpdir(), `.openclaw_backup_${taskId}`)

  try {
    task.status = 'running'
    task.progress = 0
    task.message = 'Starting backup...'
    broadcastBackupProgress(taskId, { status: 'running', progress: 0, message: task.message })
    updateBackupRecord(taskId, { status: 'running', progress: 0, message: task.message })

    ensureBackupDir()

    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true })
    }

    const timestamp = new Date().toISOString()
      .replace(/T/, '_')
      .replace(/:/g, '-')
      .replace(/\..+/, '')

    const backupFilename = `backup_${timestamp}.zip`
    const backupPath = join(BACKUP_DIR, backupFilename)

    task.message = 'Creating OpenClaw backup...'
    task.progress = 10
    broadcastBackupProgress(taskId, { status: 'running', progress: 10, message: task.message, stage: 'openclaw_backup' })
    updateBackupRecord(taskId, { status: 'running', progress: 10, message: task.message, stage: 'openclaw_backup' })

    const openclawBackupPath = join(os.tmpdir(), `openclaw_backup_${taskId}.tar.gz`)
    const openclawFinalPath = join(tempDir, 'openclaw_backup.tar.gz')
    try {
      await executeOpenClawBackup(openclawBackupPath)
      console.log('[Backup] OpenClaw backup created')
      
      if (existsSync(openclawBackupPath)) {
        copyFileSync(openclawBackupPath, openclawFinalPath)
        unlinkSync(openclawBackupPath)
      }
    } catch (err) {
      console.warn('[Backup] OpenClaw backup skipped:', err.message)
      if (existsSync(openclawBackupPath)) {
        try { unlinkSync(openclawBackupPath) } catch (e) {}
      }
    }

    task.message = 'Backing up project database...'
    task.progress = 30
    broadcastBackupProgress(taskId, { status: 'running', progress: 30, message: task.message, stage: 'project_database' })
    updateBackupRecord(taskId, { status: 'running', progress: 30, message: task.message, stage: 'project_database' })

    const filesToArchive = []

    if (existsSync(openclawFinalPath)) {
      filesToArchive.push({ path: openclawFinalPath, name: 'openclaw_backup.tar.gz' })
      console.log('[Backup] OpenClaw backup added')
    }

    if (existsSync(WIZARD_DB_PATH)) {
      filesToArchive.push({ path: WIZARD_DB_PATH, name: 'data/wizard.db' })
      console.log('[Backup] Wizard database added')
    }

    task.message = 'Backing up environment config...'
    task.progress = 50
    broadcastBackupProgress(taskId, { status: 'running', progress: 50, message: task.message, stage: 'env_config' })
    updateBackupRecord(taskId, { status: 'running', progress: 50, message: task.message, stage: 'env_config' })

    if (existsSync(ENV_PATH)) {
      const tempEnvPath = join(tempDir, '.env')
      copyFileSync(ENV_PATH, tempEnvPath)
      filesToArchive.push({ path: tempEnvPath, name: '.env' })
      console.log('[Backup] Environment config added')
    }

    const manifest = {
      version: '3.0',
      createdAt: new Date().toISOString(),
      platform: process.platform,
      nodeVersion: process.version,
      source: 'openclaw-admin',
      components: {
        openclaw: existsSync(openclawBackupPath),
        wizardDb: existsSync(WIZARD_DB_PATH),
        env: existsSync(ENV_PATH)
      }
    }
    const manifestPath = join(tempDir, 'manifest.json')
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    filesToArchive.push({ path: manifestPath, name: 'manifest.json' })

    task.message = 'Creating archive...'
    task.progress = 70
    broadcastBackupProgress(taskId, { status: 'running', progress: 70, message: task.message, stage: 'archiving' })
    updateBackupRecord(taskId, { status: 'running', progress: 70, message: task.message, stage: 'archiving' })

    const archiveResult = await createZipArchive(backupPath, filesToArchive)

    task.message = 'Cleaning up...'
    task.progress = 90
    broadcastBackupProgress(taskId, { status: 'running', progress: 90, message: task.message, stage: 'cleanup' })
    updateBackupRecord(taskId, { status: 'running', progress: 90, message: task.message, stage: 'cleanup' })

    rmSync(tempDir, { recursive: true, force: true })

    task.status = 'completed'
    task.progress = 100
    task.message = 'Backup completed successfully'
    task.completedAt = Date.now()
    task.result = {
      filename: backupFilename,
      size: archiveResult.size
    }

    updateBackupRecord(taskId, {
      status: 'completed',
      progress: 100,
      message: task.message,
      filename: backupFilename,
      size: archiveResult.size,
      completedAt: task.completedAt,
      result: task.result
    })

    broadcastBackupProgress(taskId, {
      status: 'completed',
      progress: 100,
      message: task.message,
      result: task.result
    })

    console.log(`[Backup] Created: ${backupFilename}`)
  } catch (err) {
    console.error('[Backup] Create error:', err.message)
    task.status = 'failed'
    task.error = err.message
    task.message = `Backup failed: ${err.message}`
    task.completedAt = Date.now()

    updateBackupRecord(taskId, {
      status: 'failed',
      error: err.message,
      message: task.message,
      completedAt: task.completedAt
    })

    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }

    broadcastBackupProgress(taskId, {
      status: 'failed',
      progress: task.progress,
      message: task.message,
      error: err.message
    })
  }
}

async function executeRestoreTask(taskId, filename) {
  const task = backupTasks.get(taskId)
  if (!task) return

  const tempDir = join(os.tmpdir(), `.openclaw_restore_${taskId}`)

  try {
    task.status = 'running'
    task.progress = 0
    task.message = 'Starting restore...'
    broadcastBackupProgress(taskId, { status: 'running', progress: 0, message: task.message })
    updateBackupRecord(taskId, { status: 'running', progress: 0, message: task.message })

    const safeName = basename(filename)
    if (safeName !== filename || (!filename.endsWith('.zip') && !filename.endsWith('.json.gz'))) {
      throw new Error('Invalid filename. Expected .zip or .json.gz file.')
    }

    const backupPath = join(BACKUP_DIR, safeName)
    if (!existsSync(backupPath)) {
      throw new Error('Backup not found')
    }

    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true })
    }

    let manifest = { version: '1.0' }
    let backupData = null

    if (filename.endsWith('.zip')) {
      task.message = 'Extracting backup archive...'
      task.progress = 10
      broadcastBackupProgress(taskId, { status: 'running', progress: 10, message: task.message, stage: 'extracting' })

      await extractZipArchive(backupPath, tempDir)

      const manifestPath = join(tempDir, 'manifest.json')
      if (existsSync(manifestPath)) {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      }
      console.log('[Restore] Manifest:', manifest)
    } else if (filename.endsWith('.json.gz')) {
      task.message = 'Reading legacy backup file...'
      task.progress = 10
      broadcastBackupProgress(taskId, { status: 'running', progress: 10, message: task.message, stage: 'reading' })

      const gzip = createGunzip()
      const readStream = createReadStream(backupPath)
      const chunks = []

      await pipelinePromises(
        readStream,
        gzip,
        async function* (source) {
          for await (const chunk of source) {
            chunks.push(chunk)
            yield chunk
          }
        }
      )

      const jsonContent = Buffer.concat(chunks).toString('utf-8')
      backupData = JSON.parse(jsonContent)
      manifest = { version: backupData.version || '1.0', legacy: true }
      console.log('[Restore] Legacy backup version:', manifest.version)

      if (backupData.data) {
        if (backupData.data.wizardDatabase) {
          const wizardDbDir = join(tempDir, 'data')
          mkdirSync(wizardDbDir, { recursive: true })
          const wizardDbContent = Buffer.from(backupData.data.wizardDatabase.content, 'base64')
          writeFileSync(join(wizardDbDir, 'wizard.db'), wizardDbContent)
        }
        if (backupData.data.envConfig) {
          writeFileSync(join(tempDir, '.env'), backupData.data.envConfig)
        }
      }
    }

    const results = {
      wizardDb: false,
      env: false,
      openclaw: false,
      errors: []
    }

    task.message = 'Restoring OpenClaw data...'
    task.progress = 30
    broadcastBackupProgress(taskId, { status: 'running', progress: 30, message: task.message, stage: 'openclaw_restore' })
    updateBackupRecord(taskId, { status: 'running', progress: 30, message: task.message, stage: 'openclaw_restore' })

    const extractedOpenClawBackup = join(tempDir, 'openclaw_backup.tar.gz')
    if (existsSync(extractedOpenClawBackup)) {
      try {
        const openclawTempDir = join(os.tmpdir(), `.openclaw_extract_${taskId}`)
        mkdirSync(openclawTempDir, { recursive: true })
        await extractOpenClawBackup(extractedOpenClawBackup, openclawTempDir)
        rmSync(openclawTempDir, { recursive: true, force: true })
        results.openclaw = true
        console.log('[Restore] OpenClaw data restored')
      } catch (e) {
        results.errors.push(`OpenClaw restore failed: ${e.message}`)
        console.warn('[Restore] OpenClaw restore error:', e.message)
      }
    }

    task.message = 'Restoring project database...'
    task.progress = 50
    broadcastBackupProgress(taskId, { status: 'running', progress: 50, message: task.message, stage: 'project_database' })
    updateBackupRecord(taskId, { status: 'running', progress: 50, message: task.message, stage: 'project_database' })

    let backupDbPath = null
    const extractedWizardDb = join(tempDir, 'data', 'wizard.db')
    if (existsSync(extractedWizardDb)) {
      try {
        if (existsSync(WIZARD_DB_PATH)) {
          backupDbPath = `${WIZARD_DB_PATH}.bak-${Date.now()}`
          writeFileSync(backupDbPath, readFileSync(WIZARD_DB_PATH))
        }
        writeFileSync(WIZARD_DB_PATH, readFileSync(extractedWizardDb))
        results.wizardDb = true
        console.log('[Restore] Wizard database restored')
      } catch (e) {
        results.errors.push(`Wizard DB restore failed: ${e.message}`)
      }
    }

    let backupEnvPath = null
    task.message = 'Restoring environment config...'
    task.progress = 70
    broadcastBackupProgress(taskId, { status: 'running', progress: 70, message: task.message, stage: 'env_config' })
    updateBackupRecord(taskId, { status: 'running', progress: 70, message: task.message, stage: 'env_config' })

    const extractedEnv = join(tempDir, '.env')
    if (existsSync(extractedEnv)) {
      try {
        if (existsSync(ENV_PATH)) {
          backupEnvPath = `${ENV_PATH}.bak-${Date.now()}`
          copyFileSync(ENV_PATH, backupEnvPath)
        }
        copyFileSync(extractedEnv, ENV_PATH)
        results.env = true
        console.log('[Restore] Environment config restored')
      } catch (e) {
        results.errors.push(`Env restore failed: ${e.message}`)
      }
    }

    task.message = 'Cleaning up...'
    task.progress = 90
    broadcastBackupProgress(taskId, { status: 'running', progress: 90, message: task.message, stage: 'cleanup' })

    rmSync(tempDir, { recursive: true, force: true })

    if (backupDbPath && existsSync(backupDbPath)) {
      try {
        unlinkSync(backupDbPath)
        console.log('[Restore] Cleaned up database backup file')
      } catch (e) {
        console.warn('[Restore] Failed to cleanup database backup file:', e.message)
      }
    }
    if (backupEnvPath && existsSync(backupEnvPath)) {
      try {
        unlinkSync(backupEnvPath)
        console.log('[Restore] Cleaned up env backup file')
      } catch (e) {
        console.warn('[Restore] Failed to cleanup env backup file:', e.message)
      }
    }

    task.status = 'completed'
    task.progress = 100
    task.message = 'Restore completed successfully'
    task.completedAt = Date.now()
    task.result = results

    broadcastBackupProgress(taskId, {
      status: 'completed',
      progress: 100,
      message: task.message,
      result: results
    })

    console.log(`[Restore] Completed: ${safeName}`)
  } catch (err) {
    console.error('[Restore] Error:', err.message)
    task.status = 'failed'
    task.error = err.message
    task.message = `Restore failed: ${err.message}`
    task.completedAt = Date.now()

    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }

    broadcastBackupProgress(taskId, {
      status: 'failed',
      progress: task.progress,
      message: task.message,
      error: err.message
    })
  }
}

app.get('/api/backup/list', authMiddleware, (req, res) => {
  try {
    ensureBackupDir()
    const files = readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.zip') || f.endsWith('.json.gz'))
      .map(f => {
        const filePath = join(BACKUP_DIR, f)
        const stats = statSync(filePath)
        const zipMatch = f.match(/backup_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})\.zip/)
        const gzMatch = f.match(/backup_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})\.json\.gz/)
        const uploadedZipMatch = f.match(/uploaded_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})\.zip/)
        const uploadedGzMatch = f.match(/uploaded_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})\.json\.gz/)
        const match = zipMatch || gzMatch || uploadedZipMatch || uploadedGzMatch
        return {
          filename: f,
          createdAt: stats.birthtime,
          size: stats.size,
          date: match ? `${match[1]} ${match[2].replace(/-/g, ':')}` : f,
          format: f.endsWith('.zip') ? 'zip' : 'json.gz'
        }
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    res.json({ ok: true, backups: files })
  } catch (err) {
    console.error('[Backup] List error:', err.message)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

app.get('/api/backup/tasks', authMiddleware, (req, res) => {
  try {
    const dbTasks = getBackupRecords(20)
    const tasks = dbTasks.map(t => ({
      id: t.id,
      type: t.type,
      status: t.status,
      progress: t.progress,
      message: t.message,
      filename: t.filename,
      error: t.error,
      startedAt: t.created_at,
      completedAt: t.completed_at,
      result: t.filename ? { filename: t.filename } : null
    }))
    res.json({ ok: true, tasks })
  } catch (err) {
    console.error('[Backup] Failed to get tasks:', err.message)
    res.json({ ok: true, tasks: [] })
  }
})

app.get('/api/backup/tasks/:taskId', authMiddleware, (req, res) => {
  const task = backupTasks.get(req.params.taskId)
  if (!task) {
    return res.status(404).json({ ok: false, error: { message: 'Task not found' } })
  }
  res.json({
    ok: true,
    task: {
      id: task.id,
      type: task.type,
      status: task.status,
      progress: task.progress,
      message: task.message,
      filename: task.filename,
      error: task.error,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      result: task.result
    }
  })
})

// SECURITY: Backup task cleanup requires backup:manage permission
app.delete('/api/backup/tasks/completed', authMiddleware, requirePermission('backup:manage'), (req, res) => {
  try {
    const result = db.prepare('DELETE FROM backup_records WHERE status IN (?, ?)').run('completed', 'failed')
    console.log(`[Backup] Cleared ${result.changes} completed/failed tasks`)
    res.json({ ok: true, deleted: result.changes })
  } catch (err) {
    console.error('[Backup] Failed to clear completed tasks:', err.message)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

// SECURITY: Backup create requires backup:manage permission
app.post('/api/backup/create', authMiddleware, requirePermission('backup:manage'), async (req, res) => {
  try {
    const taskId = generateTaskId()
    const task = {
      id: taskId,
      type: 'create',
      status: 'pending',
      progress: 0,
      message: 'Backup task created',
      startedAt: Date.now(),
      params: req.body || {}
    }
    backupTasks.set(taskId, task)

    res.json({
      ok: true,
      taskId,
      message: 'Backup task created'
    })

    setImmediate(() => executeBackupTask(taskId, req.body))
  } catch (err) {
    console.error('[Backup] Create error:', err.message)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

// 下载备份
app.get('/api/backup/download', authMiddleware, (req, res) => {
  try {
    const filename = req.query.filename
    if (!filename) {
      return res.status(400).json({ ok: false, error: { message: 'Filename is required' } })
    }
    
    // 安全检查：防止路径遍历
    const safeName = basename(filename)
    if (safeName !== filename || (!filename.endsWith('.zip') && !filename.endsWith('.json.gz'))) {
      return res.status(400).json({ ok: false, error: { message: 'Invalid filename. Expected .zip or .json.gz file.' } })
    }
    
    const backupPath = join(BACKUP_DIR, safeName)
    if (!existsSync(backupPath)) {
      return res.status(404).json({ ok: false, error: { message: 'Backup not found' } })
    }
    
    const contentType = filename.endsWith('.zip') ? 'application/zip' : 'application/gzip'
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`)
    
    const stream = createReadStream(backupPath)
    stream.pipe(res)
  } catch (err) {
    console.error('[Backup] Download error:', err.message)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

// 恢复备份
// SECURITY: Backup restore requires backup:manage permission
app.post('/api/backup/restore', authMiddleware, requirePermission('backup:manage'), async (req, res) => {
  try {
    const { filename } = req.body
    if (!filename) {
      return res.status(400).json({ ok: false, error: { message: 'Filename is required' } })
    }

    const safeName = basename(filename)
    if (safeName !== filename || (!filename.endsWith('.zip') && !filename.endsWith('.json.gz'))) {
      return res.status(400).json({ ok: false, error: { message: 'Invalid filename. Expected .zip or .json.gz file.' } })
    }

    const backupPath = join(BACKUP_DIR, safeName)
    if (!existsSync(backupPath)) {
      return res.status(404).json({ ok: false, error: { message: 'Backup not found' } })
    }

    const taskId = generateTaskId()
    const task = {
      id: taskId,
      type: 'restore',
      status: 'pending',
      progress: 0,
      message: 'Restore task created',
      filename: safeName,
      startedAt: Date.now()
    }
    backupTasks.set(taskId, task)

    res.json({
      ok: true,
      taskId,
      message: 'Restore task created'
    })

    setImmediate(() => executeRestoreTask(taskId, filename))
  } catch (err) {
    console.error('[Restore] Error:', err.message)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

// 删除备份
// SECURITY: Backup delete requires backup:manage permission
app.delete('/api/backup/delete', authMiddleware, requirePermission('backup:manage'), (req, res) => {
  try {
    const filename = req.query.filename
    if (!filename) {
      return res.status(400).json({ ok: false, error: { message: 'Filename is required' } })
    }

    const safeName = basename(filename)
    if (safeName !== filename || (!filename.endsWith('.zip') && !filename.endsWith('.json.gz'))) {
      return res.status(400).json({ ok: false, error: { message: 'Invalid filename. Expected .zip or .json.gz file.' } })
    }

    const backupPath = join(BACKUP_DIR, safeName)
    if (!existsSync(backupPath)) {
      return res.status(404).json({ ok: false, error: { message: 'Backup not found' } })
    }

    unlinkSync(backupPath)
    res.json({ ok: true, message: 'Backup deleted' })
    console.log(`[Backup] Deleted: ${safeName}`)
  } catch (err) {
    console.error('[Backup] Delete error:', err.message)
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

// 上传并恢复备份
const backupUpload = multer({ 
  dest: join(os.tmpdir(), 'openclaw-backup-uploads'),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB 限制
})

// SECURITY: Backup upload requires backup:manage permission
app.post('/api/backup/upload', authMiddleware, requirePermission('backup:manage'), backupUpload.single('backup'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: { message: 'No backup file uploaded' } })
    }

    const tempPath = req.file.path

    const taskId = generateTaskId()
    const task = {
      id: taskId,
      type: 'upload',
      status: 'pending',
      progress: 0,
      message: 'Upload task created',
      filename: req.file.originalname,
      startedAt: Date.now(),
      tempPath
    }
    backupTasks.set(taskId, task)

    res.json({
      ok: true,
      taskId,
      message: 'Upload task created'
    })

    setImmediate(async () => {
      try {
        task.status = 'running'
        task.message = 'Validating uploaded file...'
        task.progress = 10
        broadcastBackupProgress(taskId, { status: 'running', progress: 10, message: task.message })

        const isZip = req.file.originalname.endsWith('.zip')
        const isGz = req.file.originalname.endsWith('.json.gz')

        if (!isZip && !isGz) {
          throw new Error('Invalid backup file format. Expected .zip or .json.gz file.')
        }

        ensureBackupDir()
        const timestamp = new Date().toISOString()
          .replace(/T/, '_')
          .replace(/:/g, '-')
          .replace(/\..+/, '')

        if (isZip) {
          const tempExtractDir = join(os.tmpdir(), `backup_extract_${taskId}`)
          mkdirSync(tempExtractDir, { recursive: true })

          await extractZipArchive(tempPath, tempExtractDir)

          const manifestPath = join(tempExtractDir, 'manifest.json')
          if (!existsSync(manifestPath)) {
            rmSync(tempExtractDir, { recursive: true, force: true })
            throw new Error('Invalid backup file: missing manifest.json')
          }

          task.message = 'Saving backup...'
          task.progress = 50
          broadcastBackupProgress(taskId, { status: 'running', progress: 50, message: task.message })

          const newFilename = `uploaded_${timestamp}.zip`
          const newPath = join(BACKUP_DIR, newFilename)

          const filesToArchive = []
          const items = readdirSync(tempExtractDir, { recursive: true, withFileTypes: true })
          for (const item of items) {
            if (item.isFile()) {
              const relativePath = item.path.replace(tempExtractDir, '').replace(/^[/\\]/, '')
              const itemName = relativePath ? `${relativePath}/${item.name}` : item.name
              filesToArchive.push({ path: join(item.path, item.name), name: itemName })
            }
          }

          const archiveResult = await createZipArchive(newPath, filesToArchive)

          rmSync(tempExtractDir, { recursive: true, force: true })
          unlinkSync(tempPath)

          task.status = 'completed'
          task.progress = 100
          task.message = 'Backup uploaded successfully'
          task.completedAt = Date.now()
          task.result = {
            filename: newFilename,
            size: archiveResult.size
          }

          broadcastBackupProgress(taskId, {
            status: 'completed',
            progress: 100,
            message: task.message,
            result: task.result
          })

          console.log(`[Backup] Uploaded and saved: ${newFilename}`)
        } else if (isGz) {
          task.message = 'Validating legacy backup...'
          task.progress = 30
          broadcastBackupProgress(taskId, { status: 'running', progress: 30, message: task.message })

          const gzip = createGunzip()
          const readStream = createReadStream(tempPath)
          const chunks = []

          await pipelinePromises(
            readStream,
            gzip,
            async function* (source) {
              for await (const chunk of source) {
                chunks.push(chunk)
                yield chunk
              }
            }
          )

          const jsonContent = Buffer.concat(chunks).toString('utf-8')
          const backupData = JSON.parse(jsonContent)

          if (!backupData.version || !backupData.data) {
            unlinkSync(tempPath)
            throw new Error('Invalid legacy backup file format')
          }

          task.message = 'Saving backup...'
          task.progress = 50
          broadcastBackupProgress(taskId, { status: 'running', progress: 50, message: task.message })

          const newFilename = `uploaded_${timestamp}.json.gz`
          const newPath = join(BACKUP_DIR, newFilename)

          const newGzip = createGzip()
          const writeStream = createWriteStream(newPath)
          await pipelinePromises(
            Readable.from([jsonContent]),
            newGzip,
            writeStream
          )

          unlinkSync(tempPath)

          task.status = 'completed'
          task.progress = 100
          task.message = 'Backup uploaded successfully'
          task.completedAt = Date.now()
          task.result = {
            filename: newFilename,
            size: statSync(newPath).size
          }

          broadcastBackupProgress(taskId, {
            status: 'completed',
            progress: 100,
            message: task.message,
            result: task.result
          })

          console.log(`[Backup] Uploaded and saved: ${newFilename}`)
        }
      } catch (err) {
        console.error('[Backup] Upload error:', err.message)
        if (existsSync(tempPath)) {
          unlinkSync(tempPath)
        }
        task.status = 'failed'
        task.error = err.message
        task.message = `Upload failed: ${err.message}`
        task.completedAt = Date.now()

        broadcastBackupProgress(taskId, {
          status: 'failed',
          progress: task.progress,
          message: task.message,
          error: err.message
        })
      }
    })
  } catch (err) {
    console.error('[Backup] Upload error:', err.message)
    if (req.file && existsSync(req.file.path)) {
      unlinkSync(req.file.path)
    }
    res.status(500).json({ ok: false, error: { message: err.message } })
  }
})

if (hasDist) {
  app.use(express.static(distPath))

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(join(distPath, 'index.html'))
    } else {
      next()
    }
  })
} else {
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next()
    }
    res.status(404).json({
      error: 'Frontend not built',
      message: `This is the backend API server. Please visit ${envConfig.DEV_FRONTEND_URL} for the frontend during development, or run 'npm run build' first.`,
      frontendUrl: envConfig.DEV_FRONTEND_URL,
    })
  })
}

// Register Office and MyWorld API routes
migrateOfficeTables()
registerOfficeRoutes(app)
migrateMyWorldTables()
registerMyWorldRoutes(app)

// Register Audit Log API routes
app.use('/api/audit', auditRoutes)

// Register Batch Operations API routes
app.use('/api/batch', batchRoutes)

// Register Search API routes
app.use('/api/search', searchRoutes)

// Register Statistics API routes
app.use('/api/stats', statsRoutes)

// Register RBAC API routes
app.use('/api/rbac', rbacRoutes)

// Register Themes API routes
app.use('/api/themes', themesRoutes)

// =====================================================
// R-01: User & Role Management API
// =====================================================
app.get('/api/users', authMiddleware, requirePermission('users:manage'), (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.status, u.email, u.avatar, u.created_at, u.updated_at, u.last_login_at
      FROM users u ORDER BY u.created_at DESC
    `).all()
    const users = rows.map(r => ({ ...r, lastLoginAt: r.last_login_at, createdAt: r.created_at, updatedAt: r.updated_at }))
    res.json({ ok: true, users })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/users', authMiddleware, requirePermission('users:manage'), (req, res) => {
  try {
    const { username, password, displayName, role, email } = req.body
    if (!username || !password) return res.status(400).json({ ok: false, error: 'username and password required' })
    const { hash, salt } = hashPassword(password)
    const id = randomUUID()
    db.prepare(`INSERT INTO users (id, username, password_hash, salt, display_name, role, email) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, username, hash, salt, displayName || username, role || 'viewer', email || null)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    res.json({ ok: true, user })
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ ok: false, error: 'Username already exists' })
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.put('/api/users/:id', authMiddleware, requirePermission('users:manage'), (req, res) => {
  try {
    const { id } = req.params
    const { displayName, role, status, email } = req.body
    db.prepare(`UPDATE users SET display_name = ?, role = ?, status = ?, email = ?, updated_at = ? WHERE id = ?`).run(displayName || null, role || null, status || null, email || null, Date.now(), id)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    res.json({ ok: true, user })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.delete('/api/users/:id', authMiddleware, requirePermission('users:manage'), (req, res) => {
  try {
    const { id } = req.params
    const deleted = db.prepare('DELETE FROM users WHERE id = ?').run(id)
    res.json({ ok: deleted.changes > 0 })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.get('/api/roles', authMiddleware, requirePermission('roles:manage'), (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM roles ORDER BY is_system DESC, name ASC').all()
    const roles = rows.map(r => ({ ...r, permissions: JSON.parse(r.permissions || '[]') }))
    res.json({ ok: true, roles })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.get('/api/permissions', authMiddleware, requirePermission('roles:manage'), (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM permissions ORDER BY resource, action').all()
    res.json({ ok: true, permissions: rows })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// =====================================================
// R-02: Notification API (DB-backed)
// =====================================================
app.get('/api/notifications', authMiddleware, (req, res) => {
  try {
    const { page = 1, pageSize = 20, unreadOnly } = req.query
    const userId = req.user?.id || null
    const result = getNotifications({ userId, page: Number(page), pageSize: Number(pageSize), unreadOnly: unreadOnly === 'true' })
    res.json({ ok: true, ...result })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.put('/api/notifications/:id/read', authMiddleware, (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user?.id || null
    const ok = markNotificationRead(id, userId)
    res.json({ ok })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.put('/api/notifications/read-all', authMiddleware, (req, res) => {
  try {
    const userId = req.user?.id || null
    const count = markAllNotificationsRead(userId)
    res.json({ ok: true, count })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.delete('/api/notifications/:id', authMiddleware, requirePermission('notifications:manage'), (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user?.id || null
    const ok = deleteNotification(id, userId)
    res.json({ ok })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// =====================================================
// R-02: Notification Channels (Alert Destinations)
// =====================================================
const alertChannels = [
  { id: 'in_app', name: '应用内通知', type: 'in_app', enabled: true, description: '在应用内通知中心显示' },
  { id: 'email', name: '邮件通知', type: 'email', enabled: false, description: '通过邮件发送通知' },
  { id: 'feishu', name: '飞书通知', type: 'feishu', enabled: false, description: '通过飞书机器人发送通知' },
]

app.get('/api/notification-channels', authMiddleware, requirePermission('notifications:manage'), (req, res) => {
  res.json({ ok: true, channels: alertChannels })
})

app.put('/api/notification-channels/:id', authMiddleware, requirePermission('notifications:manage'), (req, res) => {
  try {
    const { id } = req.params
    const { enabled, config } = req.body
    const channel = alertChannels.find(c => c.id === id)
    if (!channel) return res.status(404).json({ ok: false, error: 'Channel not found' })
    channel.enabled = enabled ?? channel.enabled
    if (config) channel.config = config
    res.json({ ok: true, channel })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// =====================================================
server.listen(envConfig.PORT, () => {
  console.log(`Server running on http://localhost:${envConfig.PORT}`)
  console.log(`OpenClaw Gateway: ${envConfig.OPENCLAW_WS_URL}`)
  if (isAuthEnabled()) {
    console.log(`Auth enabled: user "${envConfig.AUTH_USERNAME}"`)
  } else {
    console.log('Auth disabled (no AUTH_USERNAME/AUTH_PASSWORD configured)')
  }
  if (!hasDist) {
    console.log(`Development mode: Frontend at ${envConfig.DEV_FRONTEND_URL}`)
  }

  try {
    const runningTasks = db.prepare('SELECT id FROM backup_records WHERE status = ?').all('running')
    if (runningTasks.length > 0) {
      console.log(`[Backup] Marking ${runningTasks.length} interrupted tasks as failed`)
      db.prepare('UPDATE backup_records SET status = ?, error = ?, message = ? WHERE status = ?').run(
        'failed',
        'Server restarted during task execution',
        'Task interrupted by server restart',
        'running'
      )
    }
  } catch (err) {
    console.error('[Backup] Failed to cleanup interrupted tasks:', err.message)
  }
})

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  cleanupAllTerminalSessions()
  gateway.disconnect()
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})

process.on('SIGTERM', () => {
  console.log('\nShutting down (SIGTERM)...')
  cleanupAllTerminalSessions()
  gateway.disconnect()
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})
