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
  NSwitch,
  NSlider,
  NInputNumber,
  NDivider,
  useMessage,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useThemeStore, type ThemeMode } from '@/stores/theme'
import { useWebSocketStore } from '@/stores/websocket'
import { useAuthStore } from '@/stores/auth'
import { useTTSSettings } from '@/composables/useTTSSettings'
import { useEdgeTTS } from '@/composables/useEdgeTTS'
import { ConnectionState } from '@/api/types'
import {
  VolumeHighOutline,
  StopOutline,
} from '@vicons/ionicons5'
import { NIcon } from 'naive-ui'

const themeStore = useThemeStore()
const wsStore = useWebSocketStore()
const authStore = useAuthStore()
const { t } = useI18n()
const message = useMessage()
const appTitle = import.meta.env.VITE_APP_TITLE || 'OpenClaw Admin'
const appVersion = import.meta.env.VITE_APP_VERSION || ''

const loading = ref(false)
const saving = ref(false)
const configForm = ref({
  AUTH_USERNAME: '',
  AUTH_PASSWORD: '',
  OPENCLAW_WS_URL: '',
  OPENCLAW_AUTH_TOKEN: '',
  OPENCLAW_AUTH_PASSWORD: '', // Gateway 密码认证
})

// TTS settings
const { settings: ttsSettings, resetSettings: resetTTSSettings, updateSettings: updateTTSSettings } = useTTSSettings()
const ttsVoices = ref<{ label: string; value: string; lang?: string }[]>([])
const ttsLoading = ref(false)
const ttsSaving = ref(false)
const ttsPreviewText = ref('你好，这是一个语音测试。')
const { speak: ttsSpeak, stop: ttsStop, isPlaying: ttsIsPlaying, isLoading: ttsIsLoading } = useEdgeTTS()

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

// ---- TTS Settings ----

async function loadTTSSettings() {
  ttsLoading.value = true
  try {
    // Load available voices - need to handle async loading
    let voices = window.speechSynthesis.getVoices()
    
    // If voices are not loaded yet, wait for voiceschanged event
    if (voices.length === 0) {
      await new Promise<void>((resolve) => {
        const handleVoicesChanged = () => {
          window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged)
          resolve()
        }
        window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged)
        // Also set a timeout in case the event never fires
        setTimeout(() => {
          window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged)
          resolve()
        }, 2000)
      })
      voices = window.speechSynthesis.getVoices()
    }
    
    const voiceOptions: { label: string; value: string; lang?: string }[] = []
    
    // Group voices by language
    const langGroups = new Map<string, SpeechSynthesisVoice[]>()
    for (const voice of voices) {
      const lang = voice.lang.split('-')[0] || 'other'
      if (!langGroups.has(lang)) {
        langGroups.set(lang, [])
      }
      langGroups.get(lang)!.push(voice)
    }
    
    // Add Chinese voices first
    const chineseVoices = langGroups.get('zh') || []
    for (const v of chineseVoices) {
      voiceOptions.push({
        label: `${v.name} (${v.lang})`,
        value: v.name,
        lang: v.lang,
      })
    }
    
    // Add English voices second
    const englishVoices = langGroups.get('en') || []
    for (const v of englishVoices) {
      voiceOptions.push({
        label: `${v.name} (${v.lang})`,
        value: v.name,
        lang: v.lang,
      })
    }
    
    // Add other voices
    for (const [lang, voiceList] of langGroups) {
      if (lang === 'zh' || lang === 'en') continue
      for (const v of voiceList) {
        voiceOptions.push({
          label: `${v.name} (${v.lang})`,
          value: v.name,
          lang: v.lang,
        })
      }
    }
    
    ttsVoices.value = voiceOptions
  } catch (err) {
    console.error('[SettingsPage] Failed to load TTS settings:', err)
  } finally {
    ttsLoading.value = false
  }
}

async function handlePreviewTTS() {
  if (ttsIsPlaying.value || ttsIsLoading.value) {
    ttsStop()
    return
  }
  
  try {
    await ttsSpeak(ttsPreviewText.value, {
      voice: ttsSettings.value.voice,
      rate: ttsSettings.value.rate,
      volume: ttsSettings.value.volume,
      pitch: ttsSettings.value.pitch,
    })
  } catch (err) {
    console.error('[SettingsPage] TTS preview error:', err)
    message.error(t('pages.settings.tts.previewFailed'))
  }
}

async function handleSaveTTS() {
  ttsSaving.value = true
  try {
    await new Promise(resolve => setTimeout(resolve, 300))
    message.success(t('pages.settings.tts.saveSuccess'))
  } finally {
    ttsSaving.value = false
  }
}

function handleResetTTS() {
  resetTTSSettings()
  message.success(t('pages.settings.tts.resetSuccess'))
}

