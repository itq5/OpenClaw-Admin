import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto'
import db from './database.js'
import { randomUUID } from 'crypto'

const SALT_LENGTH = 32
const HASH_ITERATIONS = 100000

// ========== SECURITY: Rate Limiting & Account Lockout ==========
// In-memory store for login attempts: keyed by username
const loginAttempts = new Map()
// In-memory store for API rate limiting: keyed by IP + endpoint
const apiRateLimits = new Map()
// In-memory store for brute-force detection: keyed by IP
const bruteForceTracker = new Map()

const LOGIN_MAX_ATTEMPTS = 5
const LOGIN_LOCKOUT_DURATION = 15 * 60 * 1000 // 15 minutes
const LOGIN_ATTEMPT_WINDOW = 15 * 60 * 1000 // 15 minutes window
const API_RATE_WINDOW = 60 * 1000 // 1 minute window
const API_RATE_MAX = 100 // max 100 requests per window per IP
const BRUTE_FORCE_THRESHOLD = 200 // max 200 requests per 5 minutes
const BRUTE_FORCE_WINDOW = 5 * 60 * 1000 // 5 minutes

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    req.ip ||
    'unknown'
}

function isIpLocked(ip) {
  const record = bruteForceTracker.get(ip)
  if (!record) return false
  if (Date.now() > record.releaseAt) {
    bruteForceTracker.delete(ip)
    return false
  }
  return true
}

function recordApiRequest(ip, endpoint) {
  const key = `${ip}:${endpoint}`
  const now = Date.now()
  const record = apiRateLimits.get(key)
  if (!record || now > record.windowStart + API_RATE_WINDOW) {
    apiRateLimits.set(key, { count: 1, windowStart: now })
    return
  }
  record.count++
}

function checkApiRateLimit(ip, endpoint) {
  const key = `${ip}:${endpoint}`
  const now = Date.now()
  const record = apiRateLimits.get(key)
  if (!record) return { allowed: true, remaining: API_RATE_MAX - 1 }
  if (now > record.windowStart + API_RATE_WINDOW) {
    apiRateLimits.set(key, { count: 1, windowStart: now })
    return { allowed: true, remaining: API_RATE_MAX - 1 }
  }
  if (record.count >= API_RATE_MAX) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((record.windowStart + API_RATE_WINDOW - now) / 1000) }
  }
  return { allowed: true, remaining: API_RATE_MAX - record.count }
}

function recordBruteForce(ip) {
  const now = Date.now()
  const record = bruteForceTracker.get(ip)
  if (!record || now > record.windowStart + BRUTE_FORCE_WINDOW) {
    bruteForceTracker.set(ip, { count: 1, windowStart: now, releaseAt: null })
    return
  }
  record.count++
  if (record.count >= BRUTE_FORCE_THRESHOLD) {
    record.releaseAt = now + BRUTE_FORCE_WINDOW * 2
    console.warn(`[Security] IP ${ip} temporarily blocked due to excessive requests`)
  }
}

function checkLoginAttempts(username) {
  const now = Date.now()
  const record = loginAttempts.get(username)
  if (!record) return { locked: false, attempts: 0 }
  if (record.lockedUntil && now > record.lockedUntil) {
    loginAttempts.delete(username)
    return { locked: false, attempts: 0 }
  }
  if (record.lockedUntil) {
    return { locked: true, attempts: record.attempts, lockedUntil: record.lockedUntil, remainingMs: record.lockedUntil - now }
  }
  if (record.windowStart && now > record.windowStart + LOGIN_ATTEMPT_WINDOW) {
    loginAttempts.delete(username)
    return { locked: false, attempts: 0 }
  }
  return { locked: false, attempts: record.attempts }
}

function recordFailedLogin(username, ip) {
  const now = Date.now()
  let record = loginAttempts.get(username)
  if (!record || now > record.windowStart + LOGIN_ATTEMPT_WINDOW) {
    record = { attempts: 0, windowStart: now, lockedUntil: null }
  }
  record.attempts++
  if (record.attempts >= LOGIN_MAX_ATTEMPTS) {
    record.lockedUntil = now + LOGIN_LOCKOUT_DURATION
    console.warn(`[Security] Account ${username} locked due to ${record.attempts} failed login attempts from IP ${ip}`)
  }
  loginAttempts.set(username, record)
}

