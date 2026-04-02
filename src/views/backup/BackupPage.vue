<script setup lang="ts">
import { onMounted, onUnmounted, ref, h, computed } from 'vue'
import {
  NCard,
  NGrid,
  NGridItem,
  NSpace,
  NText,
  NButton,
  NAlert,
  NDataTable,
  NPopconfirm,
  NUpload,
  NModal,
  NIcon,
  NEmpty,
  NProgress,
  NCollapse,
  NCollapseItem,
  NTag,
  useMessage,
  type DataTableColumns,
  type UploadFileInfo,
} from 'naive-ui'
import {
  SaveOutline,
  DownloadOutline,
  TrashOutline,
  CloudUploadOutline,
  ArchiveOutline,
  RefreshOutline,
  InformationCircleOutline,
  CheckmarkCircleOutline,
  CloseCircleOutline,
  TimeOutline,
} from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useBackupStore } from '@/stores/backup'
import { useWebSocketStore } from '@/stores/websocket'
import AsyncSection from '@/components/common/AsyncSection.vue'
import { useRpcSafe } from '@/composables/useRpcSafe'
import type { BackupItem, BackupTask } from '@/api/types/backup'

const { t } = useI18n()
const message = useMessage()
const backupStore = useBackupStore()
const wsStore = useWebSocketStore()
const rpc = useRpcSafe()

const showRestoreModal = ref(false)
const selectedBackup = ref<string | null>(null)

const activeTask = computed(() => {
  const tasks = backupStore.activeTasks
  return tasks.length > 0 ? tasks[0] : null
})

const hasRunningTask = computed(() => {
  return backupStore.hasActiveTask
})

const recentTasks = computed(() => {
  return Array.from(backupStore.tasks.values())
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 5)
})

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatTaskStatus(status: BackupTask['status']): string {
  const statusMap: Record<BackupTask['status'], string> = {
    pending: t('pages.backup.taskStatus.pending'),
    running: t('pages.backup.taskStatus.running'),
    completed: t('pages.backup.taskStatus.completed'),
    failed: t('pages.backup.taskStatus.failed'),
  }
  return statusMap[status] || status
}

function getTaskStatusType(status: BackupTask['status']): 'default' | 'success' | 'warning' | 'error' | 'info' {
  const typeMap: Record<BackupTask['status'], 'default' | 'success' | 'warning' | 'error' | 'info'> = {
    pending: 'default',
    running: 'info',
    completed: 'success',
    failed: 'error',
  }
  return typeMap[status] || 'default'
}

function translateProgressMessage(message: string): string {
  const keyMap: Record<string, string> = {
    'Starting backup...': 'pages.backup.progress.starting',
    'Creating OpenClaw backup...': 'pages.backup.progress.openclawBackup',
    'Backing up project database...': 'pages.backup.progress.wizardDb',
    'Backing up environment config...': 'pages.backup.progress.envConfig',
    'Creating archive...': 'pages.backup.progress.creatingZip',
    'Cleaning up...': 'pages.backup.progress.cleaningUp',
    'Backup completed successfully': 'pages.backup.progress.completed',
    'Starting restore...': 'pages.backup.progress.starting',
    'Extracting backup archive...': 'pages.backup.progress.extractingZip',
    'Reading legacy backup file...': 'pages.backup.progress.extractingZip',
    'Restoring OpenClaw data...': 'pages.backup.progress.restoringOpenclaw',
    'Restoring project database...': 'pages.backup.progress.restoringDb',
    'Restoring environment config...': 'pages.backup.progress.restoringEnv',
    'Restore completed successfully': 'pages.backup.progress.restoreCompleted',
    'Validating uploaded file...': 'pages.backup.progress.starting',
    'Validating legacy backup...': 'pages.backup.progress.starting',
    'Saving backup...': 'pages.backup.progress.creatingZip',
    'Backup uploaded successfully': 'pages.backup.progress.uploadCompleted',
  }
  const key = keyMap[message]
  return key ? t(key) : message
}

