import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('vite vue-i18n bundler config', () => {
  it('precompiles locale resources through the official vue-i18n vite plugin', () => {
    const configSource = readFileSync('vite.config.ts', 'utf8')
    expect(configSource).toContain("VueI18nPlugin({")
    expect(configSource).toContain("include: resolve(__dirname, './src/i18n/generated/**')")
    expect(configSource).toContain('strictMessage: false')
    expect(configSource).toContain('__INTLIFY_JIT_COMPILATION__: true')
    expect(configSource).toContain('__INTLIFY_DROP_MESSAGE_COMPILER__: false')
  })
})
