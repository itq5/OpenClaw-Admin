import { ref, onUnmounted } from 'vue'

export interface UseEdgeTTSOptions {
  voice?: string
  rate?: number
  volume?: number
  pitch?: number
}

export interface TTSVoice {
  name: string
  label: string
  lang?: string
}

export function useEdgeTTS(options: UseEdgeTTSOptions = {}) {
  const isPlaying = ref(false)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const currentText = ref<string | null>(null)
  const voices = ref<SpeechSynthesisVoice[]>([])

  let currentUtterance: SpeechSynthesisUtterance | null = null

  const defaultVoice = options.voice || ''
  const defaultRate = options.rate ?? 1.0
  const defaultVolume = options.volume ?? 1.0
  const defaultPitch = options.pitch ?? 1.0

  function loadVoices(): SpeechSynthesisVoice[] {
    const availableVoices = window.speechSynthesis.getVoices()
    voices.value = availableVoices
    return availableVoices
  }

  function getVoices(): SpeechSynthesisVoice[] {
    return loadVoices()
  }

  function findVoice(voiceName: string): SpeechSynthesisVoice | null {
    const availableVoices = loadVoices()
    
    // 首先尝试精确匹配
    let voice = availableVoices.find(v => v.name === voiceName)
    if (voice) return voice
    
    // 尝试匹配语音名称的一部分
    voice = availableVoices.find(v => v.name.includes(voiceName))
    if (voice) return voice
    
    // 根据语言匹配
    const langMatch = voiceName.match(/^(\w{2}-\w{2})/)
    if (langMatch && langMatch[1]) {
      const lang = langMatch[1]
      voice = availableVoices.find(v => v.lang && v.lang.startsWith(lang))
      if (voice) return voice
    }
    
    return null
  }

  function stop() {
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel()
    }
    currentUtterance = null
    isPlaying.value = false
    isLoading.value = false
    currentText.value = null
  }

  async function speak(text: string, voiceOptions?: UseEdgeTTSOptions): Promise<void> {
    if (!text.trim()) {
      return
    }

    stop()

    return new Promise((resolve, reject) => {
      try {
        isLoading.value = true
        currentText.value = text
        error.value = null

        // 确保语音列表已加载
        let availableVoices = loadVoices()
        if (availableVoices.length === 0) {
          // 某些浏览器需要等待 voiceschanged 事件
          window.speechSynthesis.onvoiceschanged = () => {
            availableVoices = loadVoices()
            performSpeak(text, voiceOptions, availableVoices, resolve, reject)
          }
          return
        }

        performSpeak(text, voiceOptions, availableVoices, resolve, reject)
      } catch (err) {
        console.error('[WebSpeechTTS] Error:', err)
        isLoading.value = false
        error.value = err instanceof Error ? err.message : 'Unknown error'
        reject(err)
      }
    })
  }

  function performSpeak(
    text: string,
    voiceOptions: UseEdgeTTSOptions | undefined,
    availableVoices: SpeechSynthesisVoice[],
    resolve: () => void,
    reject: (reason: Error) => void
  ) {
    const utterance = new SpeechSynthesisUtterance(text)
    currentUtterance = utterance

    // 设置语音
    const voiceName = voiceOptions?.voice || defaultVoice
    if (voiceName) {
      const voice = findVoice(voiceName)
      if (voice) {
        utterance.voice = voice
        console.log('[WebSpeechTTS] Using voice:', voice.name, '(' + voice.lang + ')')
      } else {
        console.warn('[WebSpeechTTS] Voice not found:', voiceName, ', using default')
      }
    }

    // 设置参数
    utterance.rate = voiceOptions?.rate ?? defaultRate
    utterance.volume = voiceOptions?.volume ?? defaultVolume
    utterance.pitch = voiceOptions?.pitch ?? defaultPitch

    console.log('[WebSpeechTTS] Speaking:', text.substring(0, 50) + '...')

    utterance.onstart = () => {
      isLoading.value = false
      isPlaying.value = true
      console.log('[WebSpeechTTS] Speech started')
    }

    utterance.onend = () => {
      isPlaying.value = false
      currentText.value = null
      currentUtterance = null
      console.log('[WebSpeechTTS] Speech ended')
      resolve()
    }

    utterance.onerror = (event) => {
      console.error('[WebSpeechTTS] Speech error:', event.error)
      isPlaying.value = false
      isLoading.value = false
      error.value = event.error
      currentUtterance = null
      reject(new Error(event.error))
    }

    utterance.onpause = () => {
      isPlaying.value = false
    }

    utterance.onresume = () => {
      isPlaying.value = true
    }

    // 开始播放
    window.speechSynthesis.speak(utterance)
  }

  // 初始化时加载语音列表
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    loadVoices()
    window.speechSynthesis.onvoiceschanged = loadVoices
  }

  onUnmounted(() => {
    stop()
  })

  return {
    isPlaying,
    isLoading,
    error,
    currentText,
    voices,
    speak,
    stop,
    getVoices,
  }
}

// 中文语音映射（Web Speech API 语音名称因浏览器而异）
export const CHINESE_VOICES: TTSVoice[] = [
  { name: 'zh-CN', label: '中文（简体）' },
  { name: 'zh-CN-XiaoxiaoNeural', label: '晓晓（女声）- Edge' },
  { name: 'zh-CN-YunxiNeural', label: '云希（男声）- Edge' },
  { name: 'Microsoft Huihui', label: '惠惠（女声）- Windows' },
  { name: 'Microsoft Kangkang', label: '康康（男声）- Windows' },
  { name: 'Ting-Ting', label: '婷婷（女声）- macOS' },
]

export const ENGLISH_VOICES: TTSVoice[] = [
  { name: 'en-US', label: 'English (US)' },
  { name: 'en-GB', label: 'English (UK)' },
  { name: 'Microsoft David', label: 'David (Male) - Windows' },
  { name: 'Microsoft Zira', label: 'Zira (Female) - Windows' },
  { name: 'Samantha', label: 'Samantha (Female) - macOS' },
  { name: 'Alex', label: 'Alex (Male) - macOS' },
]