function handleBackupProgress(...args: unknown[]) {
  const data = args[0] as { taskId: string; status: string; progress: number; message: string; result?: unknown; error?: string }
  backupStore.updateTaskProgress({
    taskId: data.taskId,
    status: data.status as BackupTask['status'],
    progress: data.progress,
    message: data.message,
  })

  if (data.status === 'completed') {
    backupStore.completeTask(data.taskId, data.result as BackupTask['result'])
    backupStore.fetchBackupList()
    message.success(translateProgressMessage(data.message) || t('pages.backup.taskCompleted'))
  } else if (data.status === 'failed') {
    backupStore.completeTask(data.taskId, undefined, data.error)
    message.error(translateProgressMessage(data.message) || t('pages.backup.taskFailed'))
  }
}

async function fetchBackupList() {
  try {
    await backupStore.fetchBackupList()
  } catch (e: any) {
    message.error(e?.message || t('pages.backup.fetchFailed'))
  }
}

async function createBackup() {
  if (hasRunningTask.value) {
    message.warning(t('pages.backup.taskInProgress'))
    return
  }

  try {
    await backupStore.createBackup()
  } catch (e: any) {
    message.error(e?.message || t('pages.backup.createFailed'))
  }
}

async function downloadBackup(filename: string) {
  try {
    await backupStore.downloadBackup(filename)
  } catch (e: any) {
    message.error(e?.message || t('pages.backup.downloadFailed'))
  }
}

async function restoreBackup(filename: string) {
  if (hasRunningTask.value) {
    message.warning(t('pages.backup.taskInProgress'))
    return
  }

  try {
    await backupStore.restoreBackup({ filename })
    showRestoreModal.value = false
    selectedBackup.value = null
  } catch (e: any) {
    message.error(e?.message || t('pages.backup.restoreFailed'))
  }
}

async function deleteBackup(filename: string) {
  try {
    await backupStore.deleteBackup(filename)
    message.success(t('pages.backup.deleteSuccess'))
  } catch (e: any) {
    message.error(e?.message || t('pages.backup.deleteFailed'))
  }
}

async function handleUpload({ file }: { file: UploadFileInfo }) {
  if (hasRunningTask.value) {
    message.warning(t('pages.backup.taskInProgress'))
    return false
  }

  try {
    await backupStore.uploadBackup(file.file as File)
  } catch (e: any) {
    message.error(e?.message || t('pages.backup.uploadFailed'))
  }
  return false
}

function openRestoreModal(filename: string) {
  selectedBackup.value = filename
  showRestoreModal.value = true
}

function clearCompletedTasks() {
  backupStore.clearCompletedTasks()
}

const backupColumns: DataTableColumns<BackupItem> = [
  {
    title: () => t('pages.backup.columns.date'),
    key: 'date',
    width: 180,
  },
  {
    title: () => t('pages.backup.columns.size'),
    key: 'size',
    width: 120,
    render: (row) => formatBytes(row.size),
  },
  {
    title: () => t('pages.backup.columns.actions'),
    key: 'actions',
    width: 220,
    render: (row) => {
      return h(NSpace, { size: 'small' }, () => [
        h(NButton, {
          size: 'small',
          quaternary: true,
          onClick: () => downloadBackup(row.filename),
        }, {
          icon: () => h(NIcon, { component: DownloadOutline }),
          default: () => t('pages.backup.download')
        }),
        h(NButton, {
          size: 'small',
          quaternary: true,
          type: 'warning',
          disabled: hasRunningTask.value,
          onClick: () => openRestoreModal(row.filename),
        }, { default: () => t('pages.backup.restore') }),
        h(NPopconfirm, {
          onPositiveClick: () => deleteBackup(row.filename),
        }, {
          trigger: () => h(NButton, {
            size: 'small',
            quaternary: true,
            type: 'error',
          }, { icon: () => h(NIcon, { component: TrashOutline }) }),
          default: () => t('pages.backup.deleteConfirm'),
        }),
      ])
    },
  },
]

let unsubscribe: (() => void) | null = null
let unsubscribeDisconnect: (() => void) | null = null

onMounted(() => {
  void backupStore.initialize()
  void backupStore.fetchTasks()
  unsubscribe = wsStore.subscribe('backupProgress', handleBackupProgress)
  unsubscribeDisconnect = wsStore.subscribe('disconnected', () => {
    if (backupStore.hasActiveTask) {
      backupStore.markRunningTasksAsFailed('Connection lost - task interrupted')
    }
  })
})

onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  if (unsubscribeDisconnect) {
    unsubscribeDisconnect()
    unsubscribeDisconnect = null
  }
})
</script>

<template>
  <NSpace vertical :size="16">
    <NCard :title="t('routes.backup')" class="app-card">
      <template #header-extra>
        <NSpace :size="8">
          <NButton size="small" type="primary" :loading="hasRunningTask" :disabled="hasRunningTask" @click="createBackup">
            <template #icon><NIcon :component="SaveOutline" /></template>
            {{ t('pages.backup.create') }}
          </NButton>
          <NUpload
            :custom-request="handleUpload"
            :show-file-list="false"
            accept=".zip,.gz"
            :disabled="hasRunningTask"
          >
            <NButton size="small" :disabled="hasRunningTask">
              <template #icon><NIcon :component="CloudUploadOutline" /></template>
              {{ t('pages.backup.upload') }}
            </NButton>
          </NUpload>
          <NButton size="small" :loading="backupStore.loading" @click="fetchBackupList">
            <template #icon><NIcon :component="RefreshOutline" /></template>
            {{ t('common.refresh') }}
          </NButton>
        </NSpace>
      </template>

      <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 16px;">
        {{ t('pages.backup.subtitle') }}
      </NText>

      <NGrid cols="1 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16" style="margin-bottom: 24px;">
        <NGridItem>
          <NCard size="small" embedded>
            <template #header>
              <NSpace align="center" :size="8">
                <NIcon :component="ArchiveOutline" color="#18a058" size="18" />
                <NText strong>{{ t('pages.backup.totalBackups') }}</NText>
              </NSpace>
            </template>
            <NText style="font-size: 24px; font-weight: 600;">{{ backupStore.backupList.length }}</NText>
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard size="small" embedded>
            <template #header>
              <NSpace align="center" :size="8">
                <NIcon :component="SaveOutline" color="#2080f0" size="18" />
                <NText strong>{{ t('pages.backup.totalSize') }}</NText>
              </NSpace>
            </template>
            <NText style="font-size: 24px; font-weight: 600;">
              {{ formatBytes(backupStore.backupList.reduce((sum, b) => sum + b.size, 0)) }}
            </NText>
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard size="small" embedded>
            <template #header>
              <NSpace align="center" :size="8">
                <NIcon :component="InformationCircleOutline" color="#f0a020" size="18" />
                <NText strong>{{ t('pages.backup.latestBackup') }}</NText>
              </NSpace>
            </template>
            <NText v-if="backupStore.backupList.length > 0" style="font-size: 14px; font-weight: 500;">
              {{ backupStore.backupList[0]?.date || '-' }}
            </NText>
            <NText v-else depth="3">{{ t('pages.backup.noBackups') }}</NText>
          </NCard>
        </NGridItem>
      </NGrid>

      <div v-if="activeTask" style="margin-bottom: 16px;">
        <NCard size="small" embedded>
          <template #header>
            <NSpace align="center" :size="8">
              <NIcon :component="TimeOutline" :color="activeTask.status === 'running' ? '#2080f0' : '#18a058'" size="18" />
              <NText strong>{{ t('pages.backup.activeTask') }}</NText>
              <NTag :type="getTaskStatusType(activeTask.status)" size="small">
                {{ formatTaskStatus(activeTask.status) }}
              </NTag>
            </NSpace>
          </template>
          <NSpace vertical :size="8">
            <NText>{{ translateProgressMessage(activeTask.message) }}</NText>
            <NProgress
              :percentage="activeTask.progress"
              :status="activeTask.status === 'failed' ? 'error' : activeTask.status === 'completed' ? 'success' : 'default'"
              :show-indicator="true"
            />
          </NSpace>
        </NCard>
      </div>

      <AsyncSection :loading="backupStore.loading" error-title="Failed to load backups" @retry="backupStore.fetchBackupList()">
        <NDataTable
          :columns="backupColumns"
          :data="backupStore.backupList"
          :bordered="false"
          size="small"
          :row-key="(row: BackupItem) => row.filename"
        />
        <div v-if="!backupStore.loading && backupStore.backupList.length === 0" style="padding: 48px 0; text-align: center;">
          <NEmpty :description="t('pages.backup.emptyHint')">
            <template #extra>
              <NButton size="small" type="primary" :disabled="hasRunningTask" @click="createBackup">
                {{ t('pages.backup.createFirst') }}
              </NButton>
            </template>
          </NEmpty>
        </div>
      </AsyncSection>
    </NCard>

    <NCard v-if="recentTasks.length > 0" class="app-card">
      <template #header>
        <NSpace align="center" justify="space-between" style="width: 100%;">
          <NText strong>{{ t('pages.backup.recentTasks') }}</NText>
          <NButton size="small" quaternary @click="clearCompletedTasks">
            {{ t('pages.backup.clearCompleted') }}
          </NButton>
        </NSpace>
      </template>
      <NCollapse>
        <NCollapseItem
          v-for="task in recentTasks"
          :key="task.id"
          :name="task.id"
        >
          <template #header>
            <NSpace align="center" :size="8">
              <NIcon
                :component="task.status === 'completed' ? CheckmarkCircleOutline : task.status === 'failed' ? CloseCircleOutline : TimeOutline"
                :color="task.status === 'completed' ? '#18a058' : task.status === 'failed' ? '#d03050' : '#2080f0'"
              />
              <NText>
                {{ task.type === 'create' ? t('pages.backup.taskType.create') : task.type === 'restore' ? t('pages.backup.taskType.restore') : t('pages.backup.taskType.upload') }}
              </NText>
              <NTag :type="getTaskStatusType(task.status)" size="small">
                {{ formatTaskStatus(task.status) }}
              </NTag>
              <NText depth="3" style="font-size: 12px;">
                {{ new Date(task.startedAt).toLocaleString() }}
              </NText>
            </NSpace>
          </template>
          <NSpace vertical :size="8">
            <NText>{{ translateProgressMessage(task.message) }}</NText>
            <NProgress
              :percentage="task.progress"
              :status="task.status === 'failed' ? 'error' : task.status === 'completed' ? 'success' : 'default'"
            />
            <div v-if="task.result">
              <NText depth="3" style="font-size: 12px;">
                {{ t('pages.backup.result') }}:
                <span v-if="task.result.filename">{{ task.result.filename }}</span>
                <span v-if="task.result.size"> ({{ formatBytes(task.result.size) }})</span>
              </NText>
            </div>
            <NAlert v-if="task.error" type="error" :bordered="false">
              {{ task.error }}
            </NAlert>
          </NSpace>
        </NCollapseItem>
      </NCollapse>
    </NCard>

    <NCard class="app-card">
      <template #header>
        <NText strong>{{ t('pages.backup.info.title') }}</NText>
      </template>
      <NSpace vertical :size="12">
        <NAlert type="info" :bordered="false">
          <template #header>{{ t('pages.backup.info.whatIsBackup') }}</template>
          {{ t('pages.backup.info.backupContent') }}
        </NAlert>
        <NAlert type="success" :bordered="false">
          <template #header>{{ t('pages.backup.info.restoreNote') }}</template>
          {{ t('pages.backup.info.restoreContent') }}
        </NAlert>
      </NSpace>
    </NCard>

    <NModal v-model:show="showRestoreModal" preset="dialog" :title="t('pages.backup.restoreTitle')">
      <NSpace vertical :size="12">
        <NAlert type="warning" :bordered="false">
          {{ t('pages.backup.restoreWarning') }}
        </NAlert>
        <NText>{{ t('pages.backup.selectedBackup') }}: <code>{{ selectedBackup }}</code></NText>
        <NText depth="3" style="font-size: 12px;">
          {{ t('pages.backup.autoBackupNote') }}
        </NText>
      </NSpace>
      <template #action>
        <NSpace justify="end">
          <NButton @click="showRestoreModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="warning" :loading="hasRunningTask" :disabled="hasRunningTask" @click="restoreBackup(selectedBackup!)">
            {{ t('pages.backup.confirmRestore') }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </NSpace>
</template>

<style scoped>
.backup-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.backup-stat-card {
  text-align: center;
  padding: 16px;
  border-radius: var(--radius-lg);
  background: var(--bg-secondary);
}
</style>
