<script setup lang="ts">
import { h, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NMenu, NText } from 'naive-ui'
import type { MenuOption } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import {
  GridOutline,
  ChatboxEllipsesOutline,
  ChatbubblesOutline,
  BookOutline,
  CalendarOutline,
  SparklesOutline,
  GitNetworkOutline,
  ExtensionPuzzleOutline,
  CogOutline,
  PulseOutline,
  FolderOutline,
  PeopleOutline,
  BusinessOutline,
  StorefrontOutline,
  ConstructOutline,
  TerminalOutline,
  DesktopOutline,
  ArchiveOutline,
  SettingsOutline,
  CodeSlashOutline,
} from '@vicons/ionicons5'
import { NIcon } from 'naive-ui'
import { routes } from '@/router/routes'
import { useHermesConnectionStore } from '@/stores/hermes/connection'

defineProps<{ collapsed: boolean }>()

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const connStore = useHermesConnectionStore()

const iconMap: Record<string, unknown> = {
  GridOutline,
  ChatboxEllipsesOutline,
  ChatbubblesOutline,
  BookOutline,
  CalendarOutline,
  SparklesOutline,
  GitNetworkOutline,
  ExtensionPuzzleOutline,
  CogOutline,
  PulseOutline,
  FolderOutline,
  PeopleOutline,
  BusinessOutline,
  StorefrontOutline,
  ConstructOutline,
  TerminalOutline,
  DesktopOutline,
  ArchiveOutline,
  SettingsOutline,
  CodeSlashOutline,
}

function renderIcon(iconName: string) {
  const icon = iconMap[iconName]
  if (!icon) return undefined
  return () => h(NIcon, null, { default: () => h(icon as any) })
}

const menuOptions = computed<MenuOption[]>(() => {
  const mainRoute = routes.find((r) => r.path === '/')
  if (!mainRoute?.children) return []

  const currentGateway = connStore.currentGateway

  return mainRoute.children
    .filter((child) => {
      if (child.meta?.hidden) return false

      const gateway = child.meta?.gateway as string | undefined

      // Only show routes matching the current gateway
      return gateway === currentGateway
    })
    .map((child) => ({
      label: child.meta?.titleKey ? t(child.meta.titleKey as string) : (child.meta?.title as string),
      key: child.name as string,
      icon: child.meta?.icon ? renderIcon(child.meta.icon as string) : undefined,
    }))
})

const activeKey = computed(() => {
  return route.name as string
})

function handleSelect(key: string) {
  router.push({ name: key })
}
</script>

<template>
  <div style="display: flex; flex-direction: column; height: 100%;">
    <div style="display: flex; align-items: center; padding: 20px 24px; gap: 10px;">
      <img
        v-if="connStore.currentGateway === 'hermes'"
        src="/hermes-logo.png"
        alt="Hermes"
        style="width: 24px; height: 24px; object-fit: contain;"
      />
      <span v-else style="font-size: 24px;">🦞</span>
      <NText
        v-if="!collapsed"
        strong
        style="font-size: 18px; white-space: nowrap; letter-spacing: -0.5px;"
      >
        {{ connStore.currentGateway === 'hermes' ? 'Hermes Agent' : 'OpenClaw-Admin' }}
      </NText>
    </div>

    <NMenu
      :value="activeKey"
      :collapsed="collapsed"
      :collapsed-width="64"
      :collapsed-icon-size="20"
      :options="menuOptions"
      :indent="24"
      @update:value="handleSelect"
    />
  </div>
</template>
