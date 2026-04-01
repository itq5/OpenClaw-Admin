<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, nextTick, watch } from 'vue'
import {
  NCard,
  NGrid,
  NGridItem,
  NSpace,
  NText,
  NTag,
  NIcon,
  NButton,
  NSpin,
  NAlert,
  NStatistic,
  NAvatar,
  NProgress,
  NRadioGroup,
  NRadioButton,
  NTooltip,
  NEmpty,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  useMessage,
} from 'naive-ui'
import {
  RefreshOutline,
  PersonOutline,
  DesktopOutline,
  CubeOutline,
  TimeOutline,
  PulseOutline,
  AddOutline,
  GridOutline,
  Cube,
  ChatbubbleOutline,
  ListOutline,
  CloseOutline,
  PersonAddOutline,
  TrashOutline,
} from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useWebSocketStore } from '@/stores/websocket'
import { useSessionStore } from '@/stores/session'
import { useOfficeStore } from '@/stores/office'
import { useAgentStore } from '@/stores/agent'
import { useChatStore } from '@/stores/chat'
import { useWizardStore } from '@/stores/wizard'
import { useConfigStore } from '@/stores/config'
import { useResizable } from '@/composables/useResizable'
import { formatRelativeTime } from '@/utils/format'
import ScenarioWizard from '@/components/office/ScenarioWizard.vue'
import AgentCharacter from '@/components/office/AgentCharacter.vue'
import OfficeScene3D from '@/components/office/OfficeScene3D.vue'
import OfficeWorkspace from '@/components/office/OfficeWorkspace.vue'
import AgentChatPanel from '@/components/office/AgentChatPanel.vue'
import ScenarioManagementPanel from '@/components/office/ScenarioManagementPanel.vue'

const { t } = useI18n()
const wsStore = useWebSocketStore()
const sessionStore = useSessionStore()
const officeStore = useOfficeStore()
const agentStore = useAgentStore()
const chatStore = useChatStore()
const wizardStore = useWizardStore()
const configStore = useConfigStore()
const message = useMessage()

const sidebarRef = ref<HTMLElement | null>(null)
const { width: sidebarWidth, isResizing: isSidebarResizing } = useResizable(sidebarRef, {
  minWidth: 320,
  maxWidth: 600,
  defaultWidth: 360,
  storageKey: 'office_sidebar_width',
  direction: 'left',
})

const loading = computed(() => officeStore.loading)
const error = computed(() => officeStore.error)
const agents = computed(() => officeStore.officeAgents)
const selectedAgentId = computed(() => officeStore.selectedAgentId)
const selectedAgent = computed(() => officeStore.selectedAgent)

const selectedAgentSessions = computed(() => {
  if (!selectedAgentId.value) return []
  return sessionStore.sessions
    .filter((s) => s.agentId === selectedAgentId.value)
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
})

const methodUnknown = computed(() => wsStore.gatewayMethods.length === 0)
const supportsAgents = computed(() =>
  methodUnknown.value || wsStore.supportsAnyMethod(['agents.list'])
)

const showCreateModal = ref(false)
const creating = ref(false)
const createForm = ref({
  agentId: 'main',
  channel: 'main',
  peer: '',
  label: '',
})

const showCreateAgentModal = ref(false)
const creatingAgent = ref(false)
const createAgentForm = ref({
  id: '',
  name: '',
  workspace: '',
})

const showIdentityModal = ref(false)
const showModelModal = ref(false)
const showToolsModal = ref(false)
const submitting = ref(false)
const selectedAgentIdForAction = ref('')
const identityForm = ref({
  name: '',
  theme: '',
  emoji: '',
  avatar: '',
})
const modelForm = ref({
  model: '',
})
const toolsForm = ref({
  allow: [] as string[],
  deny: [] as string[],
})

const toolCategories = [
  {
    nameKey: 'pages.agents.form.toolCategories.files',
    tools: ['read', 'write', 'edit', 'apply_patch'],
  },
  {
    nameKey: 'pages.agents.form.toolCategories.runtime',
    tools: ['exec', 'process'],
  },
  {
    nameKey: 'pages.agents.form.toolCategories.web',
    tools: ['web_search', 'web_fetch'],
  },
  {
    nameKey: 'pages.agents.form.toolCategories.memory',
    tools: ['memory_search', 'memory_get'],
  },
  {
    nameKey: 'pages.agents.form.toolCategories.sessions',
    tools: ['sessions_list', 'sessions_history', 'sessions_send', 'sessions_spawn', 'sessions_yield', 'subagents', 'session_status'],
  },
  {
    nameKey: 'pages.agents.form.toolCategories.ui',
    tools: ['browser', 'canvas'],
  },
  {
    nameKey: 'pages.agents.form.toolCategories.messaging',
    tools: ['message'],
  },
  {
    nameKey: 'pages.agents.form.toolCategories.automation',
    tools: ['cron', 'gateway'],
  },
  {
    nameKey: 'pages.agents.form.toolCategories.nodes',
    tools: ['nodes'],
  },
  {
    nameKey: 'pages.agents.form.toolCategories.agents',
    tools: ['agents_list'],
  },
  {
    nameKey: 'pages.agents.form.toolCategories.media',
    tools: ['image', 'image_generate', 'tts'],
  },
]

