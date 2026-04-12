<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NFormItem,
  NIcon,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NTag,
  NText,
  NSpin,
  NCollapse,
  NCollapseItem,
  NCode,
  useMessage,
} from 'naive-ui'
import {
  PlayOutline,
  StopOutline,
  ExpandOutline,
  ContractOutline,
  DesktopOutline,
  RefreshOutline,
  InformationCircleOutline,
} from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useRemoteDesktopStore } from '@/stores/remote-desktop'
import { useWebSocketStore } from '@/stores/websocket'
import type { RemoteDesktopNode } from '@/api/types'
import DesktopCanvas from './components/DesktopCanvas.vue'
import NodeSelector from './components/NodeSelector.vue'

const message = useMessage()
const { t } = useI18n()
const authStore = useAuthStore()
const desktopStore = useRemoteDesktopStore()
const wsStore = useWebSocketStore()

const desktopCanvasRef = ref<InstanceType<typeof DesktopCanvas> | null>(null)
const isFullscreen = ref(false)
const showFullscreenHint = ref(false)
const nodesLoading = ref(false)
const nodes = ref<RemoteDesktopNode[]>([])
const selectedNodeId = ref<string | undefined>(undefined)
const showSettings = ref(false)
const widthInput = ref(1024)
const heightInput = ref(768)
const depthInput = ref(24)
const timeoutInput = ref(300)
const displayInput = ref<string>('')
const displaysLoading = ref(false)
const displays = ref<{ display: string; number: number }[]>([])
const platform = ref<string>('unknown')

const displayOptions = computed(() => {
  const options: { label: string; value: string }[] = [
    { label: t('pages.remoteDesktop.settings.displayAuto'), value: '' },
  ]
  for (const d of displays.value) {
    options.push({ label: d.display, value: d.display })
  }
  return options
})

const connectionTagType = computed<'success' | 'warning' | 'error' | 'default'>(() => {
  if (desktopStore.isConnected) return 'success'
  if (desktopStore.isConnecting) return 'warning'
  if (desktopStore.hasError) return 'error'
  return 'default'
})

const connectionLabel = computed(() => {
  if (desktopStore.isConnected) return t('pages.remoteDesktop.status.connected')
  if (desktopStore.isConnecting) return t('pages.remoteDesktop.status.connecting')
  if (desktopStore.hasError) return t('pages.remoteDesktop.status.error')
  return t('pages.remoteDesktop.status.disconnected')
})

function buildAuthHeaders(includeJson = false): Record<string, string> {
  const headers: Record<string, string> = {}
  if (includeJson) {
    headers['Content-Type'] = 'application/json'
  }

  const token = authStore.getToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

async function loadNodes() {
  if (nodesLoading.value) return
  nodesLoading.value = true
  try {
    const deviceNodes = await wsStore.rpc.listNodes()
    nodes.value = deviceNodes.map((node: any) => ({
      id: node.id,
      name: node.name,
      platform: node.platform || 'unknown',
      connected: node.connected,
      capabilities: node.capabilities || [],
      hasDesktop: node.capabilities?.includes('desktop') || false,
      lastSeen: node.lastSeen,
    }))
  } catch {
    nodes.value = []
  } finally {
    nodesLoading.value = false
  }
}

async function loadDisplays() {
  if (displaysLoading.value) return
  displaysLoading.value = true
  try {
    const response = await fetch('/api/desktop/displays', {
      headers: buildAuthHeaders(),
    })
    const result = await response.json()
    if (result.ok) {
      displays.value = result.displays || []
      platform.value = result.platform || 'unknown'
    }
  } catch {
    displays.value = []
  } finally {
    displaysLoading.value = false
  }
}

async function handleCreateSession() {
  const session = await desktopStore.createSession(
    selectedNodeId.value || undefined,
    widthInput.value,
    heightInput.value,
    displayInput.value || undefined
  )
  if (session) {
    message.success(`Session created: ${session.id.slice(0, 8)}...`)
    handleConnect(session.id)
  } else if (desktopStore.error) {
    message.error(desktopStore.error)
  }
}

function handleConnect(sessionId: string) {
  desktopStore.connect(sessionId)
}

function handleDisconnect() {
  desktopStore.disconnect()
}

async function handleDestroySession() {
  if (desktopStore.currentSession) {
    await desktopStore.destroySession(desktopStore.currentSession.id)
  }
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
      window.dispatchEvent(new Event('resize'))
    }, 100)
  })
}

function handleMouseMove(x: number, y: number) {
  if (!desktopStore.isConnected || !desktopStore.currentSession) return
  fetch('/api/desktop/input/mouse', {
    method: 'POST',
    headers: buildAuthHeaders(true),
    body: JSON.stringify({
      sessionId: desktopStore.currentSession.id,
      x,
      y,
      buttons: 0,
      type: 'mousemove',
    }),
  })
}

