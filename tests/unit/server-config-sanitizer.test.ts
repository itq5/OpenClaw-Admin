import { describe, expect, it } from 'vitest'
import { applyConfigUpdate, sanitizeConfigForClient } from '../../server/config-sanitizer.js'

describe('server/config-sanitizer', () => {
  it('removes secret values from config responses and exposes only configured flags', () => {
    const sanitized = sanitizeConfigForClient({
      AUTH_USERNAME: 'admin',
      AUTH_PASSWORD: 'super-secret',
      OPENCLAW_WS_URL: 'ws://localhost:18789',
      OPENCLAW_AUTH_TOKEN: 'gateway-token',
      OPENCLAW_AUTH_PASSWORD: '',
    })

    expect(sanitized).toEqual({
      AUTH_USERNAME: 'admin',
      OPENCLAW_WS_URL: 'ws://localhost:18789',
      AUTH_PASSWORD_SET: true,
      OPENCLAW_AUTH_TOKEN_SET: true,
      OPENCLAW_AUTH_PASSWORD_SET: false,
    })
  })

  it('keeps existing secrets when the update payload leaves secret fields blank', () => {
    const updated = applyConfigUpdate(
      {
        AUTH_USERNAME: 'admin',
        AUTH_PASSWORD: 'existing-password',
        OPENCLAW_WS_URL: 'ws://localhost:18789',
        OPENCLAW_AUTH_TOKEN: 'existing-token',
        OPENCLAW_AUTH_PASSWORD: 'existing-gateway-password',
      },
      {
        AUTH_USERNAME: 'next-admin',
        AUTH_PASSWORD: '',
        OPENCLAW_WS_URL: 'ws://localhost:19999',
        OPENCLAW_AUTH_TOKEN: '',
        OPENCLAW_AUTH_PASSWORD: '',
      },
    )

    expect(updated).toEqual({
      AUTH_USERNAME: 'next-admin',
      AUTH_PASSWORD: 'existing-password',
      OPENCLAW_WS_URL: 'ws://localhost:19999',
      OPENCLAW_AUTH_TOKEN: 'existing-token',
      OPENCLAW_AUTH_PASSWORD: 'existing-gateway-password',
    })
  })

  it('overwrites secrets only when a new non-empty value is provided', () => {
    const updated = applyConfigUpdate(
      {
        AUTH_USERNAME: 'admin',
        AUTH_PASSWORD: 'existing-password',
        OPENCLAW_WS_URL: 'ws://localhost:18789',
        OPENCLAW_AUTH_TOKEN: 'existing-token',
        OPENCLAW_AUTH_PASSWORD: '',
      },
      {
        AUTH_PASSWORD: 'new-password',
        OPENCLAW_AUTH_TOKEN: 'new-token',
      },
    )

    expect(updated.AUTH_PASSWORD).toBe('new-password')
    expect(updated.OPENCLAW_AUTH_TOKEN).toBe('new-token')
    expect(updated.OPENCLAW_AUTH_PASSWORD).toBe('')
  })

  it('clears a saved secret when an explicit clear flag is provided', () => {
    const updated = applyConfigUpdate(
      {
        AUTH_USERNAME: 'admin',
        AUTH_PASSWORD: 'existing-password',
        OPENCLAW_WS_URL: 'ws://localhost:18789',
        OPENCLAW_AUTH_TOKEN: 'existing-token',
        OPENCLAW_AUTH_PASSWORD: 'existing-gateway-password',
      },
      {
        AUTH_PASSWORD_CLEAR: true,
        OPENCLAW_AUTH_PASSWORD_CLEAR: true,
      },
    )

    expect(updated.AUTH_PASSWORD).toBe('')
    expect(updated.OPENCLAW_AUTH_TOKEN).toBe('existing-token')
    expect(updated.OPENCLAW_AUTH_PASSWORD).toBe('')
  })
})
