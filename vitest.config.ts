import { defineConfig } from 'vitest/config'
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue(),
    VueI18nPlugin({
      include: resolve(__dirname, './src/i18n/generated/**'),
      strictMessage: false,
    }),
  ],
  define: {
    __INTLIFY_JIT_COMPILATION__: true,
    __INTLIFY_DROP_MESSAGE_COMPILER__: false,
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['tests/setup/vitest.setup.ts'],
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/e2e/**/*.test.ts',
      'tests/security/**/*.test.ts',
      'tests/performance/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/stores/**/*.ts', 'src/server/**/*.ts', 'server/**/*.js'],
      exclude: ['src/server/**/*.ts'], // Exclude new TS files from coverage for now
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
    extensions: ['.ts', '.js', '.json'],
  },
})