const modelOptions = computed(() => {
  const options: Array<{ label: string; value: string }> = []
  const config = configStore.config
  const providers = config?.models?.providers || {}
  
  for (const [providerId, provider] of Object.entries(providers)) {
    if (!provider || typeof provider !== 'object') continue
    const providerConfig = provider as Record<string, unknown>
    const models = providerConfig.models
    if (!Array.isArray(models)) continue
    
    for (const model of models) {
      if (!model || typeof model !== 'object') continue
      const modelConfig = model as Record<string, unknown>
      const modelId = (typeof modelConfig.id === 'string' && modelConfig.id.trim()) || ''
      if (!modelId) continue
      const label = `${providerId}/${modelId}`
      options.push({
        label,
        value: label,
      })
    }
  }
  
  return options.sort((a, b) => a.label.localeCompare(b.label))
})

const agentOptions = computed(() => {
  return agents.value.map((agent) => ({
    label: agent.name || agent.id,
    value: agent.id,
  }))
})

const channelOptionsForCreate = computed(() => {
  const channels = [
    { label: 'Main', value: 'main' },
    { label: 'WhatsApp', value: 'whatsapp' },
    { label: 'Telegram', value: 'telegram' },
    { label: 'Discord', value: 'discord' },
    { label: 'Slack', value: 'slack' },
  ]
  return channels
})

async function loadData() {
  if (!configStore.config) {
    await configStore.fetchConfig()
  }
  await officeStore.loadOfficeData()
}

function handleAgentSelect(agentId: string) {
  officeStore.selectAgent(agentId)
}

function handleViewTask(task: { sessionKey?: string }) {
  if (task.sessionKey) {
    officeStore.selectSession(task.sessionKey)
  }
}

function handleOpenSession(agentId: string) {
  const agentSessions = sessionStore.sessions.filter(
    (s) => s.agentId === agentId
  )
  
  if (agentSessions.length > 0 && agentSessions[0]) {
    officeStore.selectSession(agentSessions[0].key)
  } else {
    handleCreateSession(agentId)
  }
}

function handleCreateSession(agentId: string) {
  createForm.value = {
    agentId: agentId,
    channel: 'main',
    peer: '',
    label: '',
  }
  showCreateModal.value = true
}

function handleAgentDelegate(agentId: string) {
  officeStore.selectAgent(agentId)
}

async function handleCreateSessionSubmit() {
  creating.value = true
  try {
    await sessionStore.createSession({
      agentId: createForm.value.agentId || 'main',
      channel: createForm.value.channel || 'main',
      peer: createForm.value.peer || undefined,
      label: createForm.value.label || undefined,
    })
    // Refresh sessions in background — no artificial wait needed
    sessionStore.fetchSessions()
    message.success(t('pages.sessions.list.createSuccess'))
    showCreateModal.value = false
  } catch (e: any) {
    message.error(e?.message || t('pages.sessions.list.createFailed'))
  } finally {
    creating.value = false
  }
}

function handleCreateScenario() {
  officeStore.showWizard()
}

function getSelectedAgentName(): string {
  return selectedAgent.value?.name || selectedAgentId.value || ''
}

function isSessionActive(session: { lastActivity: string }): boolean {
  const lastActivity = new Date(session.lastActivity).getTime()
  const now = Date.now()
  const diffMins = (now - lastActivity) / (1000 * 60)
  return diffMins < 5
}

function isSessionSelected(session: { key: string }): boolean {
  return officeStore.selectedSessionKey === session.key
}

function getSessionLabel(session: { key: string; label?: string }): string {
  if (session.label) return session.label
  
  const parts = session.key.split(':')
  if (parts.length >= 4) {
    const channel = parts[2] || 'main'
    const peer = parts[4] || ''
    if (peer) return `${channel} - ${peer.slice(0, 8)}`
    return channel
  }
  return session.key.slice(0, 20)
}

function getSessionFirstChar(session: { key: string; label?: string }): string {
  const label = getSessionLabel(session)
  return label.charAt(0).toUpperCase()
}

function formatSessionTokens(session: { tokenUsage?: { totalInput: number; totalOutput: number } }): string {
  if (!session.tokenUsage) return '0'
  const total = (session.tokenUsage.totalInput || 0) + (session.tokenUsage.totalOutput || 0)
  if (total >= 1000000) {
    return (total / 1000000).toFixed(1) + 'M'
  } else if (total >= 1000) {
    return (total / 1000).toFixed(1) + 'K'
  }
  return total.toString()
}

async function handleSpawnSession(sessionKey: string) {
  try {
    await sessionStore.newSession(sessionKey)
    // No artificial wait — fetchSessions in background while chat loads
    sessionStore.fetchSessions()
    officeStore.selectSession(sessionKey)
    chatStore.setSessionKey(sessionKey)
    await chatStore.fetchHistory(sessionKey)
    message.success(t('pages.sessions.list.newSuccess'))
  } catch (e: any) {
    message.error(e?.message || t('pages.sessions.list.newFailed'))
  }
}

