import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('Remote desktop auth wiring', () => {
  it('does not rely on a stale localStorage token key for desktop requests', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/views/remote-desktop/RemoteDesktopPage.vue'),
      'utf8',
    )

    expect(source).toContain('buildAuthHeaders')
    expect(source).toContain('headers: buildAuthHeaders()')
    expect(source).toContain('headers: buildAuthHeaders(true)')
    expect(source).not.toContain("localStorage.getItem('token')")
  })
})