onMounted(() => {
  loadConfig()
  loadTTSSettings()
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

    <!-- TTS Settings -->
    <NCard :title="t('pages.settings.tts.title')" class="app-card">
      <NSpin :show="ttsLoading">
        <NSpace vertical :size="16">
          <NAlert type="info" :bordered="false">
            {{ t('pages.settings.tts.hint') }}
          </NAlert>

          <!-- Enable TTS -->
          <div>
            <NSpace align="center" :size="12">
              <NSwitch v-model:value="ttsSettings.enabled" />
              <NText>{{ t('pages.settings.tts.enable') }}</NText>
            </NSpace>
          </div>

          <NDivider style="margin: 0;" />

          <!-- Auto Play -->
          <div>
            <NText strong style="display: block; margin-bottom: 4px;">{{ t('pages.settings.tts.autoPlay') }}</NText>
            <NText depth="3" style="font-size: 13px; display: block; margin-bottom: 8px;">
              {{ t('pages.settings.tts.autoPlayHint') }}
            </NText>
            <NSpace align="center" :size="12">
              <NSwitch v-model:value="ttsSettings.autoPlay" />
            </NSpace>
          </div>

          <NDivider style="margin: 0;" />

          <!-- Voice Selection -->
          <div>
            <NText strong style="display: block; margin-bottom: 4px;">{{ t('pages.settings.tts.voice') }}</NText>
            <NText depth="3" style="font-size: 13px; display: block; margin-bottom: 8px;">
              {{ t('pages.settings.tts.voiceHint') }}
            </NText>
            <NSelect
              v-model:value="ttsSettings.voice"
              :options="ttsVoices"
              :placeholder="t('pages.settings.tts.voicePlaceholder')"
              filterable
              clearable
              style="max-width: 400px;"
            />
          </div>

          <NDivider style="margin: 0;" />

          <!-- Rate -->
          <div>
            <NText strong style="display: block; margin-bottom: 4px;">{{ t('pages.settings.tts.rate') }}</NText>
            <NText depth="3" style="font-size: 13px; display: block; margin-bottom: 8px;">
              {{ t('pages.settings.tts.rateHint') }}
            </NText>
            <div style="max-width: 400px; display: flex; align-items: center; gap: 16px;">
              <NSlider
                v-model:value="ttsSettings.rate"
                :min="0.1"
                :max="2.0"
                :step="0.1"
                :tooltip="true"
                :format-tooltip="(value: number) => `${value.toFixed(1)}x`"
                style="flex: 1;"
              />
              <NInputNumber
                v-model:value="ttsSettings.rate"
                :min="0.1"
                :max="2.0"
                :step="0.1"
                size="small"
                style="width: 80px;"
              >
                <template #suffix>x</template>
              </NInputNumber>
            </div>
          </div>

          <NDivider style="margin: 0;" />

          <!-- Volume -->
          <div>
            <NText strong style="display: block; margin-bottom: 4px;">{{ t('pages.settings.tts.volume') }}</NText>
            <NText depth="3" style="font-size: 13px; display: block; margin-bottom: 8px;">
              {{ t('pages.settings.tts.volumeHint') }}
            </NText>
            <div style="max-width: 400px; display: flex; align-items: center; gap: 16px;">
              <NSlider
                v-model:value="ttsSettings.volume"
                :min="0"
                :max="1"
                :step="0.1"
                :tooltip="true"
                :format-tooltip="(value: number) => `${Math.round(value * 100)}%`"
                style="flex: 1;"
              />
              <NInputNumber
                v-model:value="ttsSettings.volume"
                :min="0"
                :max="1"
                :step="0.1"
                size="small"
                style="width: 80px;"
              />
            </div>
          </div>

          <NDivider style="margin: 0;" />

          <!-- Pitch -->
          <div>
            <NText strong style="display: block; margin-bottom: 4px;">{{ t('pages.settings.tts.pitch') }}</NText>
            <NText depth="3" style="font-size: 13px; display: block; margin-bottom: 8px;">
              {{ t('pages.settings.tts.pitchHint') }}
            </NText>
            <div style="max-width: 400px; display: flex; align-items: center; gap: 16px;">
              <NSlider
                v-model:value="ttsSettings.pitch"
                :min="0.1"
                :max="2.0"
                :step="0.1"
                :tooltip="true"
                :format-tooltip="(value: number) => value.toFixed(1)"
                style="flex: 1;"
              />
              <NInputNumber
                v-model:value="ttsSettings.pitch"
                :min="0.1"
                :max="2.0"
                :step="0.1"
                size="small"
                style="width: 80px;"
              />
            </div>
          </div>

          <NDivider style="margin: 0;" />

          <!-- Preview -->
          <div>
            <NText strong style="display: block; margin-bottom: 4px;">{{ t('pages.settings.tts.preview') }}</NText>
            <NText depth="3" style="font-size: 13px; display: block; margin-bottom: 8px;">
              {{ t('pages.settings.tts.previewHint') }}
            </NText>
            <NSpace :size="12" align="center" style="max-width: 400px;">
              <NInput
                v-model:value="ttsPreviewText"
                :placeholder="t('pages.settings.tts.previewPlaceholder')"
                style="flex: 1;"
              />
              <NButton
                :type="ttsIsPlaying || ttsIsLoading ? 'error' : 'primary'"
                :loading="ttsIsLoading && !ttsIsPlaying"
                @click="handlePreviewTTS"
              >
                <template #icon>
                  <NIcon :component="ttsIsPlaying || ttsIsLoading ? StopOutline : VolumeHighOutline" />
                </template>
                {{ ttsIsPlaying ? t('pages.settings.tts.stop') : t('pages.settings.tts.play') }}
              </NButton>
            </NSpace>
          </div>

          <NDivider style="margin: 0;" />

          <!-- Actions -->
          <NSpace :size="8">
            <NButton type="primary" :loading="ttsSaving" @click="handleSaveTTS">
              {{ t('common.save') }}
            </NButton>
            <NButton @click="handleResetTTS">
              {{ t('common.reset') }}
            </NButton>
          </NSpace>
        </NSpace>
      </NSpin>
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