function openCreateSessionModal() {
  createForm.value = {
    agentId: selectedAgentId.value || 'main',
    channel: 'main',
    peer: '',
    label: '',
  }
  showCreateModal.value = true
}

async function handleDeleteSession(sessionKey: string) {
  try {
    await sessionStore.deleteSession(sessionKey)
    // Optimistic UI update — fetchSessions in background
    sessionStore.fetchSessions()
    message.success(t('pages.sessions.list.deleteSuccess'))
  } catch (e: any) {
    message.error(e?.message || t('pages.sessions.list.deleteFailed'))
  }
}

function handleSelectSession(sessionKey: string) {
  officeStore.selectSession(sessionKey)
}

function openCreateAgentModal() {
  createAgentForm.value = {
    id: '',
    name: '',
    workspace: '',
  }
  showCreateAgentModal.value = true
}

async function handleCreateAgent() {
  if (!createAgentForm.value.id.trim()) {
    message.error(t('pages.agents.form.idRequired'))
    return
  }

  creatingAgent.value = true
  try {
    await agentStore.addAgent({
      id: createAgentForm.value.id.trim(),
      name: createAgentForm.value.name.trim() || createAgentForm.value.id.trim(),
      workspace: createAgentForm.value.workspace.trim() || undefined,
    })
    // Refresh agents in background
    agentStore.fetchAgents()
    message.success(t('pages.agents.messages.created'))
    showCreateAgentModal.value = false
  } catch (e: any) {
    message.error(e?.message || t('pages.agents.messages.createFailed'))
  } finally {
    creatingAgent.value = false
  }
}

function handleOpenIdentityModal(agentId: string) {
  selectedAgentIdForAction.value = agentId
  const agent = agents.value.find((a) => a.id === agentId)
  identityForm.value = {
    name: agent?.identity?.name || agent?.name || '',
    theme: agent?.identity?.theme || '',
    emoji: agent?.identity?.emoji || '',
    avatar: agent?.identity?.avatar || '',
  }
  showIdentityModal.value = true
}

function handleOpenModelModal(agentId: string) {
  selectedAgentIdForAction.value = agentId
  const agent = agents.value.find((a) => a.id === agentId)
  modelForm.value = {
    model: agent?.model || '',
  }
  showModelModal.value = true
}

function handleOpenToolsModal(agentId: string) {
  selectedAgentIdForAction.value = agentId
  const agent = agents.value.find((a) => a.id === agentId)
  toolsForm.value = {
    allow: agent?.toolPolicy?.allow || [],
    deny: agent?.toolPolicy?.deny || [],
  }
  showToolsModal.value = true
}

async function handleDeleteAgent(agentId: string) {
  try {
    await agentStore.deleteAgent(agentId)
    // Refresh agents in background
    agentStore.fetchAgents()
    message.success(t('pages.agents.messages.deleted'))
  } catch (e: any) {
    message.error(e?.message || t('pages.agents.messages.deleteFailed'))
  }
}

async function handleSetIdentity() {
  submitting.value = true
  try {
    await agentStore.setAgentIdentity({
      agentId: selectedAgentIdForAction.value,
      name: identityForm.value.name || undefined,
      theme: identityForm.value.theme || undefined,
      emoji: identityForm.value.emoji || undefined,
      avatar: identityForm.value.avatar || undefined,
    })
    // Refresh agents in background
    agentStore.fetchAgents()
    message.success(t('pages.agents.messages.identitySet'))
    showIdentityModal.value = false
  } catch (e: any) {
    message.error(e?.message || t('pages.agents.messages.identityFailed'))
  } finally {
    submitting.value = false
  }
}

async function handleSetModel() {
  submitting.value = true
  try {
    await agentStore.setAgentModel({
      agentId: selectedAgentIdForAction.value,
      model: modelForm.value.model || undefined,
    })
    // Refresh agents in background
    agentStore.fetchAgents()
    message.success(t('pages.agents.messages.modelSet'))
    showModelModal.value = false
  } catch (e: any) {
    message.error(e?.message || t('pages.agents.messages.modelFailed'))
  } finally {
    submitting.value = false
  }
}

async function handleSetTools() {
  submitting.value = true
  try {
    await agentStore.setAgentTools({
      agentId: selectedAgentIdForAction.value,
      allow: toolsForm.value.allow.length > 0 ? toolsForm.value.allow : undefined,
      deny: toolsForm.value.deny.length > 0 ? toolsForm.value.deny : undefined,
    })
    // Refresh agents in background
    agentStore.fetchAgents()
    message.success(t('pages.agents.messages.toolsSet'))
    showToolsModal.value = false
  } catch (e: any) {
    message.error(e?.message || t('pages.agents.messages.toolsFailed'))
  } finally {
    submitting.value = false
  }
}

function addToolToAllow(tool: string) {
  if (!toolsForm.value.allow.includes(tool)) {
    toolsForm.value.allow.push(tool)
  }
}

function removeToolFromAllow(tool: string) {
  toolsForm.value.allow = toolsForm.value.allow.filter((t) => t !== tool)
}

function addToolToDeny(tool: string) {
  if (!toolsForm.value.deny.includes(tool)) {
    toolsForm.value.deny.push(tool)
  }
}

