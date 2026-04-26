<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NGrid,
  NGridItem,
  NIcon,
  NInput,
  NSelect,
  NSpace,
  NSpin,
  NSwitch,
  NTag,
  NText,
  useMessage,
} from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import {
  AppsOutline,
  CheckmarkCircleOutline,
  FilterOutline,
  RefreshOutline,
  SearchOutline,
  StopCircleOutline,
  FolderOpenOutline,
  ChevronDownOutline,
  ChevronUpOutline,
} from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useHermesSkillStore } from '@/stores/hermes/skill'
import SkillFileBrowser from '@/components/hermes/SkillFileBrowser.vue'

const { t } = useI18n()
const skillStore = useHermesSkillStore()
const message = useMessage()
const searchQuery = ref('')
const categoryFilter = ref<string>('all')
const expandedSkill = ref<string | null>(null)

// ---- 分类颜色映射 ----

const categoryColorMap: Record<string, string> = {
  communication: 'info',
  tool: 'success',
  knowledge: 'warning',
  agent: 'error',
  system: 'default',
}

function getCategoryType(category: string): string {
  const lower = category.toLowerCase()
  for (const [key, type] of Object.entries(categoryColorMap)) {
    if (lower.includes(key)) return type
  }
  return 'default'
}

// ---- 统计 ----

const enabledCount = computed(() => skillStore.skills.filter((s) => s.enabled).length)
const disabledCount = computed(() => skillStore.skills.filter((s) => !s.enabled).length)
const categoriesCount = computed(
  () => new Set(skillStore.skills.map((s) => s.category).filter(Boolean)).size,
)

// ---- 分类筛选 ----

const categoryOptions = computed<SelectOption[]>(() => {
  const set = new Set(skillStore.skills.map((s) => s.category).filter((c): c is string => Boolean(c)))
  return [
    { label: t('pages.hermesSkills.filterAllCategories'), value: 'all' },
    ...Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((cat) => ({ label: cat, value: cat })),
  ]
})

// ---- 技能列表过滤 ----

const filteredSkills = computed(() => {
  let list = skillStore.skills
  if (categoryFilter.value !== 'all') {
    list = list.filter((s) => s.category === categoryFilter.value)
  }
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q) ||
      (s.category || '').toLowerCase().includes(q),
  )
})

// ---- 生命周期 ----

onMounted(() => {
  skillStore.fetchSkills().catch(() => {
    message.error(t('pages.hermesSkills.loadFailed'))
  })
})

// ---- 操作 ----

async function handleRefresh() {
  try {
    await skillStore.fetchSkills()
  } catch {
    message.error(t('pages.hermesSkills.loadFailed'))
  }
}

async function handleToggle(name: string, enabled: boolean) {
  try {
    await skillStore.toggleSkill(name, enabled)
    message.success(enabled ? t('pages.hermesSkills.enableSuccess') : t('pages.hermesSkills.disableSuccess'))
  } catch {
    message.error(t('pages.hermesSkills.toggleFailed'))
  }
}

function handleSkillClick(skillName: string) {
  if (expandedSkill.value === skillName) {
    expandedSkill.value = null
  } else {
    expandedSkill.value = skillName
  }
}

function handleCloseBrowser() {
  expandedSkill.value = null
}
</script>

