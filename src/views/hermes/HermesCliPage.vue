<script setup lang="ts">
import { computed, h, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NIcon,
  NSpace,
  NTag,
  NText,
  NSpin,
  NInput,
  NSelect,
  NSwitch,
  NInputNumber,
  NDynamicTags,
  NCollapse,
  NCollapseItem,
  NTooltip,
  NPopconfirm,
  NEmpty,
  NDivider,
  useMessage,
} from 'naive-ui'
import {
  PlayOutline,
  StopOutline,
  ExpandOutline,
  ContractOutline,
  RefreshOutline,
  AddOutline,
  LinkOutline,
  TrashOutline,
  CreateOutline,
  LogOutOutline,
  EllipseOutline,
} from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useHermesCliStore, type HermesCliSessionInfo } from '@/stores/hermes-cli'
import { useHermesConnectionStore } from '@/stores/hermes/connection'
import { useHermesModelStore } from '@/stores/hermes/model'
import { useHermesConfigStore } from '@/stores/hermes/config'

const message = useMessage()
const { t } = useI18n()
const hermesCliStore = useHermesCliStore()
const hermesModelStore = useHermesModelStore()
const hermesConfigStore = useHermesConfigStore()

const terminalContainerRef = ref<HTMLDivElement | null>(null)
const isFullscreen = ref(false)
const showFullscreenHint = ref(false)
const terminalLoading = ref(true)
const terminalError = ref<string | null>(null)

const terminal = shallowRef<any>(null)
const fitAddon = shallowRef<any>(null)
const resizeObserver = shallowRef<ResizeObserver | null>(null)

const showLaunchConfig = ref(true)

const launchConfigExpandedNames = computed<string[]>(() =>
  showLaunchConfig.value ? ['launch-config'] : [],
)

function onLaunchConfigChange(names: string[]) {
  showLaunchConfig.value = names.includes('launch-config')
}
const launchConfig = ref({
  model: null as string | null,
  skills: [] as string[],
  toolsets: '',
  resumeSession: '',
  yolo: false,
  checkpoints: false,
  maxTurns: null as number | null,
  verbose: false,
  quiet: false,
  source: '',
})

const modelOptions = computed(() => {
  const options = [{ label: 'auto (默认)', value: 'auto' }]
  for (const model of hermesModelStore.allSelectableModels) {
    options.push({
      label: model.label,
      value: model.modelId,
    })
  }
  return options
})



function buildCliArgs(): string[] {
  if (launchConfig.value.resumeSession) {
    return ['--tui', '-r', launchConfig.value.resumeSession]
  }
  
  const args: string[] = ['chat', '--tui']
  if (launchConfig.value.model && launchConfig.value.model !== 'auto') {
    args.push('--model', launchConfig.value.model)
  }
  for (const skill of launchConfig.value.skills) {
    args.push('-s', skill)
  }
  if (launchConfig.value.toolsets) {
    args.push('-t', launchConfig.value.toolsets)
  }
  if (launchConfig.value.yolo) {
    args.push('--yolo')
  }
  if (launchConfig.value.checkpoints) {
    args.push('--checkpoints')
  }
  if (launchConfig.value.maxTurns !== null) {
    args.push('--max-turns', String(launchConfig.value.maxTurns))
  }
  if (launchConfig.value.verbose) {
    args.push('-v')
  }
  if (launchConfig.value.quiet) {
    args.push('-Q')
  }
  if (launchConfig.value.source) {
    args.push('--source', launchConfig.value.source)
  }
  return args
}

const editingSessionId = ref<string | null>(null)
const editingSessionName = ref('')

const hermesSessions = ref<Array<{ id?: string; session_id?: string; title?: string; model?: string; preview?: string; started_at?: number; last_active?: number }>>([])
const hermesSessionsLoading = ref(false)
const hermesConnectionStore = useHermesConnectionStore()

