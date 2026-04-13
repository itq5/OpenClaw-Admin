import { describe, expect, it } from 'vitest'
import {
  applyLoadedConfig,
  buildConfigPayload,
  createEmptyConfigForm,
  createEmptySecretClearForm,
} from '@/views/settings/config-form'

describe('settings config form helpers', () => {
  it('loads safe config fields without hydrating secret values into the form', () => {
    const loaded = applyLoadedConfig({
      AUTH_USERNAME: 'admin',
      OPENCLAW_WS_URL: 'ws://localhost:18789',
      AUTH_PASSWORD_SET: true,
      OPENCLAW_AUTH_TOKEN_SET: true,
      OPENCLAW_AUTH_PASSWORD_SET: false,
    })

    expect(loaded.form).toEqual({
      AUTH_USERNAME: 'admin',
      AUTH_PASSWORD: '',
      OPENCLAW_WS_URL: 'ws://localhost:18789',
      OPENCLAW_AUTH_TOKEN: '',
      OPENCLAW_AUTH_PASSWORD: '',
    })

    expect(loaded.secretState).toEqual({
      AUTH_PASSWORD_SET: true,
      OPENCLAW_AUTH_TOKEN_SET: true,
      OPENCLAW_AUTH_PASSWORD_SET: false,
    })

    expect(loaded.clearForm).toEqual({
      AUTH_PASSWORD_CLEAR: false,
      OPENCLAW_AUTH_TOKEN_CLEAR: false,
      OPENCLAW_AUTH_PASSWORD_CLEAR: false,
    })
  })

  it('omits blank secret fields when building the save payload', () => {
    const form = createEmptyConfigForm()
    const clearForm = createEmptySecretClearForm()
    form.AUTH_USERNAME = 'admin'
    form.OPENCLAW_WS_URL = 'ws://localhost:18789'

    expect(buildConfigPayload(form, clearForm)).toEqual({
      AUTH_USERNAME: 'admin',
      OPENCLAW_WS_URL: 'ws://localhost:18789',
    })
  })

  it('includes secret fields only when the user entered replacement values', () => {
    const form = createEmptyConfigForm()
    const clearForm = createEmptySecretClearForm()
    form.AUTH_USERNAME = 'admin'
    form.AUTH_PASSWORD = 'new-password'
    form.OPENCLAW_WS_URL = 'ws://localhost:18789'
    form.OPENCLAW_AUTH_TOKEN = 'new-token'

    expect(buildConfigPayload(form, clearForm)).toEqual({
      AUTH_USERNAME: 'admin',
      AUTH_PASSWORD: 'new-password',
      OPENCLAW_WS_URL: 'ws://localhost:18789',
      OPENCLAW_AUTH_TOKEN: 'new-token',
    })
  })

  it('sends explicit clear flags when the user chooses to remove saved secrets', () => {
    const form = createEmptyConfigForm()
    const clearForm = createEmptySecretClearForm()
    form.AUTH_USERNAME = 'admin'
    form.OPENCLAW_WS_URL = 'ws://localhost:18789'
    clearForm.AUTH_PASSWORD_CLEAR = true
    clearForm.OPENCLAW_AUTH_PASSWORD_CLEAR = true

    expect(buildConfigPayload(form, clearForm)).toEqual({
      AUTH_USERNAME: 'admin',
      OPENCLAW_WS_URL: 'ws://localhost:18789',
      AUTH_PASSWORD_CLEAR: true,
      OPENCLAW_AUTH_PASSWORD_CLEAR: true,
    })
  })

  it('prefers an explicit clear action over a stale input value', () => {
    const form = createEmptyConfigForm()
    const clearForm = createEmptySecretClearForm()
    form.AUTH_USERNAME = 'admin'
    form.AUTH_PASSWORD = 'stale-value'
    form.OPENCLAW_WS_URL = 'ws://localhost:18789'
    clearForm.AUTH_PASSWORD_CLEAR = true

    expect(buildConfigPayload(form, clearForm)).toEqual({
      AUTH_USERNAME: 'admin',
      OPENCLAW_WS_URL: 'ws://localhost:18789',
      AUTH_PASSWORD_CLEAR: true,
    })
  })
})