<template>
  <div class="hermes-skills-page">
    <!-- 顶部英雄区域：标题 + 统计面板 -->
    <NCard class="hermes-hero" :bordered="false">
      <template #header>
        <div class="hermes-hero-title">{{ t('pages.hermesSkills.title') }}</div>
      </template>
      <template #header-extra>
        <NSpace :size="8">
          <NButton size="small" :loading="skillStore.loading" @click="handleRefresh">
            <template #icon><NIcon :component="RefreshOutline" /></template>
            {{ t('common.refresh') }}
          </NButton>
        </NSpace>
      </template>

      <NAlert v-if="skillStore.lastError" type="error" :bordered="false" closable style="margin-bottom: 12px;">
        {{ skillStore.lastError }}
      </NAlert>

      <!-- 统计卡片 -->
      <NGrid cols="4" :x-gap="10" :y-gap="10">
        <NGridItem>
          <NCard embedded :bordered="false" class="hermes-metric-card">
            <NSpace justify="space-between" align="center">
              <NText depth="3">{{ t('pages.hermesSkills.stats.total') }}</NText>
              <NIcon :component="AppsOutline" />
            </NSpace>
            <div class="hermes-metric-value">{{ skillStore.skills.length }}</div>
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard embedded :bordered="false" class="hermes-metric-card">
            <NSpace justify="space-between" align="center">
              <NText depth="3">{{ t('pages.hermesSkills.stats.enabled') }}</NText>
              <NIcon :component="CheckmarkCircleOutline" />
            </NSpace>
            <div class="hermes-metric-value">{{ enabledCount }}</div>
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard embedded :bordered="false" class="hermes-metric-card">
            <NSpace justify="space-between" align="center">
              <NText depth="3">{{ t('pages.hermesSkills.stats.disabled') }}</NText>
              <NIcon :component="StopCircleOutline" />
            </NSpace>
            <div class="hermes-metric-value">{{ disabledCount }}</div>
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard embedded :bordered="false" class="hermes-metric-card">
            <NSpace justify="space-between" align="center">
              <NText depth="3">{{ t('pages.hermesSkills.stats.categories') }}</NText>
              <NIcon :component="FilterOutline" />
            </NSpace>
            <div class="hermes-metric-value">{{ categoriesCount }}</div>
          </NCard>
        </NGridItem>
      </NGrid>

      <!-- 筛选栏 -->
      <div class="hermes-filter-bar">
        <NInput
          v-model:value="searchQuery"
          clearable
          :placeholder="t('pages.hermesSkills.searchPlaceholder')"
        >
          <template #prefix><NIcon :component="SearchOutline" /></template>
        </NInput>
        <NSelect
          v-model:value="categoryFilter"
          :options="categoryOptions"
          :placeholder="t('pages.hermesSkills.filterCategoryPlaceholder')"
        />
      </div>
    </NCard>

    <!-- 技能卡片网格 -->
    <NCard class="app-card" :bordered="false">
      <template #header>
        <NSpace align="center" :size="8">
          <NText strong style="font-size: 15px;">{{ t('pages.hermesSkills.skillList') }}</NText>
          <NTag size="small" :bordered="false" round type="info">
            {{ filteredSkills.length }}
          </NTag>
        </NSpace>
      </template>

      <NSpin :show="skillStore.loading">
        <div v-if="filteredSkills.length > 0" class="skills-list">
          <template v-for="skill in filteredSkills" :key="skill.name">
            <div class="hermes-skill-card" :class="{ 'hermes-skill-card--disabled': !skill.enabled, 'hermes-skill-card--expanded': expandedSkill === skill.name }">
              <!-- 头部：名称 + 标签 -->
              <div class="hermes-skill-card__header" @click="handleSkillClick(skill.name)">
                <NText strong class="hermes-skill-card__name">{{ skill.name }}</NText>
                <NSpace :size="6" align="center">
                  <NTag
                    v-if="skill.version"
                    size="tiny"
                    :bordered="false"
                    round
                    type="default"
                  >
                    v{{ skill.version }}
                  </NTag>
                  <NTag
                    v-if="skill.category"
                    size="tiny"
                    :bordered="false"
                    round
                    :type="getCategoryType(skill.category) as any"
                  >
                    {{ skill.category }}
                  </NTag>
                  <NIcon 
                    :component="expandedSkill === skill.name ? ChevronUpOutline : ChevronDownOutline" 
                    size="16"
                    class="hermes-skill-card__expand-icon"
                  />
                </NSpace>
              </div>

              <!-- 描述 -->
              <NText
                depth="3"
                class="hermes-skill-card__desc"
                @click="handleSkillClick(skill.name)"
              >
                {{ skill.description || t('common.noDescription') }}
              </NText>

              <!-- 底部：状态 + 开关 -->
              <div class="hermes-skill-card__footer">
                <NSpace :size="8" align="center">
                  <NTag
                    size="small"
                    :bordered="false"
                    round
                    :type="skill.enabled ? 'success' : 'default'"
                  >
                    {{ skill.enabled ? t('common.enabled') : t('common.disabled') }}
                  </NTag>
                  <NButton 
                    size="tiny" 
                    quaternary 
                    type="info"
                    @click.stop="handleSkillClick(skill.name)"
                  >
                    <template #icon><NIcon :component="FolderOpenOutline" /></template>
                    {{ t('pages.hermesSkills.viewFiles') }}
                  </NButton>
                </NSpace>
                <NSwitch
                  :value="skill.enabled"
                  size="small"
                  @update:value="(val: boolean) => handleToggle(skill.name, val)"
                />
              </div>
            </div>
            
            <!-- 技能文件浏览器（紧跟在展开的技能卡片后面） -->
            <div v-if="expandedSkill === skill.name" class="skill-file-browser-wrapper">
              <SkillFileBrowser
                :skill-name="skill.name"
                :skill-category="skill.category"
                :skill-path="skill.path"
                auto-open-file="SKILL.md"
                @close="handleCloseBrowser"
              />
            </div>
          </template>
        </div>

        <NText v-else-if="!skillStore.loading" depth="3" class="hermes-empty">
          {{ t('common.empty') }}
        </NText>
      </NSpin>
    </NCard>
  </div>