function recordSuccessfulLogin(username) {
  loginAttempts.delete(username)
}

function clearLoginAttempts(username) {
  loginAttempts.delete(username)
}

// ========== Password Hashing ==========
function hashPassword(password, salt = null) {
  const normalizedSalt = typeof salt === 'string' && salt
    ? salt
    : randomBytes(SALT_LENGTH).toString('hex')

  const hash = pbkdf2Sync(
    String(password ?? ''),
    normalizedSalt,
    HASH_ITERATIONS,
    64,
    'sha512'
  ).toString('hex')

  return { hash, salt: normalizedSalt }
}

function resolveStoredPassword(storedHash, salt) {
  if (typeof salt === 'string' && salt) {
    return { storedHash, salt }
  }

  if (typeof storedHash === 'string' && storedHash.includes(':')) {
    const [storedSalt, hash] = storedHash.split(':')
    if (storedSalt && hash) {
      return { storedHash: hash, salt: storedSalt }
    }
  }

  return { storedHash, salt: null }
}

function verifyPassword(password, storedHash, salt) {
  const resolved = resolveStoredPassword(storedHash, salt)
  if (!resolved.salt || typeof resolved.storedHash !== 'string' || !resolved.storedHash) {
    return false
  }

  const { hash } = hashPassword(password, resolved.salt)
  try {
    const a = Buffer.from(hash, 'hex')
    const b = Buffer.from(resolved.storedHash, 'hex')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function generateToken() {
  return randomUUID() + '-' + randomBytes(32).toString('hex')
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

// ========== User Management ==========
function getUserById(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  if (!user) return null
  delete user.password_hash
  delete user.salt
  return user
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username)
}

function getUserPermissions(userId) {
  const rows = db.prepare(`
    SELECT r.permissions FROM roles r
    JOIN user_roles ur ON ur.role_id = r.id
    WHERE ur.user_id = ?
  `).all(userId)

  const perms = new Set()
  for (const row of rows) {
    const parsed = JSON.parse(row.permissions || '[]')
    for (const p of parsed) perms.add(p)
  }
  return [...perms]
}

function userHasPermission(userId, permissionName) {
  const perms = getUserPermissions(userId)
  if (perms.includes('perm_system_admin')) return true
  return perms.includes(permissionName)
}

function userHasAnyPermission(userId, permissionNames) {
  const perms = getUserPermissions(userId)
  if (perms.includes('perm_system_admin')) return true
  return permissionNames.some(p => perms.includes(p))
}

function hasGrantedPermission(auth, permissionName) {
  const permissions = Array.isArray(auth?.permissions) ? auth.permissions : []
  if (
    permissions.includes('perm_system_admin') ||
    permissions.includes('*:*')
  ) {
    return true
  }
  return permissions.includes(permissionName)
}

function hasAnyGrantedPermission(auth, permissionNames) {
  if (!Array.isArray(permissionNames) || permissionNames.length === 0) {
    return false
  }
  return permissionNames.some((permissionName) => hasGrantedPermission(auth, permissionName))
}

function getUserRoles(userId) {
  const rows = db.prepare(`
    SELECT r.*, ur.granted_at, ur.granted_by,
           u.display_name as granted_by_name
    FROM roles r
    JOIN user_roles ur ON ur.role_id = r.id
    LEFT JOIN users u ON u.id = ur.granted_by
    WHERE ur.user_id = ?
  `).all(userId)
  return rows.map(r => ({ ...r, permissions: JSON.parse(r.permissions || '[]') }))
}

// ========== Session Management ==========
function createSession(userId, ipAddress = null, userAgent = null) {
  const token = generateToken()
  const tokenHash = hashToken(token)
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days

  db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), userId, tokenHash, ipAddress, userAgent, expiresAt)

  // Update last login
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), userId)

  return { token, expiresAt }
}

