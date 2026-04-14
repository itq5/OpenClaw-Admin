export interface SettingsConfigForm {
  AUTH_USERNAME: string
  AUTH_PASSWORD: string
  OPENCLAW_WS_URL: string
  OPENCLAW_AUTH_TOKEN: string
  OPENCLAW_AUTH_PASSWORD: string
}

export interface SettingsSecretState {
  AUTH_PASSWORD_SET: boolean
  OPENCLAW_AUTH_TOKEN_SET: boolean
  OPENCLAW_AUTH_PASSWORD_SET: boolean
}

export interface SettingsSecretClearForm {
  AUTH_PASSWORD_CLEAR: boolean
  OPENCLAW_AUTH_TOKEN_CLEAR: boolean
  OPENCLAW_AUTH_PASSWORD_CLEAR: boolean
}

export interface SettingsApiConfig {
  AUTH_USERNAME?: string
  OPENCLAW_WS_URL?: string
  AUTH_PASSWORD_SET?: boolean
  OPENCLAW_AUTH_TOKEN_SET?: boolean
  OPENCLAW_AUTH_PASSWORD_SET?: boolean
}

export function createEmptyConfigForm(): SettingsConfigForm {
  return {
    AUTH_USERNAME: '',
    AUTH_PASSWORD: '',
    OPENCLAW_WS_URL: '',
    OPENCLAW_AUTH_TOKEN: '',
    OPENCLAW_AUTH_PASSWORD: '',
  }
}

export function createEmptySecretState(): SettingsSecretState {
  return {
    AUTH_PASSWORD_SET: false,
    OPENCLAW_AUTH_TOKEN_SET: false,
    OPENCLAW_AUTH_PASSWORD_SET: false,
  }
}

export function createEmptySecretClearForm(): SettingsSecretClearForm {
  return {
    AUTH_PASSWORD_CLEAR: false,
    OPENCLAW_AUTH_TOKEN_CLEAR: false,
    OPENCLAW_AUTH_PASSWORD_CLEAR: false,
  }
}

export function applyLoadedConfig(config: SettingsApiConfig = {}) {
  return {
    form: {
      ...createEmptyConfigForm(),
      AUTH_USERNAME: config.AUTH_USERNAME || '',
      OPENCLAW_WS_URL: config.OPENCLAW_WS_URL || '',
    },
    secretState: {
      AUTH_PASSWORD_SET: Boolean(config.AUTH_PASSWORD_SET),
      OPENCLAW_AUTH_TOKEN_SET: Boolean(config.OPENCLAW_AUTH_TOKEN_SET),
      OPENCLAW_AUTH_PASSWORD_SET: Boolean(config.OPENCLAW_AUTH_PASSWORD_SET),
    },
    clearForm: createEmptySecretClearForm(),
  }
}

export interface SettingsConfigPayload extends Partial<SettingsConfigForm>, Partial<SettingsSecretClearForm> {}

export function buildConfigPayload(form: SettingsConfigForm, clearForm: SettingsSecretClearForm) {
  const payload: SettingsConfigPayload = {
    AUTH_USERNAME: form.AUTH_USERNAME,
    OPENCLAW_WS_URL: form.OPENCLAW_WS_URL,
  }

  if (clearForm.AUTH_PASSWORD_CLEAR) {
    payload.AUTH_PASSWORD_CLEAR = true
  } else if (form.AUTH_PASSWORD) {
    payload.AUTH_PASSWORD = form.AUTH_PASSWORD
  }

  if (clearForm.OPENCLAW_AUTH_TOKEN_CLEAR) {
    payload.OPENCLAW_AUTH_TOKEN_CLEAR = true
  } else if (form.OPENCLAW_AUTH_TOKEN) {
    payload.OPENCLAW_AUTH_TOKEN = form.OPENCLAW_AUTH_TOKEN
  }

  if (clearForm.OPENCLAW_AUTH_PASSWORD_CLEAR) {
    payload.OPENCLAW_AUTH_PASSWORD_CLEAR = true
  } else if (form.OPENCLAW_AUTH_PASSWORD) {
    payload.OPENCLAW_AUTH_PASSWORD = form.OPENCLAW_AUTH_PASSWORD
  }

  return payload
}
