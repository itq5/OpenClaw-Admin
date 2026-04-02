<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NCard,
  NGrid,
  NGridItem,
  NProgress,
  NSpace,
  NStatistic,
  NText,
  NTag,
  NIcon,
  NButton,
  NAlert,
} from 'naive-ui'
import {
  RefreshOutline,
  HardwareChipOutline,
  ServerOutline,
  SaveOutline,
  WifiOutline,
  TimeOutline,
} from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { formatRelativeTime } from '@/utils/format'
import type { SystemMetrics, SystemPresenceEntry } from '@/api/types'
import AsyncSection from '@/components/common/AsyncSection.vue'
import { useRpcSafe } from '@/composables/useRpcSafe'

const { t } = useI18n()
const router = useRouter()
const authStore = useAuthStore()
const rpc = useRpcSafe()

const loading = ref(false)
const error = ref('')
const metrics = ref<SystemMetrics | null>(null)
const presenceEntries = ref<SystemPresenceEntry[]>([])
const lastUpdatedAt = ref<number | null>(null)

let refreshTimer: ReturnType<typeof setInterval> | null = null

const cpuUsage = computed(() => metrics.value?.cpu?.usage ?? 0)
const memoryUsage = computed(() => metrics.value?.memory?.usagePercent ?? 0)
const diskUsage = computed(() => metrics.value?.disk?.usagePercent ?? 0)

const cpuColor = computed(() => {
  const usage = cpuUsage.value
  if (usage < 50) return '#18a058'
  if (usage < 80) return '#f0a020'
  return '#d03050'
})

const memoryColor = computed(() => {
  const usage = memoryUsage.value
  if (usage < 60) return '#18a058'
  if (usage < 85) return '#f0a020'
  return '#d03050'
})

const diskColor = computed(() => {
  const usage = diskUsage.value
  if (usage < 70) return '#18a058'
  if (usage < 90) return '#f0a020'
  return '#d03050'
})

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (mins > 0) parts.push(`${mins}m`)
  return parts.join(' ') || '< 1m'
}

async function fetchMetrics() {
  loading.value = true
  error.value = ''
  try {
    const data = await rpc.call(
      () =>
        fetch('/api/system/metrics', {
          headers: {
            Authorization: `Bearer ${authStore.token || localStorage.getItem('auth_token') || ''}`,
          },
        }).then((r) => r.json()),
      { label: 'getSystemMetrics', timeout: 8000, retries: 1 }
    )

    if (!data) return

    if (data.status === 401) {
      error.value = t('pages.system.authRequired')
      return
    }

    if (!data.ok) {
      throw new Error(data.error?.message || t('pages.system.loadFailed'))
    }

    metrics.value = data.metrics
    presenceEntries.value = Array.isArray(data.presence) ? data.presence : []
    lastUpdatedAt.value = Date.now()
  } catch (e: any) {
    error.value = e?.message || t('pages.system.loadFailed')
  } finally {
    loading.value = false
  }
}

function goToLogin() {
  router.push('/login')
}

onMounted(() => {
  void fetchMetrics()
  refreshTimer = setInterval(fetchMetrics, 5000)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})
</script>