async function fetchHermesSessions() {
  hermesSessionsLoading.value = true
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    const apiKey = hermesConnectionStore.connectionConfig.apiKey
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    const response = await fetch('/api/hermes/sessions', { headers })
    if (response.ok) {
      const data = await response.json()
      const rawSessions = Array.isArray(data) ? data : (data.sessions || [])
      console.log('[HermesCliPage] Fetched sessions:', rawSessions.slice(0, 3))
      hermesSessions.value = rawSessions
    }
  } catch (error) {
    console.error('[HermesCliPage] fetchHermesSessions failed:', error)
  } finally {
    hermesSessionsLoading.value = false
  }
}

function formatSessionTime(timestamp?: number): string {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  
  if (diffDays === 0) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } else if (diffDays === 1) {
    return '昨天'
  } else if (diffDays < 7) {
    return `${diffDays}天前`
  } else {
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }
}

const hermesSessionOptions = computed(() => {
  return hermesSessions.value.map(s => {
    const sessionId = s.session_id || s.id || ''
    const parts: string[] = []
    
    parts.push(`[${sessionId}]`)
    
    if (s.title) {
      parts.push(s.title)
    } else if (s.preview) {
      parts.push(s.preview)
    }
    
    const meta: string[] = []
    if (s.model) {
      meta.push(s.model)
    }
    const timeStr = formatSessionTime(s.last_active || s.started_at)
    if (timeStr) {
      meta.push(timeStr)
    }
    if (meta.length > 0) {
      parts.push(`(${meta.join(' · ')})`)
    }
    
    const fullLabel = parts.join(' ')
    
    const displayParts: string[] = []
    displayParts.push(`[${sessionId.slice(0, 12)}]`)
    
    if (s.title) {
      displayParts.push(s.title)
    } else if (s.preview) {
      displayParts.push(s.preview.slice(0, 25) + (s.preview.length > 25 ? '...' : ''))
    }
    
    if (meta.length > 0) {
      displayParts.push(`(${meta.join(' · ')})`)
    }
    
    return {
      label: displayParts.join(' '),
      value: sessionId,
      fullLabel,
    }
  })
})

function renderSessionLabel(option: { label: string; value: string; fullLabel?: string }) {
  return h('span', { title: option.fullLabel || option.label }, option.label)
}

const connectedSessions = computed(() =>
  hermesCliStore.sessions.filter(s => s.status === 'connected'),
)

const backgroundSessions = computed(() =>
  hermesCliStore.sessions.filter(s => s.status === 'running'),
)

const connectionTagType = computed<'success' | 'warning' | 'error' | 'default'>(() => {
  if (hermesCliStore.isConnected) return 'success'
  if (hermesCliStore.isConnecting) return 'warning'
  if (hermesCliStore.error) return 'error'
  return 'default'
})

const connectionLabel = computed(() => {
  if (hermesCliStore.isConnected) return t('pages.hermesCli.connected')
  if (hermesCliStore.isConnecting) return t('pages.hermesCli.connecting')
  if (hermesCliStore.error) return t('pages.hermesCli.error')
  return t('pages.hermesCli.disconnected')
})

function getSessionDisplayName(session: HermesCliSessionInfo): string {
  return session.name || session.id.slice(0, 8) + '...'
}

function isCurrentSession(session: HermesCliSessionInfo): boolean {
  return hermesCliStore.currentSession?.id === session.id
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString(undefined, { timeZone: 'Asia/Shanghai' })
}

