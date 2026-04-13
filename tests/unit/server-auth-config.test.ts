import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const serverSource = readFileSync(join(process.cwd(), 'server/index.js'), 'utf8')

describe('server auth config contract', () => {
  it('keeps auth enabled state boolean instead of leaking env values', () => {
    expect(serverSource).toContain('return Boolean(envConfig.AUTH_USERNAME && envConfig.AUTH_PASSWORD)')
    expect(serverSource).toContain('enabled: isAuthEnabled()')
  })
})