function handleMouseClick(x: number, y: number, button: number) {
  if (!desktopStore.isConnected || !desktopStore.currentSession) return
  fetch('/api/desktop/input/mouse', {
    method: 'POST',
    headers: buildAuthHeaders(true),
    body: JSON.stringify({
      sessionId: desktopStore.currentSession.id,
      x,
      y,
      buttons: button,
      type: 'click',
    }),
  })
}

function handleMouseWheel(x: number, y: number, deltaX: number, deltaY: number) {
  if (!desktopStore.isConnected || !desktopStore.currentSession) return
  fetch('/api/desktop/input/mouse', {
    method: 'POST',
    headers: buildAuthHeaders(true),
    body: JSON.stringify({
      sessionId: desktopStore.currentSession.id,
      x,
      y,
      buttons: 0,
      type: 'wheel',
      wheelDeltaX: deltaX,
      wheelDeltaY: deltaY,
    }),
  })
}

function handleKeyDown(event: KeyboardEvent) {
  if (!desktopStore.isConnected) return
  if (event.key === 'Escape' && isFullscreen.value) {
    isFullscreen.value = false
    return
  }
  desktopStore.sendKeyboardEvent(event)
}

function handleKeyUp(event: KeyboardEvent) {
  if (!desktopStore.isConnected) return
  desktopStore.sendKeyboardEvent(event)
}

async function handleClipboardPaste(text: string) {
  if (!desktopStore.isConnected) return
  const success = await desktopStore.sendClipboardText(text)
  if (success) {
    message.success(t('pages.remoteDesktop.hints.clipboardSynced'))
  }
}

function handleKeyDownGlobal(e: KeyboardEvent) {
  if (e.key === 'Escape' && isFullscreen.value) {
    isFullscreen.value = false
  }
}

onMounted(() => {
  loadNodes()
  loadDisplays()
  window.addEventListener('keydown', handleKeyDownGlobal)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDownGlobal)
  if (desktopStore.isConnected) {
    desktopStore.disconnect()
  }
})

watch(isFullscreen, () => {
  nextTick(() => {
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'))
    }, 100)
  })
})
</script>

