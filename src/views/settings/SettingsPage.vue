<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import {
  NCard,
  NSpace,
  NSelect,
  NText,
  NAlert,
  NForm,
  NFormItem,
  NInput,
  NButton,
  NSpin,
  useMessage,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useThemeStore, type ThemeMode } from '@/stores/theme'
import { useWebSocketStore } from '@/stores/websocket'
import { useAuthStore } from '@/stores/auth'
import { ConnectionState } from '@/api/types'

const themeStore = useThemeStore()
const wsStore = useWebSocketStore()
const authStore = useAuthStore()
const { t } = useI18n()
const message = useMessage()
const appTitle = import.meta.env.VITE_APP_TITLE || 'OpenClaw Admin'
const appVersion = import.meta.env.VITE_APP_VERSION || '0.2.3'

const loading = ref(false)
const saving = ref(false)
const configForm = ref({
  AUTH_USERNAME: '',
  AUTH_PASSWORD: '',
  OPENCLAW_WS_URL: '',
  OPENCLAW_AUTH_TOKEN: '',
  OPENCLAW_AUTH_PASSWORD: '', // Gateway 密码认证
})

const themeOptions = computed(() => ([
  { label: t('pages.settings.themeLight'), value: 'light' },
  { label: t('pages.settings.themeDark'), value: 'dark' },
]))

const connectionStatus = computed(() => {
  switch (wsStore.state) {
    case ConnectionState.CONNECTED: return { text: t('pages.settings.statusConnected'), type: 'success' as const }
    case ConnectionState.CONNECTING: return { text: t('pages.settings.statusConnecting'), type: 'info' as const }
    case ConnectionState.RECONNECTING: return { text: t('pages.settings.statusReconnecting', { count: wsStore.reconnectAttempts }), type: 'warning' as const }
    case ConnectionState.FAILED: return { text: t('pages.settings.statusFailed'), type: 'error' as const }
    default: return { text: t('pages.settings.statusDisconnected'), type: 'error' as const }
  }
})

function handleThemeChange(mode: ThemeMode) {
  themeStore.setMode(mode)
}

async function loadConfig() {
  loading.value = true
  try {
    const token = authStore.getToken()
    const response = await fetch('/api/config', {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })
    const data = await response.json()
    if (data.ok) {
      configForm.value = {
        AUTH_USERNAME: data.config.AUTH_USERNAME || '',
        AUTH_PASSWORD: data.config.AUTH_PASSWORD || '',
        OPENCLAW_WS_URL: data.config.OPENCLAW_WS_URL || '',
        OPENCLAW_AUTH_TOKEN: data.config.OPENCLAW_AUTH_TOKEN || '',
        OPENCLAW_AUTH_PASSWORD: data.config.OPENCLAW_AUTH_PASSWORD || '',
      }
    }
  } catch (e) {
    message.error(t('pages.settings.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function saveConfig() {
  saving.value = true
  try {
    const token = authStore.getToken()
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(configForm.value),
    })
    const data = await response.json()
    if (data.ok) {
      message.success(t('pages.settings.saveSuccess'))
      setTimeout(() => {
        window.location.reload()
      }, 1000)
    } else {
      message.error(data.error?.message || t('pages.settings.saveFailed'))
    }
  } catch (e) {
    message.error(t('pages.settings.saveFailed'))
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadConfig()
})
</script>

<template>
  <NSpace vertical :size="16">
    <NCard :title="t('pages.settings.connectionSettings')" class="app-card">
      <NAlert :type="connectionStatus.type" :bordered="false">
        {{ t('pages.settings.currentStatus', { status: connectionStatus.text }) }}
        <span v-if="wsStore.lastError">（{{ wsStore.lastError }}）</span>
      </NAlert>
    </NCard>

    <NCard :title="t('pages.settings.envSettings')" class="app-card">
      <NSpin :show="loading">
        <NForm label-placement="left" label-width="140" style="max-width: 600px;">
          <NFormItem :label="t('pages.settings.authUsername')">
            <NInput
              v-model:value="configForm.AUTH_USERNAME"
              :placeholder="t('pages.settings.authUsernamePlaceholder')"
            />
          </NFormItem>
          
          <NFormItem :label="t('pages.settings.authPassword')">
            <NInput
              v-model:value="configForm.AUTH_PASSWORD"
              type="password"
              show-password-on="click"
              :placeholder="t('pages.settings.authPasswordPlaceholder')"
            />
          </NFormItem>
          
          <NFormItem :label="t('pages.settings.openclawUrl')">
            <NInput
              v-model:value="configForm.OPENCLAW_WS_URL"
              :placeholder="t('pages.settings.openclawUrlPlaceholder')"
            />
          </NFormItem>
          
          <NFormItem :label="t('pages.settings.openclawToken')">
            <NInput
              v-model:value="configForm.OPENCLAW_AUTH_TOKEN"
              type="password"
              show-password-on="click"
              :placeholder="t('pages.settings.openclawTokenPlaceholder')"
            />
          </NFormItem>
          
          <NFormItem :label="t('pages.settings.openclawPassword')">
            <NInput
              v-model:value="configForm.OPENCLAW_AUTH_PASSWORD"
              type="password"
              show-password-on="click"
              :placeholder="t('pages.settings.openclawPasswordPlaceholder')"
            />
          </NFormItem>
          
          <NFormItem :label="''">
            <NSpace>
              <NButton type="primary" :loading="saving" @click="saveConfig">
                {{ t('pages.settings.save') }}
              </NButton>
            </NSpace>
          </NFormItem>
        </NForm>
      </NSpin>
      
      <NAlert type="info" :bordered="false" style="margin-top: 16px;">
        {{ t('pages.settings.envSettingsHint') }}
      </NAlert>
    </NCard>

    <NCard :title="t('pages.settings.appearanceSettings')" class="app-card">
      <NForm label-placement="left" label-width="120" style="max-width: 500px;">
        <NFormItem :label="t('pages.settings.themeMode')">
          <NSelect
            :value="themeStore.mode"
            :options="themeOptions"
            @update:value="handleThemeChange"
          />
        </NFormItem>
      </NForm>
    </NCard>

    <NCard :title="t('pages.settings.about')" class="app-card">
      <NSpace vertical :size="8">
        <NText>{{ appTitle }} v{{ appVersion }}</NText>
        <NText depth="3" style="font-size: 13px;">
          {{ t('pages.settings.aboutLine1') }}
        </NText>
        <NText depth="3" style="font-size: 13px;">
          {{ t('pages.settings.aboutLine2') }}
        </NText>
      </NSpace>
    </NCard>
  </NSpace>
</template>