// Validate session token
function validateSession(token) {
  if (!token) return null
  const tokenHash = hashToken(token)
  const session = db.prepare(`
    SELECT s.*, u.username, u.display_name, u.role, u.status as user_status, u.email, u.avatar
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash, Date.now())

  if (!session) return null
  if (session.user_status !== 'active') return null

  const permissions = getUserPermissions(session.user_id)
  return {
    sessionId: session.id,
    userId: session.user_id,
    username: session.username,
    displayName: session.display_name || session.username,
    role: session.role,
    userStatus: session.user_status,
    email: session.email,
    avatar: session.avatar,
    permissions,
    expiresAt: session.expires_at,
  }
}

function invalidateSession(token) {
  if (!token) return false
  const tokenHash = hashToken(token)
  const result = db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
  return result.changes > 0
}

function invalidateAllUserSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

function cleanupExpiredSessions() {
  const result = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
  return result.changes
}

// ========== Audit Log Extended Functions ==========
function getAuditLogById(id) {
  const log = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id)
  if (!log) return null
  return { ...log, details: JSON.parse(log.details || '{}') }
}

function getAuditLogStatistics({ startTime, endTime } = {}) {
  const conditions = []
  const params = []

  if (startTime) { conditions.push('created_at >= ?'); params.push(startTime) }
  if (endTime) { conditions.push('created_at <= ?'); params.push(endTime) }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // 总数
  const total = db.prepare(`SELECT COUNT(*) as count FROM audit_logs ${where}`).get(...params).count

  // 按状态统计
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM audit_logs ${where}
    GROUP BY status
  `).all(...params)

  // 按动作统计（前 10）
  const byAction = db.prepare(`
    SELECT action, COUNT(*) as count
    FROM audit_logs ${where}
    GROUP BY action
    ORDER BY count DESC
    LIMIT 10
  `).all(...params)

  // 按用户统计（前 10）
  const byUser = db.prepare(`
    SELECT username, COUNT(*) as count
    FROM audit_logs ${where}
    GROUP BY username
    HAVING username IS NOT NULL
    ORDER BY count DESC
    LIMIT 10
  `).all(...params)

  // 最近 24 小时趋势（每小时）
  const last24hStart = Date.now() - 24 * 60 * 60 * 1000
  const trend = db.prepare(`
    SELECT
      strftime('%Y-%m-%d %H:00', created_at / 1000, 'unixepoch') as hour,
      COUNT(*) as count
    FROM audit_logs
    WHERE created_at >= ?
    GROUP BY hour
    ORDER BY hour
  `).all(last24hStart)

  return {
    total,
    byStatus: byStatus.reduce((acc, r) => { acc[r.status] = r.count; return acc }, {}),
    byAction: byAction.reduce((acc, r) => { acc[r.action] = r.count; return acc }, {}),
    byUser: byUser.reduce((acc, r) => { acc[r.username] = r.count; return acc }, {}),
    trend: trend.map(r => ({ hour: r.hour, count: r.count }))
  }
}

// ========== Audit Logging ==========
function createAuditLog({ userId, username, action, resource, resourceId, details, ipAddress, userAgent, status = 'success', errorMessage = null }) {
  const id = randomUUID()
  db.prepare(`
    INSERT INTO audit_logs (id, user_id, username, action, resource, resource_id, details, ip_address, user_agent, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId || null,
    username || null,
    action,
    resource || null,
    resourceId || null,
    JSON.stringify(details || {}),
    ipAddress || null,
    userAgent || null,
    status,
    errorMessage || null
  )
  return id
}

function getAuditLogs({ page = 1, pageSize = 50, userId, action, resource, status, startTime, endTime }) {
  const conditions = []
  const params = []

  if (userId) { conditions.push('user_id = ?'); params.push(userId) }
  if (action) { conditions.push('action LIKE ?'); params.push(`${action}%`) }
  if (resource) { conditions.push('resource = ?'); params.push(resource) }
  if (status) { conditions.push('status = ?'); params.push(status) }
  if (startTime) { conditions.push('created_at >= ?'); params.push(startTime) }
  if (endTime) { conditions.push('created_at <= ?'); params.push(endTime) }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const total = db.prepare(`SELECT COUNT(*) as count FROM audit_logs ${where}`).get(...params).count
  const offset = (page - 1) * pageSize

  const rows = db.prepare(`
    SELECT * FROM audit_logs ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset)

  return {
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    logs: rows.map(r => ({ ...r, details: JSON.parse(r.details || '{}') }))
  }
}