function removeToolFromDeny(tool: string) {
  toolsForm.value.deny = toolsForm.value.deny.filter((t) => t !== tool)
}

const teamCount = computed(() => {
  return wizardStore.scenarios.length
})

onMounted(async () => {
  // Load office data and sessions concurrently — no sequential blocking
  const [loadDataResult] = await Promise.allSettled([
    loadData(),
    sessionStore.sessions.length === 0 ? sessionStore.fetchSessions() : Promise.resolve(),
  ])
  if (loadDataResult.status === 'rejected') {
    console.error('[OfficePage] loadData failed:', loadDataResult.reason)
  }
  if (!officeStore.selectedAgentId && officeStore.officeAgents.length > 0) {
    const mainAgent = officeStore.officeAgents.find((a) => a.id === 'main')
    if (mainAgent) {
      officeStore.selectAgent('main')
    } else if (officeStore.officeAgents[0]) {
      officeStore.selectAgent(officeStore.officeAgents[0].id)
    }
  }
})

watch(
  () => chatStore.sessionKey,
  (newSessionKey) => {
    if (!newSessionKey) return
    
    const match = newSessionKey.match(/^agent:([^:]+):/)
    if (!match || !match[1]) return
    
    const agentId = match[1]
    
    // 监听这个智能体的状态变化
    const unwatch = watch(() => {
      const agentStatus = chatStore.getOrCreateAgentStatus(agentId)
      return agentStatus.phase
    }, async (newPhase, oldPhase) => {
      if (newPhase === 'done' && oldPhase !== 'done') {
        // No artificial wait — refresh sessions immediately when agent finishes
        sessionStore.fetchSessions()
      }
    })
    
    // 清理函数
    return () => unwatch()
  }
)
</script>

