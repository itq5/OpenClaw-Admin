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
  NCheckbox,
  NButton,
  NSpin,
  useMessage,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useThemeStore, type ThemeMode } from '@/stores/theme'
import { useWebSocketStore } from '@/stores/websocket'
import { useAuthStore } from '@/stores/auth'
import { ConnectionState } from '@/api/types'
import {
  applyLoadedConfig,
  buildConfigPayload,
  createEmptyConfigForm,
  createEmptySecretClearForm,
  createEmptySecretState,
} from './config-form'

const themeStore = useThemeStore()
const wsStore = useWebSocketStore()
const authStore = useAuthStore()
const { t } = useI18n()
const message = useMessage()
const appTitle = import.meta.env.VITE_APP_TITLE || 'OpenClaw Admin'
const appVersion = import.meta.env.VITE_APP_VERSION || ''

const loading = ref(false)
const saving = ref(false)
const configForm = ref(createEmptyConfigForm())
const secretState = ref(createEmptySecretState())
const secretClearForm = ref(createEmptySecretClearForm())

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

const secretConfiguredPlaceholder = computed(() => t('pages.settings.secretConfiguredPlaceholder'))
const secretWillBeClearedPlaceholder = computed(() => t('pages.settings.secretWillBeClearedPlaceholder'))
const authPasswordPlaceholder = computed(() => (
  secretClearForm.value.AUTH_PASSWORD_CLEAR
    ? secretWillBeClearedPlaceholder.value
    : secretState.value.AUTH_PASSWORD_SET
    ? secretConfiguredPlaceholder.value
    : t('pages.settings.authPasswordPlaceholder')
))
const openClawTokenPlaceholder = computed(() => (
  secretClearForm.value.OPENCLAW_AUTH_TOKEN_CLEAR
    ? secretWillBeClearedPlaceholder.value
    : secretState.value.OPENCLAW_AUTH_TOKEN_SET
    ? secretConfiguredPlaceholder.value
    : t('pages.settings.openclawTokenPlaceholder')
))
const openClawPasswordPlaceholder = computed(() => (
  secretClearForm.value.OPENCLAW_AUTH_PASSWORD_CLEAR
    ? secretWillBeClearedPlaceholder.value
    : secretState.value.OPENCLAW_AUTH_PASSWORD_SET
    ? secretConfiguredPlaceholder.value
    : t('pages.settings.openclawPasswordPlaceholder')
))

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
      const loadedConfig = applyLoadedConfig(data.config)
      configForm.value = loadedConfig.form
      secretState.value = loadedConfig.secretState
      secretClearForm.value = loadedConfig.clearForm
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
      body: JSON.stringify(buildConfigPayload(configForm.value, secretClearForm.value)),
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
              :disabled="secretClearForm.AUTH_PASSWORD_CLEAR"
              show-password-on="click"
              :placeholder="authPasswordPlaceholder"
            />
            <NCheckbox
              v-if="secretState.AUTH_PASSWORD_SET"
              v-model:checked="secretClearForm.AUTH_PASSWORD_CLEAR"
              style="margin-top: 8px;"
            >
              {{ t('pages.settings.clearSavedSecret') }}
            </NCheckbox>
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
              :disabled="secretClearForm.OPENCLAW_AUTH_TOKEN_CLEAR"
              show-password-on="click"
              :placeholder="openClawTokenPlaceholder"
            />
            <NCheckbox
              v-if="secretState.OPENCLAW_AUTH_TOKEN_SET"
              v-model:checked="secretClearForm.OPENCLAW_AUTH_TOKEN_CLEAR"
              style="margin-top: 8px;"
            >
              {{ t('pages.settings.clearSavedSecret') }}
            </NCheckbox>
          </NFormItem>
          
          <NFormItem :label="t('pages.settings.openclawPassword')">
            <NInput
              v-model:value="configForm.OPENCLAW_AUTH_PASSWORD"
              type="password"
              :disabled="secretClearForm.OPENCLAW_AUTH_PASSWORD_CLEAR"
              show-password-on="click"
              :placeholder="openClawPasswordPlaceholder"
            />
            <NCheckbox
              v-if="secretState.OPENCLAW_AUTH_PASSWORD_SET"
              v-model:checked="secretClearForm.OPENCLAW_AUTH_PASSWORD_CLEAR"
              style="margin-top: 8px;"
            >
              {{ t('pages.settings.clearSavedSecret') }}
            </NCheckbox>
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