<template>
  <NSpace vertical :size="16">
    <NCard :title="t('routes.system')" class="app-card">
      <template #header-extra>
        <NButton size="small" class="app-toolbar-btn app-toolbar-btn--refresh" :loading="loading" @click="fetchMetrics">
          <template #icon><NIcon :component="RefreshOutline" /></template>
          {{ t('common.refresh') }}
        </NButton>
      </template>

      <NAlert v-if="error" type="error" :bordered="false" style="margin-bottom: 16px;">
        <NSpace align="center" justify="space-between">
          <span>{{ error }}</span>
          <NButton v-if="error === t('pages.system.authRequired')" size="small" type="primary" @click="goToLogin">
            {{ t('pages.system.login') }}
          </NButton>
        </NSpace>
      </NAlert>

      <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 16px;">
        {{ t('pages.system.subtitle') }}
      </NText>

      <AsyncSection :loading="loading && !metrics" error-title="Failed to load system metrics" @retry="fetchMetrics">
        <NGrid cols="1 s:2 m:4" responsive="screen" :x-gap="16" :y-gap="16">
          <NGridItem>
            <NCard size="small" embedded class="metric-card">
              <template #header>
                <NSpace align="center" :size="8">
                  <NIcon :component="HardwareChipOutline" :color="cpuColor" size="20" />
                  <NText strong>CPU</NText>
                </NSpace>
              </template>
              <div class="metric-content">
                <NProgress
                  type="circle"
                  :percentage="cpuUsage"
                  :color="cpuColor"
                  :stroke-width="12"
                  :show-indicator="false"
                  style="width: 80px;"
                />
                <div class="metric-stats">
                  <NStatistic :value="cpuUsage.toFixed(1)" suffix="%">
                    <template #label>{{ t('pages.system.usage') }}</template>
                  </NStatistic>
                  <NText depth="3" style="font-size: 12px;">
                    {{ metrics?.cpu?.cores ?? '-' }} {{ t('pages.system.cores') }}
                  </NText>
                </div>
              </div>
            </NCard>
          </NGridItem>

          <NGridItem>
            <NCard size="small" embedded class="metric-card">
              <template #header>
                <NSpace align="center" :size="8">
                  <NIcon :component="ServerOutline" :color="memoryColor" size="20" />
                  <NText strong>{{ t('pages.system.memory') }}</NText>
                </NSpace>
              </template>
              <div class="metric-content">
                <NProgress
                  type="circle"
                  :percentage="memoryUsage"
                  :color="memoryColor"
                  :stroke-width="12"
                  :show-indicator="false"
                  style="width: 80px;"
                />
                <div class="metric-stats">
                  <NStatistic :value="memoryUsage.toFixed(1)" suffix="%">
                    <template #label>{{ t('pages.system.usage') }}</template>
                  </NStatistic>
                  <NText depth="3" style="font-size: 12px;">
                    {{ formatBytes(metrics?.memory?.used ?? 0) }} / {{ formatBytes(metrics?.memory?.total ?? 0) }}
                  </NText>
                </div>
              </div>
            </NCard>
          </NGridItem>

          <NGridItem>
            <NCard size="small" embedded class="metric-card">
              <template #header>
                <NSpace align="center" :size="8">
                  <NIcon :component="SaveOutline" :color="diskColor" size="20" />
                  <NText strong>{{ t('pages.system.disk') }}</NText>
                </NSpace>
              </template>
              <div class="metric-content">
                <NProgress
                  type="circle"
                  :percentage="diskUsage"
                  :color="diskColor"
                  :stroke-width="12"
                  :show-indicator="false"
                  style="width: 80px;"
                />
                <div class="metric-stats">
                  <NStatistic :value="diskUsage.toFixed(1)" suffix="%">
                    <template #label>{{ t('pages.system.usage') }}</template>
                  </NStatistic>
                  <NText depth="3" style="font-size: 12px;">
                    {{ formatBytes(metrics?.disk?.used ?? 0) }} / {{ formatBytes(metrics?.disk?.total ?? 0) }}
                  </NText>
                </div>
              </div>
            </NCard>
          </NGridItem>

          <NGridItem>
            <NCard size="small" embedded class="metric-card">
              <template #header>
                <NSpace align="center" :size="8">
                  <NIcon :component="WifiOutline" color="#2080f0" size="20" />
                  <NText strong>{{ t('pages.system.network') }}</NText>
                </NSpace>
              </template>
              <div class="metric-content">
                <div class="metric-stats metric-stats--full">
                  <div class="network-stat">
                    <NText depth="3" style="font-size: 12px;">RX</NText>
                    <NText strong>{{ formatBytes(metrics?.network?.bytesReceived ?? 0) }}</NText>
                  </div>
                  <div class="network-stat">
                    <NText depth="3" style="font-size: 12px;">TX</NText>
                    <NText strong>{{ formatBytes(metrics?.network?.bytesSent ?? 0) }}</NText>
                  </div>
                  <div v-if="metrics?.network?.connections" class="network-stat">
                    <NText depth="3" style="font-size: 12px;">{{ t('pages.system.connections') }}</NText>
                    <NText strong>{{ metrics.network.connections }}</NText>
                  </div>
                </div>
              </div>
            </NCard>
          </NGridItem>
        </NGrid>

        <NGrid cols="1 s:2 m:3" responsive="screen" :x-gap="16" :y-gap="16" style="margin-top: 16px;">
          <NGridItem>
            <NCard size="small" embedded>
              <template #header>
                <NSpace align="center" :size="8">
                  <NIcon :component="TimeOutline" color="#18a058" size="18" />
                  <NText strong>{{ t('pages.system.uptime') }}</NText>
                </NSpace>
              </template>
              <NText style="font-size: 18px; font-weight: 600;">
                {{ formatUptime(metrics?.uptime ?? 0) }}
              </NText>
            </NCard>
          </NGridItem>

          <NGridItem>
            <NCard size="small" embedded>
              <template #header>
                <NText strong>{{ t('pages.system.platform') }}</NText>
              </template>
              <NSpace :size="8">
                <NTag v-if="metrics?.platform" :bordered="false" round>{{ metrics.platform }}</NTag>
                <NTag v-if="metrics?.hostname" :bordered="false" round type="info">{{ metrics.hostname }}</NTag>
              </NSpace>
            </NCard>
          </NGridItem>

          <NGridItem>
            <NCard size="small" embedded>
              <template #header>
                <NText strong>{{ t('pages.system.instances') }}</NText>
              </template>
              <NSpace :size="8">
                <NTag type="success" :bordered="false" round>
                  {{ presenceEntries.length }} {{ t('pages.system.online') }}
                </NTag>
              </NSpace>
            </NCard>
          </NGridItem>
        </NGrid>
      </AsyncSection>

      <NText v-if="lastUpdatedAt" depth="3" style="font-size: 12px; display: block; margin-top: 16px;">
        {{ t('pages.system.lastUpdated', { time: formatRelativeTime(lastUpdatedAt) }) }}
      </NText>
    </NCard>
  </NSpace>
</template>

<style scoped>
.metric-card {
  border-radius: var(--radius-lg);
}

.metric-content {
  display: flex;
  align-items: center;
  gap: 16px;
}

.metric-stats {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-stats--full {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 16px;
}

.network-stat {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
</style>