<template>
  <NSpace vertical :size="16">
    <NCard :title="t('routes.office')" class="app-card office-main-card">
      <template #header-extra>
        <NSpace :size="12" align="center">
          <NButton type="primary" size="small" @click="handleCreateScenario">
            <template #icon><NIcon :component="AddOutline" /></template>
            {{ t('pages.office.createScenario') }}
          </NButton>
          <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" :loading="loading" @click="loadData">
            <template #icon><NIcon :component="RefreshOutline" /></template>
            {{ t('common.refresh') }}
          </NButton>
        </NSpace>
      </template>

      <NAlert v-if="error" type="error" :bordered="false" style="margin-bottom: 16px;">
        {{ error }}
      </NAlert>

      <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 16px;">
        {{ t('pages.office.subtitle') }}
      </NText>

      <NSpin :show="loading">
        <div class="office-layout">
          <div class="office-main">
            <div class="office-header">
              <NSpace align="center" :size="8">
                <NIcon :component="CubeOutline" size="24" />
                <NText strong style="font-size: 16px;">
                  {{ t('pages.office.floor') }}
                </NText>
              </NSpace>
              <NTag size="small" :bordered="false" round>
                {{ t('pages.office.agentsCount', { count: agents.length }) }}
              </NTag>
            </div>

            <div class="office-2d-view">
              <div class="agents-section">
                <div class="section-panel agents-panel">
                  <div class="section-header">
                    <NSpace align="center" :size="8">
                      <NIcon :component="PersonOutline" size="18" />
                      <NText strong style="font-size: 14px;">{{ t('pages.office.agentsLabel') }}</NText>
                    </NSpace>
                    <NTag size="small" :bordered="false" round>
                      {{ agents.length }}
                    </NTag>
                  </div>
                  <div class="section-content">
                    <div class="agents-grid">
                      <AgentCharacter
                        v-for="agent in agents"
                        :key="agent.id"
                        :agent="agent"
                        :selected="selectedAgentId === agent.id"
                        @select="handleAgentSelect"
                        @create-session="handleCreateSession"
                        @delegate="handleAgentDelegate"
                        @identity="handleOpenIdentityModal"
                        @model="handleOpenModelModal"
                        @tools="handleOpenToolsModal"
                        @delete="handleDeleteAgent"
                      />

                      <div class="add-agent-card" @click="openCreateAgentModal">
                        <div class="add-agent-card__avatar">
                          <NIcon :component="PersonOutline" size="32" />
                        </div>
                        <div class="add-agent-card__info">
                          <NText strong style="font-size: 13px;">{{ t('pages.office.addAgent') }}</NText>
                        </div>
                        <div class="add-agent-card__hint">
                          <NIcon :component="AddOutline" size="16" />
                        </div>
                      </div>

                      <div v-if="agents.length === 0" class="section-empty">
                        <NEmpty :description="t('pages.office.noAgents')" />
                      </div>
                    </div>
                  </div>
                </div>

                <div class="section-panel sessions-panel" :class="{ 'is-active': selectedAgentId }">
                  <div class="section-header">
                    <NSpace align="center" :size="8" class="section-header__title">
                      <NIcon :component="ChatbubbleOutline" size="18" />
                      <NText strong style="font-size: 14px;" class="section-header__text">
                        {{ selectedAgentId ? t('pages.office.sessions.title', { name: getSelectedAgentName() }) : t('pages.office.sessionsLabel') }}
                      </NText>
                    </NSpace>
                    <NSpace align="center" :size="8" class="section-header__actions">
                      <NTag v-if="selectedAgentId" size="small" :bordered="false" round>
                        {{ selectedAgentSessions.length }}
                      </NTag>
                      <NButton v-if="selectedAgentId" size="tiny" quaternary @click="handleAgentSelect('')">
                        <template #icon><NIcon :component="CloseOutline" /></template>
                      </NButton>
                    </NSpace>
                  </div>
                  <div class="section-content">
                    <div v-if="!selectedAgentId" class="section-empty">
                      <NEmpty :description="t('pages.office.selectAgentFirst')" />
                    </div>
                    <div v-else class="sessions-grid">
                      <div
                        v-for="session in selectedAgentSessions"
                        :key="session.key"
                        class="session-card"
                        :class="{ 'is-active': isSessionSelected(session) }"
                        @click="handleSelectSession(session.key)"
                      >
                        <div class="session-card__avatar">
                          <div class="session-avatar-ring">
                            <div class="session-avatar-inner">
                              <span class="session-avatar-text">{{ getSessionFirstChar(session) }}</span>
                            </div>
                          </div>
                          <div class="session-status-indicator" :class="isSessionActive(session) ? 'status-active' : 'status-idle'">
                            <span class="status-dot"></span>
                          </div>
                        </div>
                        <div class="session-card__info">
                          <NTooltip>
                            <template #trigger>
                              <NText strong style="font-size: 12px;" class="session-name">{{ getSessionLabel(session) }}</NText>
                            </template>
                            {{ getSessionLabel(session) }}
                          </NTooltip>
                          <div class="session-card__stats">
                            <div class="session-stat">
                              <NIcon :component="ChatbubbleOutline" size="12" />
                              <span>{{ session.messageCount || 0 }}</span>
                            </div>
                            <div class="session-stat">
                              <NIcon :component="PulseOutline" size="12" />
                              <span>{{ formatSessionTokens(session) }}</span>
                            </div>
                          </div>
                          <div class="session-card__time">
                            <NIcon :component="TimeOutline" size="12" />
                            <span>{{ formatRelativeTime(session.lastActivity) }}</span>
                          </div>
                        </div>
                        <div class="session-card__actions">
                          <NTooltip>
                            <template #trigger>
                              <NButton size="tiny" quaternary circle @click.stop="handleSpawnSession(session.key)">
                                <template #icon><NIcon :component="RefreshOutline" /></template>
                              </NButton>
                            </template>
                            {{ t('pages.sessions.list.newAction') }}
                          </NTooltip>
                          <NTooltip>
                            <template #trigger>
                              <NButton size="tiny" quaternary circle type="error" @click.stop="handleDeleteSession(session.key)">
                                <template #icon><NIcon :component="TrashOutline" /></template>
                              </NButton>
                            </template>
                            {{ t('common.delete') }}
                          </NTooltip>
                        </div>
                      </div>

                      <div class="add-session-card" @click="openCreateSessionModal">
                        <div class="add-session-card__avatar">
                          <NIcon :component="AddOutline" size="24" />
                        </div>
                        <div class="add-session-card__info">
                          <NText strong style="font-size: 12px;">{{ t('pages.office.newSession') }}</NText>
                        </div>
                      </div>

                      <div v-if="selectedAgentSessions.length === 0" class="section-empty">
                        <NEmpty :description="t('pages.office.sessions.noSessions')" />
                      </div>
                    </div>
                  </div>
                </div>

                <div class="bottom-panels">
                  <ScenarioManagementPanel 
                    @view-task="handleViewTask" 
                    @open-session="handleOpenSession"
                  />
                </div>
              </div>
            </div>
          </div>

          <div 
            ref="sidebarRef"
            class="office-sidebar" 
            :class="{ 'is-resizing': isSidebarResizing }"
            :style="{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` }"
          >
            <div class="sidebar-stats">
              <NCard size="small" embedded>
                <div class="stats-grid">
                  <div class="stat-item">
                    <NText depth="3" style="font-size: 11px;">{{ t('pages.office.totalAgents') }}</NText>
                    <NText strong style="font-size: 18px;">{{ agents.length }}</NText>
                  </div>
                  <div class="stat-item">
                    <NText depth="3" style="font-size: 11px;">{{ t('pages.office.activeAgents') }}</NText>
                    <NText strong style="font-size: 18px;">{{ agents.filter((a) => a.status === 'working').length }}</NText>
                  </div>
                  <div class="stat-item">
                    <NText depth="3" style="font-size: 11px;">{{ t('pages.office.totalSessions') }}</NText>
                    <NText strong style="font-size: 18px;">{{ sessionStore.sessions.length }}</NText>
                  </div>
                  <div class="stat-item">
                    <NText depth="3" style="font-size: 11px;">{{ t('pages.office.totalTokens') }}</NText>
                    <NText strong style="font-size: 18px;">
                      {{ agents.reduce((sum, a) => sum + a.totalTokens, 0) > 1000000
                        ? (agents.reduce((sum, a) => sum + a.totalTokens, 0) / 1000000).toFixed(1) + 'M'
                        : agents.reduce((sum, a) => sum + a.totalTokens, 0) > 1000
                          ? (agents.reduce((sum, a) => sum + a.totalTokens, 0) / 1000).toFixed(1) + 'K'
                          : agents.reduce((sum, a) => sum + a.totalTokens, 0)
                      }}
                    </NText>
                  </div>
                  <div class="stat-item">
                    <NText depth="3" style="font-size: 11px;">{{ t('pages.office.totalTeams') }}</NText>
                    <NText strong style="font-size: 18px;">{{ teamCount }}</NText>
                  </div>
                  <div class="stat-item">
                    <NText depth="3" style="font-size: 11px;">{{ t('pages.office.totalTasks') }}</NText>
                    <NText strong style="font-size: 18px;">{{ officeStore.tasks.length }}</NText>
                  </div>
                </div>
              </NCard>
            </div>

            <div class="sidebar-panels">
              <AgentChatPanel />
            </div>
          </div>
        </div>
      </NSpin>
    </NCard>

    <ScenarioWizard />

    <NModal
      v-model:show="showCreateModal"
      preset="card"
      :title="t('pages.sessions.list.createModal.title')"
      style="width: 500px; max-width: 90vw;"
      :mask-closable="false"
    >
      <NForm label-placement="left" label-width="80">
        <NFormItem :label="t('pages.sessions.list.createModal.agent')">
          <NSelect
            v-model:value="createForm.agentId"
            :options="agentOptions"
            :placeholder="t('pages.sessions.list.createModal.agentPlaceholder')"
          />
        </NFormItem>
        <NFormItem :label="t('pages.sessions.list.createModal.channel')">
          <NSelect
            v-model:value="createForm.channel"
            :options="channelOptionsForCreate"
            :placeholder="t('pages.sessions.list.createModal.channelPlaceholder')"
          />
        </NFormItem>
        <NFormItem :label="t('pages.sessions.list.createModal.peer')">
          <NInput
            v-model:value="createForm.peer"
            :placeholder="t('pages.sessions.list.createModal.peerPlaceholder')"
          />
        </NFormItem>
        <NFormItem :label="t('pages.sessions.list.createModal.label')">
          <NInput
            v-model:value="createForm.label"
            :placeholder="t('pages.sessions.list.createModal.labelPlaceholder')"
          />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showCreateModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="creating" @click="handleCreateSessionSubmit">
            {{ t('common.create') }}
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <NModal
      v-model:show="showCreateAgentModal"
      preset="card"
      :title="t('pages.agents.modal.createTitle')"
      style="width: 500px; max-width: 90vw;"
      :mask-closable="false"
    >
      <NForm label-placement="left" label-width="100">
        <NFormItem :label="t('pages.agents.form.id')" path="id">
          <NInput v-model:value="createAgentForm.id" :placeholder="t('pages.agents.form.idPlaceholder')" />
        </NFormItem>
        <NFormItem :label="t('pages.agents.form.name')" path="name">
          <NInput v-model:value="createAgentForm.name" :placeholder="t('pages.agents.form.namePlaceholder')" />
        </NFormItem>
        <NFormItem :label="t('pages.agents.form.workspace')" path="workspace">
          <NInput v-model:value="createAgentForm.workspace" :placeholder="t('pages.agents.form.workspacePlaceholder')" />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showCreateAgentModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="creatingAgent" @click="handleCreateAgent">
            {{ t('common.create') }}
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <NModal
      v-model:show="showIdentityModal"
      preset="card"
      :title="t('pages.agents.modal.identityTitle')"
      style="width: 500px; max-width: 90vw;"
      :mask-closable="false"
    >
      <NForm label-placement="left" label-width="80">
        <NFormItem :label="t('pages.agents.form.name')">
          <NInput v-model:value="identityForm.name" :placeholder="t('pages.agents.form.namePlaceholder')" />
        </NFormItem>
        <NFormItem :label="t('pages.agents.form.theme')">
          <NInput v-model:value="identityForm.theme" :placeholder="t('pages.agents.form.themePlaceholder')" />
        </NFormItem>
        <NFormItem :label="t('pages.agents.form.emoji')">
          <NInput v-model:value="identityForm.emoji" :placeholder="t('pages.agents.form.emojiPlaceholder')" />
        </NFormItem>
        <NFormItem :label="t('pages.agents.form.avatar')">
          <NInput v-model:value="identityForm.avatar" :placeholder="t('pages.agents.form.avatarPlaceholder')" />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showIdentityModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="submitting" @click="handleSetIdentity">
            {{ t('common.save') }}
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <NModal
      v-model:show="showModelModal"
      preset="card"
      :title="t('pages.agents.modal.modelTitle')"
      style="width: 500px; max-width: 90vw;"
      :mask-closable="false"
    >
      <NForm label-placement="left" label-width="80">
        <NFormItem :label="t('pages.agents.form.model')">
          <NSelect
            v-model:value="modelForm.model"
            :options="modelOptions"
            :placeholder="t('pages.agents.form.modelPlaceholder')"
            clearable
            filterable
          />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showModelModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="submitting" @click="handleSetModel">
            {{ t('common.save') }}
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <NModal
      v-model:show="showToolsModal"
      preset="card"
      :title="t('pages.agents.modal.toolsTitle')"
      style="width: 700px; max-width: 90vw;"
      :mask-closable="false"
    >
      <NSpace vertical size="large">
        <div>
          <NText depth="3" style="font-size: 12px; margin-bottom: 8px; display: block;">
            {{ t('pages.agents.form.toolsAllow') }}
          </NText>
          <NSpace size="small" style="margin-bottom: 8px;">
            <NTag
              v-for="tool in toolsForm.allow"
              :key="tool"
              type="success"
              closable
              @close="removeToolFromAllow(tool)"
            >
              {{ tool }}
            </NTag>
            <NInput
              :style="{ width: '120px' }"
              size="small"
              :placeholder="t('pages.agents.form.addTool')"
              @keydown.enter="(e: KeyboardEvent) => {
                const target = e.target as HTMLInputElement
                if (target.value.trim()) {
                  addToolToAllow(target.value.trim())
                  target.value = ''
                }
              }"
            />
          </NSpace>
        </div>

        <div>
          <NText depth="3" style="font-size: 12px; margin-bottom: 8px; display: block;">
            {{ t('pages.agents.form.toolsDeny') }}
          </NText>
          <NSpace size="small" style="margin-bottom: 8px;">
            <NTag
              v-for="tool in toolsForm.deny"
              :key="tool"
              type="error"
              closable
              @close="removeToolFromDeny(tool)"
            >
              {{ tool }}
            </NTag>
            <NInput
              :style="{ width: '120px' }"
              size="small"
              :placeholder="t('pages.agents.form.addTool')"
              @keydown.enter="(e: KeyboardEvent) => {
                const target = e.target as HTMLInputElement
                if (target.value.trim()) {
                  addToolToDeny(target.value.trim())
                  target.value = ''
                }
              }"
            />
          </NSpace>
        </div>

        <NDivider style="margin: 8px 0;" />

        <div>
          <NText depth="3" style="font-size: 12px; margin-bottom: 8px; display: block;">
            {{ t('pages.agents.form.commonTools') }}
          </NText>
          <NSpace vertical size="small">
            <div v-for="category in toolCategories" :key="category.nameKey">
              <NText depth="3" style="font-size: 11px; margin-right: 8px;">{{ t(category.nameKey) }}:</NText>
              <NSpace size="small" style="margin-top: 4px;">
                <NButton
                  v-for="tool in category.tools"
                  :key="tool"
                  size="tiny"
                  :type="toolsForm.allow.includes(tool) ? 'success' : toolsForm.deny.includes(tool) ? 'error' : 'default'"
                  :disabled="toolsForm.allow.includes(tool) || toolsForm.deny.includes(tool)"
                  @click="addToolToAllow(tool)"
                  @contextmenu.prevent="addToolToDeny(tool)"
                >
                  {{ tool }}
                </NButton>
              </NSpace>
            </div>
          </NSpace>
          <NText depth="3" style="font-size: 11px; margin-top: 8px; display: block;">
            {{ t('pages.agents.form.toolsHint') }}
          </NText>
        </div>
      </NSpace>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showToolsModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="submitting" @click="handleSetTools">
            {{ t('common.save') }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </NSpace>
</template>

<style scoped>
.office-main-card {
  min-height: calc(100vh - var(--header-height) - 100px);
  display: flex;
  flex-direction: column;
}

.office-main-card :deep(.n-card__content) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.office-layout {
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0;
}

@media (max-width: 1199px) {
  .office-layout {
    flex-direction: column;
  }
}

.office-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  flex: 1;
  min-width: 0;
}

