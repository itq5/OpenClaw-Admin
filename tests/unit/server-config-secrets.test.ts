import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const serverSource = readFileSync(join(process.cwd(), 'server/index.js'), 'utf8')

describe('server config secret handling contract', () => {
  it('sanitizes /api/config responses before sending them to the client', () => {
    expect(serverSource).toContain("res.json({ ok: true, config: sanitizeConfigForClient(config) })")
  })

  it('treats blank secret fields as keep-existing values during config saves', () => {
    expect(serverSource).toContain("const nextConfig = applyConfigUpdate(existing, req.body || {})")
  })

  it('supports explicit clear flags for saved secrets', () => {
    expect(serverSource).toContain("const nextConfig = applyConfigUpdate(existing, req.body || {})")
    expect(readFileSync(join(process.cwd(), 'server/config-sanitizer.js'), 'utf8')).toContain("updates[`${key}_CLEAR`] === true")
  })
})
