import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    prepare: vi.fn(() => ({
      get: vi.fn(),
      run: vi.fn(),
      all: vi.fn(() => []),
    })),
  },
}))

vi.mock('../../server/database.js', () => ({
  default: mockDb,
}))

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  }
}

describe('server/auth permission middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('attachAuth populates req.user and sessionId for database-backed sessions', async () => {
    mockDb.prepare.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('FROM sessions s')) {
        return {
          get: vi.fn(() => ({
            id: 'session-db-1',
            user_id: 'user-db-1',
            username: 'db-admin',
            display_name: 'DB Admin',
            role: 'admin',
            user_status: 'active',
            email: 'db-admin@example.invalid',
            avatar: null,
            expires_at: Date.now() + 60_000,
          })),
          run: vi.fn(),
          all: vi.fn(() => []),
        }
      }

      if (typeof sql === 'string' && sql.includes('FROM roles r')) {
        return {
          get: vi.fn(),
          run: vi.fn(),
          all: vi.fn(() => [{ permissions: JSON.stringify(['perm_system_admin']) }]),
        }
      }

      return {
        get: vi.fn(),
        run: vi.fn(),
        all: vi.fn(() => []),
      }
    })

    const { attachAuth } = await import('../../server/auth.js')
    const req = {
      headers: { authorization: 'Bearer token-db-1' },
      cookies: {},
      socket: {},
      ip: '127.0.0.1',
    }
    const next = vi.fn()

    attachAuth(req, {}, next)

    expect(next).toHaveBeenCalledOnce()
    expect(req.auth).toMatchObject({
      sessionId: 'session-db-1',
      userId: 'user-db-1',
      username: 'db-admin',
      role: 'admin',
      permissions: ['perm_system_admin'],
    })
    expect(req.user).toEqual({
      id: 'user-db-1',
      username: 'db-admin',
      role: 'admin',
      permissions: ['perm_system_admin'],
    })
    expect(req.sessionId).toBe('session-db-1')
  })

  it('requirePermission accepts req.auth.permissions shortcut for env admin sessions', async () => {
    const { requirePermission } = await import('../../server/auth.js')
    const middleware = requirePermission('users:manage')
    const req = {
      auth: {
        userId: 'env:administrator',
        username: 'administrator',
        role: 'admin',
        permissions: ['perm_system_admin'],
      },
      path: '/api/users',
      get: vi.fn(() => 'vitest'),
      headers: {},
      socket: {},
      ip: '127.0.0.1',
    }
    const res = createResponse()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('requireAnyPermission accepts explicit permissions already present on req.auth', async () => {
    const { requireAnyPermission } = await import('../../server/auth.js')
    const middleware = requireAnyPermission(['channels:manage', 'files:manage'])
    const req = {
      auth: {
        userId: 'session-user',
        username: 'tester',
        role: 'operator',
        permissions: ['files:manage'],
      },
      path: '/api/files',
      get: vi.fn(() => 'vitest'),
      headers: {},
      socket: {},
      ip: '127.0.0.1',
    }
    const res = createResponse()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })
})