.office-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}

.office-3d-view {
  height: 500px;
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.office-2d-view {
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  padding: 16px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.agents-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 0 0 auto;
  min-height: 0;
}

.section-panel {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.agents-panel {
  flex: 0 0 auto;
  min-height: 200px;
  max-height: 530px;
  overflow: hidden;
}

.agents-panel .section-content {
  max-height: 540px;
  overflow-y: auto;
}

.sessions-panel {
  flex: 0 0 auto;
  min-height: 200px;
  max-height: 480px;
  opacity: 0.6;
  transition: opacity 0.2s ease;
}

.sessions-panel.is-active {
  opacity: 1;
}

.sessions-panel .section-content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
  gap: 12px;
  min-width: 0;
}

.section-header__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.section-header__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.section-header__actions {
  flex-shrink: 0;
}

.section-content {
  padding: 12px;
  flex: 1;
  min-height: 0;
}

.section-content::-webkit-scrollbar {
  width: 6px;
}

.section-content::-webkit-scrollbar-track {
  background: transparent;
}

.section-content::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}

.section-content::-webkit-scrollbar-thumb:hover {
  background: var(--text-color-disabled);
}

.section-empty {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 120px;
}

.agents-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

.add-agent-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  border: 2px dashed var(--border-color);
  cursor: pointer;
  transition: all 0.2s ease;
  min-height: 140px;
  gap: 12px;
}

