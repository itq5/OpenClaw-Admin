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

describe('server/auth runtime hashing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('hashPassword returns hash and salt without throwing', async () => {
    const { hashPassword } = await import('../../server/auth.js')

    const result = hashPassword('test-password')

    expect(result).toMatchObject({
      hash: expect.any(String),
      salt: expect.any(String),
    })
    expect(result.hash).toMatch(/^[0-9a-f]+$/)
    expect(result.hash).toHaveLength(128)
    expect(result.salt).toMatch(/^[0-9a-f]+$/)
    expect(result.salt).toHaveLength(64)
  })

  it('verifyPassword accepts the correct password and rejects the wrong one', async () => {
    const { hashPassword, verifyPassword } = await import('../../server/auth.js')
    const { hash, salt } = hashPassword('correct-horse-battery-staple')

    expect(verifyPassword('correct-horse-battery-staple', hash, salt)).toBe(true)
    expect(verifyPassword('wrong-password', hash, salt)).toBe(false)
  })
})
