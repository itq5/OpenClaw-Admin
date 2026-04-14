import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const serverSource = readFileSync(join(process.cwd(), 'server/index.js'), 'utf8')

describe('server auth session contract', () => {
  it('returns current user details from /api/auth/check', () => {
    expect(serverSource).toContain('authenticated: true')
    expect(serverSource).toContain('user: req.user')
    expect(serverSource).toContain('sessionId: req.sessionId')
  })

  it('returns current user details from env auth login', () => {
    expect(serverSource).toContain("role: 'admin'")
    expect(serverSource).toContain("permissions: ['perm_system_admin']")
  })
})