<template>
  <NSpace vertical :size="16">
    <NCard :title="t('routes.remoteDesktop')" class="app-card">
      <template #header-extra>
        <NSpace :size="8" align="center">
          <NButton
            size="small"
            class="app-toolbar-btn"
            @click="showSettings = !showSettings"
          >
            <template #icon><NIcon :component="DesktopOutline" /></template>
            {{ t('pages.remoteDesktop.actions.settings') }}
          </NButton>
          <NButton
            size="small"
            class="app-toolbar-btn"
            @click="handleFullscreen"
          >
            <template #icon>
              <NIcon :component="isFullscreen ? ContractOutline : ExpandOutline" />
            </template>
            {{ isFullscreen ? t('pages.remoteDesktop.actions.exitFullscreen') : t('pages.remoteDesktop.actions.fullscreen') }}
          </NButton>
          <NButton
            v-if="desktopStore.isConnected"
            type="error"
            size="small"
            class="app-toolbar-btn"
            @click="handleDisconnect"
          >
            <template #icon><NIcon :component="StopOutline" /></template>
            {{ t('pages.remoteDesktop.actions.disconnect') }}
          </NButton>
          <NButton
            v-else
            type="primary"
            size="small"
            class="app-toolbar-btn"
            @click="handleCreateSession"
          >
            <template #icon><NIcon :component="PlayOutline" /></template>
            {{ t('pages.remoteDesktop.actions.create') }}
          </NButton>
        </NSpace>
      </template>

      <NSpace :size="12" align="center" style="flex-wrap: wrap; margin-bottom: 12px;">
        <NTag :type="connectionTagType" :bordered="false" round>
          {{ connectionLabel }}
        </NTag>
        <NTag v-if="selectedNodeId" :bordered="false" round>
          {{ t('pages.remoteDesktop.node') }}: {{ selectedNodeId }}
        </NTag>
        <NText depth="3" style="font-size: 12px;">
          {{ t('pages.remoteDesktop.size') }}: {{ desktopStore.config.width }}x{{ desktopStore.config.height }}
        </NText>
      </NSpace>

      <NAlert
        v-if="desktopStore.error"
        type="error"
        :bordered="false"
        style="margin-bottom: 12px;"
      >
        {{ desktopStore.error }}
      </NAlert>

      <NCard v-if="showSettings" size="small" embedded class="desktop-settings-card">
        <NSpace :size="12" :wrap="true">
          <div style="min-width: 200px;">
            <NFormItem :label="t('pages.remoteDesktop.settings.node')" :show-feedback="false">
              <NodeSelector
                v-model="selectedNodeId"
                :nodes="nodes"
                :loading="nodesLoading"
              />
            </NFormItem>
          </div>
          <div style="min-width: 100px;">
            <NFormItem :label="t('pages.remoteDesktop.settings.width')" :show-feedback="false">
              <NInputNumber
                v-model:value="widthInput"
                :min="640"
                :max="3840"
                size="small"
              />
            </NFormItem>
          </div>
          <div style="min-width: 100px;">
            <NFormItem :label="t('pages.remoteDesktop.settings.height')" :show-feedback="false">
              <NInputNumber
                v-model:value="heightInput"
                :min="480"
                :max="2160"
                size="small"
              />
            </NFormItem>
          </div>
          <div style="min-width: 80px;">
            <NFormItem :label="t('pages.remoteDesktop.settings.depth')" :show-feedback="false">
              <NInputNumber
                v-model:value="depthInput"
                :min="8"
                :max="32"
                size="small"
              />
            </NFormItem>
          </div>
          <div style="min-width: 120px;">
            <NFormItem :label="t('pages.remoteDesktop.settings.timeout')" :show-feedback="false">
              <NInputNumber
                v-model:value="timeoutInput"
                :min="60"
                :max="3600"
                size="small"
              >
                <template #suffix>
                  <NText depth="3" style="font-size: 12px;">s</NText>
                </template>
              </NInputNumber>
            </NFormItem>
          </div>
          <div style="min-width: 150px;">
            <NFormItem :label="t('pages.remoteDesktop.settings.display')" :show-feedback="false">
              <NSelect
                v-model:value="displayInput"
                :options="displayOptions"
                :placeholder="t('pages.remoteDesktop.settings.displayPlaceholder')"
                :loading="displaysLoading"
                size="small"
              />
            </NFormItem>
          </div>
        </NSpace>
        <NText depth="3" style="font-size: 12px; display: block; margin-top: 8px;">
          {{ t('pages.remoteDesktop.settings.displayHint') }}
        </NText>
        <NText depth="3" style="font-size: 12px; display: block; margin-top: 4px;">
          {{ t('pages.remoteDesktop.settings.hint') }}
        </NText>
      </NCard>
    </NCard>

    <NCard
      class="app-card desktop-container"
      :class="{ 'desktop-container--fullscreen': isFullscreen }"
    >
      <div v-if="isFullscreen && showFullscreenHint" class="fullscreen-hint">
        {{ t('pages.remoteDesktop.hints.pressEscToExit') }}
      </div>
      <NSpin :show="desktopStore.isConnecting">
        <DesktopCanvas
          ref="desktopCanvasRef"
          :width="desktopStore.config.width"
          :height="desktopStore.config.height"
          :scale="desktopStore.config.scale ? 1 : 1"
          :frame-data="desktopStore.currentSession?.frameData"
          @mouse-move="handleMouseMove"
          @mouse-click="handleMouseClick"
          @mouse-wheel="handleMouseWheel"
          @keyboard-down="handleKeyDown"
          @keyboard-up="handleKeyUp"
          @clipboard-paste="handleClipboardPaste"
        />
      </NSpin>
    </NCard>

    <NCard class="app-card">
      <NText depth="3" style="font-size: 12px;">
        {{ t('pages.remoteDesktop.hint') }}
      </NText>
    </NCard>

    <NCard class="app-card">
      <template #header>
        <NSpace align="center" :size="8">
          <NIcon :component="InformationCircleOutline" />
          <span>{{ t('pages.remoteDesktop.dependencies.title') }}</span>
        </NSpace>
      </template>
      <NCollapse :default-expanded-names="[]">
        <NCollapseItem name="linux" :title="t('pages.remoteDesktop.dependencies.linux.title')">
          <NText depth="3" style="font-size: 13px; display: block; margin-bottom: 8px;">
            {{ t('pages.remoteDesktop.dependencies.linux.description') }}
          </NText>
          <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 4px;">
            {{ t('pages.remoteDesktop.dependencies.linux.packages') }}
          </NText>
          <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 4px;">
            {{ t('pages.remoteDesktop.dependencies.linux.install') }}
          </NText>
          <NCode :code="t('pages.remoteDesktop.dependencies.linux.installCmd')" language="bash" style="margin-bottom: 8px;" />
          <NText depth="3" style="font-size: 12px; display: block;">
            {{ t('pages.remoteDesktop.dependencies.linux.note') }}
          </NText>
        </NCollapseItem>
        <NCollapseItem name="windows" :title="t('pages.remoteDesktop.dependencies.windows.title')">
          <NText depth="3" style="font-size: 13px; display: block; margin-bottom: 8px;">
            {{ t('pages.remoteDesktop.dependencies.windows.description') }}
          </NText>
          <NText depth="3" style="font-size: 12px; display: block;">
            {{ t('pages.remoteDesktop.dependencies.windows.note') }}
          </NText>
        </NCollapseItem>
      </NCollapse>
    </NCard>
  </NSpace>
</template>

<style scoped>
.desktop-settings-card {
  margin-bottom: 12px;
  border-radius: 12px;
}

.desktop-container {
  position: relative;
  min-height: 400px;
}

.desktop-container--fullscreen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  border-radius: 0;
}

.desktop-container--fullscreen :deep(.n-card__content) {
  padding: 0;
  height: 100%;
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
</style>