async function initTerminal() {
  if (!terminalContainerRef.value) return

  terminalLoading.value = true
  terminalError.value = null

  try {
    const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/addon-web-links'),
    ])

    if (terminal.value) {
      terminal.value.dispose()
    }

    terminal.value = new Terminal({
      fontSize: 14,
      fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', monospace",
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      allowTransparency: true,
      cols: 120,
      rows: 36,
    })

    fitAddon.value = new FitAddon()
    terminal.value.loadAddon(fitAddon.value)
    terminal.value.loadAddon(new WebLinksAddon())

    terminal.value.open(terminalContainerRef.value)

    setTimeout(() => {
      fitAddon.value?.fit()
    }, 100)

    terminal.value.onData((data: string) => {
      if (data === '\x1b' && isFullscreen.value) {
        isFullscreen.value = false
        return
      }
      if (hermesCliStore.isConnected) {
        hermesCliStore.sendInput(data)
      }
    })

    terminal.value.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      if (hermesCliStore.isConnected) {
        hermesCliStore.resize(cols, rows)
      }
    })

    terminal.value.onSelectionChange(() => {
      const selection = terminal.value?.getSelection()
      if (selection) {
        navigator.clipboard.writeText(selection).then(() => {
          message.success(t('pages.hermesCli.copied'), { duration: 1500 })
        }).catch(() => {
          // Ignore copy errors
        })
      }
    })

    hermesCliStore.onOutput((data: string) => {
      if (terminal.value) {
        terminal.value.write(data)
      }
    })

    hermesCliStore.onConnected((sessionId: string) => {
      if (hermesCliStore.isReconnect) {
        terminal.value?.write('\x1b[32m\x1b[1mReconnected to Hermes CLI\x1b[0m\r\n')
      } else {
        terminal.value?.write('\x1b[32m\x1b[1mConnected to Hermes CLI\x1b[0m\r\n')
      }
      const name = hermesCliStore.currentSession?.name
      if (name) {
        terminal.value?.write(`\x1b[36mSession: ${name}\x1b[0m\r\n`)
      } else {
        terminal.value?.write(`\x1b[36mSession: ${sessionId.slice(0, 8)}...\x1b[0m\r\n`)
      }
      terminal.value?.write('\r\n')
    })

    hermesCliStore.onDisconnected(() => {
      terminal.value?.write('\r\n\x1b[33mConnection closed (process still running in background)\x1b[0m\r\n')
    })

    terminalContainerRef.value.addEventListener('contextmenu', async (e: MouseEvent) => {
      e.preventDefault()
      if (!hermesCliStore.isConnected) return

      try {
        const text = await navigator.clipboard.readText()
        if (text) {
          hermesCliStore.sendInput(text)
          message.success(t('pages.hermesCli.pasted'), { duration: 1500 })
        }
      } catch {
        // Ignore paste errors
      }
    })

    resizeObserver.value = new ResizeObserver(() => {
      fitAddon.value?.fit()
    })
    resizeObserver.value.observe(terminalContainerRef.value)

    terminalLoading.value = false
  } catch (e) {
    terminalLoading.value = false
    terminalError.value = e instanceof Error ? e.message : 'Failed to initialize terminal'
    console.error('Hermes CLI terminal init error:', e)
  }
}

async function handleNewSession() {
  if (!showLaunchConfig.value) {
    showLaunchConfig.value = true
    return
  }

  terminal.value?.clear()
  terminal.value?.write('\x1b[33mLaunching new session...\x1b[0m\r\n')

  const args = buildCliArgs()
  try {
    await hermesCliStore.connectNew(args, 120, 36)
  } catch {
    terminal.value?.write('\x1b[31mFailed to launch session\x1b[0m\r\n')
  }
}

async function handleReconnectSession(session: HermesCliSessionInfo) {
  if (isCurrentSession(session) && hermesCliStore.isConnected) {
    return
  }

  terminal.value?.clear()
  terminal.value?.write('\x1b[33mReconnecting to session...\x1b[0m\r\n')

  try {
    await hermesCliStore.connect(120, 36, session.id)
  } catch {
    terminal.value?.write('\x1b[31mFailed to reconnect\x1b[0m\r\n')
  }
}

async function handleDetach() {
  hermesCliStore.detach()
  message.info(t('pages.hermesCli.detachHint'), { duration: 3000 })
}

async function handleDestroy() {
  await hermesCliStore.destroy()
  terminal.value?.clear()
}

function handleConnect() {
  if (hermesCliStore.isConnected) {
    handleDetach()
  } else if (hermesCliStore.currentSession) {
    handleReconnectSession({ id: hermesCliStore.currentSession.id, name: hermesCliStore.currentSession.name || null, args: [], createdAt: 0, lastHeartbeat: 0, status: 'running' })
  } else {
    handleNewSession()
  }
}

function handleClear() {
  terminal.value?.clear()
}

