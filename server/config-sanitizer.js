const SECRET_CONFIG_KEYS = [
  'AUTH_PASSWORD',
  'OPENCLAW_AUTH_TOKEN',
  'OPENCLAW_AUTH_PASSWORD',
]

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

export function sanitizeConfigForClient(config = {}) {
  const safeConfig = { ...config }

  for (const key of SECRET_CONFIG_KEYS) {
    delete safeConfig[key]
    safeConfig[`${key}_SET`] = hasNonEmptyString(config[key])
  }

  return safeConfig
}

export function applyConfigUpdate(existing = {}, updates = {}) {
  const nextConfig = { ...existing }

  if (updates.AUTH_USERNAME !== undefined) {
    nextConfig.AUTH_USERNAME = updates.AUTH_USERNAME
  }

  if (updates.OPENCLAW_WS_URL !== undefined) {
    nextConfig.OPENCLAW_WS_URL = updates.OPENCLAW_WS_URL
  }

  for (const key of SECRET_CONFIG_KEYS) {
    const value = updates[key]
    if (hasNonEmptyString(value)) {
      nextConfig[key] = value
      continue
    }

    if (updates[`${key}_CLEAR`] === true) {
      nextConfig[key] = ''
    }
  }

  return nextConfig
}