</template>

<style scoped>
.hermes-skills-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ---- 英雄区域 ---- */

.hermes-hero {
  border-radius: var(--card-radius-xl);
  background:
    radial-gradient(circle at 84% 16%, rgba(22, 163, 74, 0.18), transparent 36%),
    linear-gradient(135deg, rgba(22, 163, 74, 0.08), rgba(59, 130, 246, 0.08));
  border: 1px solid rgba(22, 163, 74, 0.18);
}

.hermes-hero-title {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
}

/* ---- 统计卡片 ---- */

.hermes-metric-card {
  border-radius: 10px;
}

.hermes-metric-value {
  margin-top: 8px;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
}

/* ---- 筛选栏 ---- */

.hermes-filter-bar {
  margin-top: 12px;
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 8px;
}

/* ---- 技能列表 ---- */

.skills-list {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

@media (max-width: 1200px) {
  .skills-list {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .skills-list {
    grid-template-columns: 1fr;
  }
}

.skill-file-browser-wrapper {
  grid-column: 1 / -1;
  width: 100%;
}

/* ---- 技能卡片 ---- */

.hermes-skill-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-sm);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.hermes-skill-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  border-color: rgba(22, 163, 74, 0.25);
}

.hermes-skill-card--disabled {
  opacity: 0.72;
}

.hermes-skill-card--disabled:hover {
  opacity: 1;
}

.hermes-skill-card__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
}

.hermes-skill-card__name {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  word-break: break-word;
}

.hermes-skill-card__expand-icon {
  color: var(--text-tertiary);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.hermes-skill-card:hover .hermes-skill-card__expand-icon {
  color: var(--link-color);
}

.hermes-skill-card--expanded {
  border-color: rgba(22, 163, 74, 0.4);
}

.hermes-skill-card__desc {
  font-size: 13px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.hermes-skill-card__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
}

/* ---- 空状态 ---- */

.hermes-empty {
  display: block;
  text-align: center;
  padding: 40px 0;
}

/* ---- 响应式 ---- */

@media (max-width: 768px) {
  .hermes-filter-bar {
    grid-template-columns: 1fr;
  }
}
</style>