function handleFullscreen() {
  isFullscreen.value = !isFullscreen.value

  if (isFullscreen.value) {
    showFullscreenHint.value = true
    setTimeout(() => {
      showFullscreenHint.value = false
    }, 3000)
  }

  nextTick(() => {
    setTimeout(() => {
      fitAddon.value?.fit()
    }, 100)
  })
}

function handleTerminalResize() {
  fitAddon.value?.fit()
}

watch(isFullscreen, () => {
  nextTick(() => {
    setTimeout(() => {
      fitAddon.value?.fit()
    }, 100)
  })
})

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isFullscreen.value) {
    isFullscreen.value = false
  }
}

function startEditSession(session: HermesCliSessionInfo) {
  editingSessionId.value = session.id
  editingSessionName.value = session.name || ''
}

async function confirmRenameSession() {
  if (editingSessionId.value && editingSessionName.value.trim()) {
    const ok = await hermesCliStore.renameSession(editingSessionId.value, editingSessionName.value.trim())
    if (ok) {
      message.success(t('common.saveSuccess') || 'Saved')
    }
  }
  editingSessionId.value = null
  editingSessionName.value = ''
}

function cancelEditSession() {
  editingSessionId.value = null
  editingSessionName.value = ''
}

async function handleDestroySession(session: HermesCliSessionInfo) {
  try {
    const authStore = await import('@/stores/auth').then(m => m.useAuthStore())
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = authStore.getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`

    await fetch('/api/hermes-cli/destroy', {
      method: 'POST',
      headers,
      body: JSON.stringify({ sessionId: session.id }),
    })

    if (isCurrentSession(session)) {
      hermesCliStore.disconnect()
      terminal.value?.clear()
    }

    hermesCliStore.fetchSessions()
  } catch {
    // Ignore
  }
}

onMounted(async () => {
  await initTerminal()
  window.addEventListener('resize', handleTerminalResize)
  window.addEventListener('keydown', handleKeyDown)

  // 使用 allSettled 避免连接失败时中断其他操作
  await Promise.allSettled([
    hermesCliStore.fetchSessions(),
    fetchHermesSessions(),
    hermesModelStore.fetchModels(),
    hermesModelStore.fetchEnvVars(),
    hermesConfigStore.fetchConfig(),
  ])

  if (hermesCliStore.sessions.length > 0) {
    const lastSession = hermesCliStore.sessions[hermesCliStore.sessions.length - 1]!
    if (lastSession.status === 'running') {
      try {
        await hermesCliStore.connect(120, 36, lastSession.id!)
      } catch {
        // Fall through
      }
    }
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', handleTerminalResize)
  window.removeEventListener('keydown', handleKeyDown)
  if (resizeObserver.value) {
    resizeObserver.value.disconnect()
  }
  if (hermesCliStore.isConnected) {
    hermesCliStore.detach()
  }
  if (terminal.value) {
    terminal.value.dispose()
  }
})
</script>

<template>
  <div class="hermes-cli-layout">
    <div class="hermes-cli-layout__left">
      <div class="left-panel-scroll">
        <NCard :title="t('pages.hermesCli.runningSessions')" class="app-card left-panel-card" size="small">
          <template #header-extra>
            <NButton
              type="primary"
              size="small"
              class="app-toolbar-btn"
              @click="handleNewSession"
            >
              <template #icon><NIcon :component="AddOutline" /></template>
              {{ t('pages.hermesCli.newSession') }}
            </NButton>
          </template>

          <div v-if="hermesCliStore.sessions.length === 0" style="padding: 8px 0;">
            <NEmpty :description="t('pages.hermesCli.noSessionsHint')" size="small" />
          </div>

          <template v-else>
            <template v-if="connectedSessions.length > 0">
              <NText depth="3" style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
                {{ t('pages.hermesCli.connectedSessions') }} ({{ connectedSessions.length }})
              </NText>
              <div style="margin-top: 6px;">
                <NTooltip
                  v-for="session in connectedSessions"
                  :key="session.id"
                  trigger="hover"
                  placement="right"
                >
                  <template #trigger>
                    <div
                      class="session-item session-item--active"
                      :class="{ 'session-item--current': isCurrentSession(session) }"
                    >
                      <div class="session-item__info">
                        <span class="status-indicator status-indicator--connected">
                          <NIcon :component="EllipseOutline" size="10" />
                        </span>
                        <template v-if="editingSessionId === session.id">
                          <NInput
                            v-model:value="editingSessionName"
                            size="tiny"
                            style="width: 120px; margin-right: 4px;"
                            @keyup.enter="confirmRenameSession"
                            @keyup.escape="cancelEditSession"
                          />
                          <NButton size="tiny" type="primary" quaternary @click="confirmRenameSession">
                            {{ t('common.confirm') }}
                          </NButton>
                          <NButton size="tiny" quaternary @click="cancelEditSession">
                            {{ t('common.cancel') }}
                          </NButton>
                        </template>
                        <template v-else>
                          <NText strong style="font-size: 13px;">{{ getSessionDisplayName(session) }}</NText>
                          <NButton
                            size="tiny"
                            quaternary
                            style="margin-left: 4px;"
                            @click.stop="startEditSession(session)"
                          >
                            <template #icon><NIcon :component="CreateOutline" /></template>
                          </NButton>
                        </template>
                      </div>
                      <div class="session-item__actions">
                        <NTooltip trigger="hover">
                          <template #trigger>
                            <NButton size="tiny" quaternary @click.stop="handleDetach">
                              <template #icon><NIcon :component="LogOutOutline" /></template>
                            </NButton>
                          </template>
                          {{ t('pages.hermesCli.detachHint') || '断开连接，会话继续在后台运行' }}
                        </NTooltip>
                        <NPopconfirm @positive-click="handleDestroySession(session)">
                          <template #trigger>
                            <NButton size="tiny" quaternary type="error" @click.stop>
                              <template #icon><NIcon :component="TrashOutline" /></template>
                            </NButton>
                          </template>
                          {{ t('pages.hermesCli.destroyConfirm') || '确定终止此会话？进程将被结束。' }}
                        </NPopconfirm>
                      </div>
                    </div>
                  </template>
                  {{ t('pages.hermesCli.connectedStatusHint') || '已连接 - 当前正在与此会话交互' }}
                </NTooltip>
              </div>
            </template>

            <template v-if="backgroundSessions.length > 0">
              <NDivider v-if="connectedSessions.length > 0" style="margin: 8px 0;" />
              <NText depth="3" style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
                {{ t('pages.hermesCli.backgroundSessions') }} ({{ backgroundSessions.length }})
              </NText>
              <div style="margin-top: 6px;">
                <NTooltip
                  v-for="session in backgroundSessions"
                  :key="session.id"
                  trigger="hover"
                  placement="right"
                >
                  <template #trigger>
                    <div
                      class="session-item session-item--background"
                      @click="handleReconnectSession(session)"
                    >
                      <div class="session-item__info">
                        <span class="status-indicator status-indicator--background">
                          <NIcon :component="EllipseOutline" size="10" />
                        </span>
                        <template v-if="editingSessionId === session.id">
                          <NInput
                            v-model:value="editingSessionName"
                            size="tiny"
                            style="width: 120px; margin-right: 4px;"
                            @keyup.enter="confirmRenameSession"
                            @keyup.escape="cancelEditSession"
                            @click.stop
                          />
                          <NButton size="tiny" type="primary" quaternary @click.stop="confirmRenameSession">
                            {{ t('common.confirm') }}
                          </NButton>
                          <NButton size="tiny" quaternary @click.stop="cancelEditSession">
                            {{ t('common.cancel') }}
                          </NButton>
                        </template>
                        <template v-else>
                          <NText style="font-size: 13px;">{{ getSessionDisplayName(session) }}</NText>
                          <NButton
                            size="tiny"
                            quaternary
                            style="margin-left: 4px;"
                            @click.stop="startEditSession(session)"
                          >
                            <template #icon><NIcon :component="CreateOutline" /></template>
                          </NButton>
                        </template>
                      </div>
                      <div class="session-item__actions">
                        <NTooltip trigger="hover">
                          <template #trigger>
                            <NButton size="tiny" type="primary" quaternary @click.stop="handleReconnectSession(session)">
                              <template #icon><NIcon :component="LinkOutline" /></template>
                            </NButton>
                          </template>
                          {{ t('pages.hermesCli.reconnect') }}
                        </NTooltip>
                        <NPopconfirm @positive-click="handleDestroySession(session)">
                          <template #trigger>
                            <NButton size="tiny" quaternary type="error" @click.stop>
                              <template #icon><NIcon :component="TrashOutline" /></template>
                            </NButton>
                          </template>
                          {{ t('pages.hermesCli.destroyConfirm') || '确定终止此会话？进程将被结束。' }}
                        </NPopconfirm>
                      </div>
                    </div>
                  </template>
                  {{ t('pages.hermesCli.backgroundStatusHint') || '后台运行 - 点击重新连接到此会话' }}
                </NTooltip>
              </div>
            </template>
          </template>
        </NCard>

        <NCollapse :expanded-names="launchConfigExpandedNames" class="app-card left-panel-card" @update:expanded-names="onLaunchConfigChange">
          <NCollapseItem
            :title="t('pages.hermesCli.launchConfig')"
            name="launch-config"
          >
            <template #header-extra>
              <NButton
                type="primary"
                size="small"
                class="app-toolbar-btn"
                @click.stop="handleNewSession"
              >
                <template #icon><NIcon :component="PlayOutline" /></template>
                {{ t('pages.hermesCli.launch') }}
              </NButton>
            </template>

            <div class="launch-config-form">
              <div class="launch-config-hint">
                <NText depth="3" style="font-size: 11px;">
                  {{ t('pages.hermesCli.defaultConfigHint') || '使用默认配置快速启动，或自定义模型和 Provider' }}
                </NText>
              </div>

              <div class="launch-config-section">
                <div class="launch-config-row">
                  <NText class="launch-config-label">{{ t('pages.hermesCli.model') || '模型' }}</NText>
                  <NSelect
                    v-model:value="launchConfig.model"
                    :options="modelOptions"
                    :placeholder="'auto (默认)'"
                    clearable
                    class="launch-config-input"
                  />
                </div>
              </div>

              <div class="launch-config-section">
                <div class="launch-config-row">
                  <NText class="launch-config-label">{{ t('pages.hermesCli.skills') }}</NText>
                  <NDynamicTags v-model:value="launchConfig.skills" class="launch-config-input" />
                </div>

                <div class="launch-config-row">
                  <NText class="launch-config-label">{{ t('pages.hermesCli.toolsets') }}</NText>
                  <NInput
                    v-model:value="launchConfig.toolsets"
                    :placeholder="'tool1,tool2'"
                    class="launch-config-input"
                  />
                </div>

                <div class="launch-config-row">
                  <NText class="launch-config-label">{{ t('pages.hermesCli.resumeSession') }}</NText>
                  <NSelect
                    v-model:value="launchConfig.resumeSession"
                    :options="hermesSessionOptions"
                    :loading="hermesSessionsLoading"
                    :placeholder="t('pages.hermesCli.selectSession') || '选择会话'"
                    :render-label="renderSessionLabel"
                    clearable
                    filterable
                    class="launch-config-input"
                  />
                </div>
                <div v-if="launchConfig.resumeSession" class="launch-config-hint" style="margin-top: -4px; margin-bottom: 8px;">
                  <NText depth="3" style="font-size: 11px;">
                    {{ t('pages.hermesCli.resumeSessionHint') || '选择已有会话以恢复其对话历史' }}
                  </NText>
                </div>

                <div class="launch-config-toggles">
                  <NSpace :size="8" align="center">
                    <NSwitch v-model:value="launchConfig.yolo" size="small" />
                    <NText style="font-size: 12px;">{{ t('pages.hermesCli.yoloMode') }}</NText>
                  </NSpace>
                  <NSpace :size="8" align="center">
                    <NSwitch v-model:value="launchConfig.checkpoints" size="small" />
                    <NText style="font-size: 12px;">{{ t('pages.hermesCli.checkpoints') }}</NText>
                  </NSpace>
                </div>

                <div class="launch-config-toggles">
                  <NSpace :size="8" align="center">
                    <NSwitch v-model:value="launchConfig.verbose" size="small" />
                    <NText style="font-size: 12px;">{{ t('pages.hermesCli.verbose') }}</NText>
                  </NSpace>
                  <NSpace :size="8" align="center">
                    <NSwitch v-model:value="launchConfig.quiet" size="small" />
                    <NText style="font-size: 12px;">{{ t('pages.hermesCli.quiet') }}</NText>
                  </NSpace>
                </div>

                <div class="launch-config-row">
                  <NText class="launch-config-label">{{ t('pages.hermesCli.maxTurns') }}</NText>
                  <NInputNumber
                    v-model:value="launchConfig.maxTurns"
                    :min="1"
                    :max="1000"
                    clearable
                    class="launch-config-input"
                  />
                </div>

                <div class="launch-config-row">
                  <NText class="launch-config-label">{{ t('pages.hermesCli.source') }}</NText>
                  <NInput
                    v-model:value="launchConfig.source"
                    :placeholder="'label'"
                    class="launch-config-input"
                  />
                </div>
              </div>
            </div>
          </NCollapseItem>
        </NCollapse>
      </div>
    </div>

    <div class="hermes-cli-layout__right">
      <div class="terminal-status-bar">
        <NSpace :size="8" align="center">
          <NTag :type="connectionTagType" :bordered="false" round size="small">
            {{ connectionLabel }}
          </NTag>
          <NTag v-if="hermesCliStore.currentSession" type="info" :bordered="false" round size="small">
            {{ hermesCliStore.currentSession.name || (t('pages.hermesCli.session') + ': ' + hermesCliStore.currentSession.id.slice(0, 8) + '...') }}
          </NTag>
          <NText v-if="hermesCliStore.currentSession" depth="3" style="font-size: 12px;">
            {{ hermesCliStore.currentSession.cols }}x{{ hermesCliStore.currentSession.rows }}
          </NText>
        </NSpace>

        <NSpace :size="6" align="center">
          <NButton
            size="tiny"
            quaternary
            @click="handleClear"
          >
            <template #icon><NIcon :component="RefreshOutline" /></template>
          </NButton>
          <NButton
            size="tiny"
            quaternary
            @click="handleFullscreen"
          >
            <template #icon>
              <NIcon :component="isFullscreen ? ContractOutline : ExpandOutline" />
            </template>
          </NButton>
          <NTooltip v-if="hermesCliStore.isConnected" trigger="hover">
            <template #trigger>
              <NButton
                size="tiny"
                quaternary
                @click="handleDetach"
              >
                <template #icon><NIcon :component="LogOutOutline" /></template>
              </NButton>
            </template>
            {{ t('pages.hermesCli.detach') }}
          </NTooltip>
          <NPopconfirm v-if="hermesCliStore.isConnected" @positive-click="handleDestroy">
            <template #trigger>
              <NButton
                size="tiny"
                quaternary
                type="error"
              >
                <template #icon><NIcon :component="StopOutline" /></template>
              </NButton>
            </template>
            {{ t('common.confirm') }}?
          </NPopconfirm>
          <NButton
            v-else
            type="primary"
            size="tiny"
            @click="handleConnect"
          >
            <template #icon>
              <NIcon :component="PlayOutline" />
            </template>
            {{ t('pages.hermesCli.reconnect') }}
          </NButton>
        </NSpace>
      </div>

      <NAlert
        v-if="hermesCliStore.error"
        type="error"
        :bordered="false"
        style="margin: 8px 12px 0;"
      >
        {{ hermesCliStore.error }}
      </NAlert>

      <div class="terminal-wrapper">
        <div v-if="isFullscreen && showFullscreenHint" class="fullscreen-hint">
          {{ t('pages.hermesCli.pressEscToExit') }}
        </div>
        <NSpin :show="terminalLoading">
          <NAlert
            v-if="terminalError"
            type="error"
            :bordered="false"
            style="margin-bottom: 12px;"
          >
            {{ terminalError }}
          </NAlert>
          <div ref="terminalContainerRef" class="terminal-xterm-container" :class="{ 'terminal-xterm-container--fullscreen': isFullscreen }"></div>
        </NSpin>
      </div>
    </div>
  </div>
</template>

<style>
@import '@xterm/xterm/css/xterm.css';

.hermes-cli-layout {
  display: flex;
  height: calc(100vh - 120px);
  min-height: 500px;
  background: var(--bg-page, #f5f7fa);
  border-radius: 8px;
  overflow: hidden;
}

.hermes-cli-layout__left {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-card, #fff);
  border-right: 1px solid var(--border-color, #e0e0e6);
}

.left-panel-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.left-panel-card {
  flex-shrink: 0;
}

.hermes-cli-layout__right {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--bg-card, #fff);
}

.terminal-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color, #e0e0e6);
  background: var(--bg-secondary, #f5f7fa);
  flex-shrink: 0;
}

.terminal-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 12px;
}

.terminal-xterm-container {
  flex: 1;
  min-height: 0;
  background: #1e1e1e;
  border-radius: 8px;
  padding: 8px;
}

.terminal-xterm-container--fullscreen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  border-radius: 0;
  padding: 8px;
}

.terminal-xterm-container .xterm {
  height: 100%;
}

.terminal-xterm-container .xterm-viewport {
  border-radius: 4px;
}

.fullscreen-hint {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  z-index: 10;
  pointer-events: none;
  animation: fadeInOut 3s ease-in-out;
}

@keyframes fadeInOut {
  0% { opacity: 0; }
  10% { opacity: 1; }
  80% { opacity: 1; }
  100% { opacity: 0; }
}

.session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 6px;
  margin-bottom: 4px;
  transition: background-color 0.2s;
  cursor: default;
}

.session-item:hover {
  background-color: var(--bg-hover, rgba(0, 0, 0, 0.04));
}

.session-item--active {
  background-color: var(--bg-active, rgba(82, 196, 26, 0.06));
}

.session-item--active:hover {
  background-color: var(--bg-active-hover, rgba(82, 196, 26, 0.1));
}

.session-item--current {
  border: 1px solid var(--success-color, #52c41a);
  box-shadow: 0 0 0 1px rgba(82, 196, 26, 0.2);
}

.session-item--background {
  cursor: pointer;
}

.session-item--background:hover {
  background-color: var(--bg-hover, rgba(0, 0, 0, 0.06));
}

.status-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
  flex-shrink: 0;
}

.status-indicator--connected {
  color: #52c41a;
}

.status-indicator--background {
  color: #faad14;
}

.session-item__info {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.session-item__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.launch-config-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.launch-config-hint {
  padding: 6px 8px;
  background: var(--bg-hover, rgba(0, 0, 0, 0.02));
  border-radius: 6px;
  margin-bottom: 4px;
}

.launch-config-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.launch-config-section--advanced {
  padding-top: 4px;
  animation: slideDown 0.2s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.launch-config-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.launch-config-label {
  min-width: 60px;
  text-align: right;
  font-size: 12px;
  flex-shrink: 0;
}

.launch-config-input {
  flex: 1;
  min-width: 0;
}

.launch-config-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding-left: 68px;
}

@media (max-width: 768px) {
  .hermes-cli-layout {
    flex-direction: column;
    height: auto;
    min-height: calc(100vh - 120px);
  }

  .hermes-cli-layout__left {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border-color, #e0e0e6);
    max-height: 300px;
  }

  .hermes-cli-layout__right {
    min-height: 400px;
  }

  .terminal-xterm-container {
    min-height: 350px;
  }

  .launch-config-toggles {
    flex-direction: column;
    gap: 8px;
    padding-left: 0;
  }

  .launch-config-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .launch-config-label {
    text-align: left;
  }
}
</style>
