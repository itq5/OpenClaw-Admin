import { ref, watch } from 'vue'

export interface TTSSettings {
  enabled: boolean
  autoPlay: boolean
  voice: string
  rate: number
  volume: number
  pitch: number
}

const STORAGE_KEY = 'tts-settings'

function getEnvDefault<T>(key: string, defaultValue: T, parser?: (val: string) => T): T {
  const envValue = import.meta.env[key]
  if (envValue !== undefined && envValue !== '') {
    if (parser) {
      try {
        return parser(envValue)
      } catch {
        return defaultValue
      }
    }
    return envValue as T
  }
  return defaultValue
}

const defaultSettings: TTSSettings = {
  enabled: getEnvDefault('VITE_TTS_ENABLED', true, (v) => v === 'true'),
  autoPlay: getEnvDefault('VITE_TTS_AUTO_PLAY', false, (v) => v === 'true'),
  voice: getEnvDefault('VITE_TTS_VOICE', 'zh-CN'),
  rate: getEnvDefault('VITE_TTS_RATE', 1.0, parseFloat),
  volume: getEnvDefault('VITE_TTS_VOLUME', 1.0, parseFloat),
  pitch: getEnvDefault('VITE_TTS_PITCH', 1.0, parseFloat),
}

function loadSettings(): TTSSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return {
        ...defaultSettings,
        ...parsed,
      }
    }
  } catch (e) {
    console.warn('[TTSSettings] Failed to load settings from localStorage:', e)
  }
  return { ...defaultSettings }
}

function saveSettings(settings: TTSSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (e) {
    console.warn('[TTSSettings] Failed to save settings to localStorage:', e)
  }
}

const settings = ref<TTSSettings>(loadSettings())

watch(settings, (newSettings) => {
  saveSettings(newSettings)
}, { deep: true })

export function useTTSSettings() {
  function updateSettings(newSettings: Partial<TTSSettings>) {
    settings.value = {
      ...settings.value,
      ...newSettings,
    }
  }

  function resetSettings() {
    settings.value = { ...defaultSettings }
  }

  function getSettings(): TTSSettings {
    return { ...settings.value }
  }

  return {
    settings,
    updateSettings,
    resetSettings,
    getSettings,
  }
}
