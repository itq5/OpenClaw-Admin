import { readFileSync } from 'fs'
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { defineConfig, loadEnv } from 'vite'

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version?: string }

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const appVersion = packageJson.version || ''
  
  const backendPort = env.PORT || '3000'
  const frontendPort = env.DEV_PORT || '3001'
  
  return {
    plugins: [
      vue(),
      VueI18nPlugin({
        include: resolve(__dirname, './src/i18n/generated/**'),
        strictMessage: false,
      }),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: parseInt(String(frontendPort)),
      allowedHosts: true,
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      target: 'esnext',
      outDir: 'dist',
      rollupOptions: {
        output: {
          manualChunks: {
            'vue-vendor': ['vue', 'vue-router', 'pinia'],
          },
        },
      },
    },
    define: {
      __INTLIFY_JIT_COMPILATION__: true,
      __INTLIFY_DROP_MESSAGE_COMPILER__: false,
      'import.meta.env.VITE_APP_TITLE': JSON.stringify(env.VITE_APP_TITLE || 'OpenClaw Web'),
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    },
  }
})