// ========== RBAC Middleware ==========
function requirePermission(permissionName) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({ ok: false, error: 'Unauthorized', code: 'AUTH_REQUIRED' })
    }
    if (
      !hasGrantedPermission(req.auth, permissionName) &&
      !userHasPermission(req.auth.userId, permissionName)
    ) {
      createAuditLog({
        userId: req.auth.userId,
        username: req.auth.username,
        action: 'ACCESS_DENIED',
        resource: permissionName.split(':')[0],
        details: { requiredPermission: permissionName, path: req.path },
        ipAddress: getClientIp(req),
        userAgent: req.get('User-Agent'),
        status: 'denied'
      })
      return res.status(403).json({ ok: false, error: 'Forbidden', code: 'PERMISSION_DENIED', required: permissionName })
    }
    next()
  }
}

function requireAnyPermission(permissionNames) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({ ok: false, error: 'Unauthorized', code: 'AUTH_REQUIRED' })
    }
    if (
      !hasAnyGrantedPermission(req.auth, permissionNames) &&
      !userHasAnyPermission(req.auth.userId, permissionNames)
    ) {
      createAuditLog({
        userId: req.auth.userId,
        username: req.auth.username,
        action: 'ACCESS_DENIED',
        resource: 'mixed',
        details: { requiredPermissions: permissionNames, path: req.path },
        ipAddress: getClientIp(req),
        userAgent: req.get('User-Agent'),
        status: 'denied'
      })
      return res.status(403).json({ ok: false, error: 'Forbidden', code: 'PERMISSION_DENIED', required: permissionNames })
    }
    next()
  }
}

function requireRole(roleName) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({ ok: false, error: 'Unauthorized', code: 'AUTH_REQUIRED' })
    }
    if (req.auth.role !== roleName && req.auth.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Forbidden', code: 'ROLE_REQUIRED', required: roleName })
    }
    next()
  }
}

// ========== Auth Middleware ==========
function attachAuth(req, res, next) {
  let token = req.headers.authorization?.replace('Bearer ', '')

  // SECURITY: Query param token support removed to prevent log leakage
  // Token via query param is a security risk

  // Fallback: cookie (with security flags checked later)
  if (!token && req.cookies && req.cookies.session_token) {
    token = req.cookies.session_token
  }

  if (!token) {
    req.auth = null
    req.user = null
    req.sessionId = null
    return next()
  }

  const session = validateSession(token)
  req.auth = session
  if (session) {
    req.user = {
      id: session.userId,
      username: session.username,
      role: session.role,
      permissions: session.permissions,
    }
    req.sessionId = session.sessionId
  } else {
    req.user = null
    req.sessionId = null
  }
  next()
}

function requireAuth(req, res, next) {
  if (!req.auth) {
    return res.status(401).json({ ok: false, error: 'Unauthorized', code: 'AUTH_REQUIRED' })
  }
  next()
}

function optionalAuth(req, res, next) {
  attachAuth(req, res, next)
}

// ========== Security Utilities (exported for use by server/index.js) ==========
export {
  getClientIp,
  isIpLocked,
  recordApiRequest,
  checkApiRateLimit,
  recordBruteForce,
  checkLoginAttempts,
  recordFailedLogin,
  recordSuccessfulLogin,
  clearLoginAttempts,
  hashPassword,
  verifyPassword,
  generateToken,
  hashToken,
  getUserById,
  getUserByUsername,
  getUserPermissions,
  userHasPermission,
  userHasAnyPermission,
  getUserRoles,
  createSession,
  validateSession,
  invalidateSession,
  invalidateAllUserSessions,
  cleanupExpiredSessions,
  getAuditLogById,
  getAuditLogStatistics,
  createAuditLog,
  getAuditLogs,
  requirePermission,
  requireAnyPermission,
  requireRole,
  attachAuth,
  requireAuth,
  optionalAuth,
}