.add-agent-card:hover {
  border-color: var(--primary-color);
  background: rgba(24, 160, 88, 0.05);
}

.add-agent-card__avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--bg-card);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-color-disabled);
}

.add-agent-card:hover .add-agent-card__avatar {
  background: rgba(24, 160, 88, 0.1);
  color: var(--primary-color);
}

.add-agent-card__info {
  text-align: center;
}

.add-agent-card__hint {
  color: var(--text-color-disabled);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.add-agent-card:hover .add-agent-card__hint {
  opacity: 1;
  color: var(--primary-color);
}

.sessions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
  max-height: 360px;
  overflow-y: auto;
  padding: 4px;
  margin: -4px;
}

.session-card {
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  border: 1px solid var(--border-color);
  cursor: pointer;
  transition: all 0.25s ease;
  overflow: hidden;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  position: relative;
}

.session-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: var(--radius);
  opacity: 0;
  transition: opacity 0.25s ease;
  pointer-events: none;
  background: linear-gradient(135deg, rgba(24, 160, 88, 0.1) 0%, rgba(102, 126, 234, 0.1) 100%);
}

.session-card:hover {
  border-color: var(--primary-color);
  background: rgba(24, 160, 88, 0.05);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.session-card:hover::before {
  opacity: 1;
}

.session-card.is-active {
  border-color: #18a058;
  background: linear-gradient(135deg, rgba(24, 160, 88, 0.12) 0%, rgba(24, 160, 88, 0.08) 100%);
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(24, 160, 88, 0.2), 0 0 0 1px rgba(24, 160, 88, 0.3);
}

.session-card.is-active::before {
  opacity: 1;
  background: linear-gradient(135deg, rgba(24, 160, 88, 0.15) 0%, rgba(102, 126, 234, 0.08) 100%);
}

.session-card.is-active .session-avatar-ring {
  box-shadow: 0 0 16px rgba(24, 160, 88, 0.5);
}

.session-card__avatar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.session-avatar-ring {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    #667eea 0%,
    #764ba2 25%,
    #f093fb 50%,
    #f5576c 75%,
    #667eea 100%
  );
  display: flex;
  align-items: center;
  justify-content: center;
  animation: rotate-ring 8s linear infinite;
  box-shadow: 0 0 12px rgba(102, 126, 234, 0.4);
}

@keyframes rotate-ring {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.session-avatar-inner {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--bg-card);
  display: flex;
  align-items: center;
  justify-content: center;
}

.session-avatar-text {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-size: 18px;
  font-weight: 700;
}

.session-status-indicator {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--bg-card);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--bg-card);
}

.session-status-indicator .status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.session-status-indicator.status-active .status-dot {
  background: #18a058;
  box-shadow: 0 0 6px rgba(24, 160, 88, 0.6);
  animation: pulse-dot 2s ease-in-out infinite;
}

.session-status-indicator.status-idle .status-dot {
  background: #909399;
}

@keyframes pulse-dot {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.2); opacity: 0.7; }
}

.session-card__info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
  width: 100%;
}

.session-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  text-align: center;
}

.session-card__stats {
  display: flex;
  justify-content: center;
  gap: 12px;
  width: 100%;
}

.session-stat {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-color-disabled);
  font-size: 11px;
}

.session-card__time {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--text-color-disabled);
  font-size: 10px;
  opacity: 0.7;
}

.session-card__actions {
  display: flex;
  justify-content: center;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.session-card:hover .session-card__actions {
  opacity: 1;
}

.add-session-card {
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  border: 2px dashed var(--border-color);
  cursor: pointer;
  transition: all 0.2s ease;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.add-session-card:hover {
  border-color: var(--primary-color);
  background: rgba(24, 160, 88, 0.05);
}

.add-session-card__avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--bg-card);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-color-disabled);
}

.add-session-card:hover .add-session-card__avatar {
  background: rgba(24, 160, 88, 0.1);
  color: var(--primary-color);
}

.add-session-card__info {
  text-align: center;
}

.desk-empty {
  grid-column: 1 / -1;
  padding: 48px;
  text-align: center;
}

.office-sidebar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow: hidden;
  flex-shrink: 0;
  position: relative;
}

.office-sidebar::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: ew-resize;
  background: transparent;
  transition: background 0.2s ease;
  z-index: 10;
}

.office-sidebar:hover::before {
  background: linear-gradient(90deg, rgba(59, 130, 246, 0.3) 0%, transparent 100%);
}

.office-sidebar.is-resizing::before {
  background: linear-gradient(90deg, rgba(59, 130, 246, 0.5) 0%, transparent 100%);
}

.office-sidebar.is-resizing {
  transition: none;
}

.sidebar-stats {
  flex-shrink: 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
}

.sidebar-panels {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 0 0 auto;
  min-height: 0;
}

.sidebar-panels > * {
  flex: 0 0 auto;
  min-height: 0;
}

.bottom-panels {
  margin-top: 10px;
}

@media (max-width: 1199px) {
  .office-sidebar {
    flex-direction: row;
    flex-wrap: wrap;
    width: 100% !important;
    min-width: 0 !important;
  }

  .office-sidebar::before {
    display: none;
  }

  .sidebar-stats {
    width: 100%;
  }

  .sidebar-panels {
    flex-direction: column;
    width: 100%;
  }

  .sidebar-panels > * {
    flex: none;
    min-width: 300px;
  }

  .bottom-panels {
    flex-direction: column;
  }

  .bottom-panels > * {
    flex: none;
  }
}
</style>
