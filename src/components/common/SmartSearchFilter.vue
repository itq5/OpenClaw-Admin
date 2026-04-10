<template>
  <div class="smart-search-filter">
    <!-- 搜索框 -->
    <div class="search-section">
      <NInput
        v-model:value="searchQuery"
        :placeholder="t('search.placeholder')"
        clearable
        size="large"
        @update:value="handleSearch"
      >
        <template #prefix>
          <NIcon><SearchOutline /></NIcon>
        </template>
        <template #suffix>
          <NButton v-if="isSearching" type="info" size="small" @click="cancelSearch">
            {{ t('search.cancel') }}
          </NButton>
          <NButton v-else type="primary" size="small" @click="handleSearch">
            {{ t('search.search') }}
          </NButton>
        </template>
      </NInput>

      <!-- 搜索建议 -->
      <div v-if="showSuggestions && suggestions.length > 0" class="search-suggestions">
        <NCard v-for="(suggestion, index) in suggestions" 
               :key="index" 
               size="small" 
               class="suggestion-item"
               @click="applySuggestion(suggestion)">
          <NText>{{ suggestion }}</NText>
        </NCard>
      </div>
    </div>

    <!-- 筛选器 -->
    <div v-if="filters && filters.length > 0" class="filter-section">
      <NDivider>{{ t('search.filters') }}</NDivider>
      
      <NSpace wrap size="large">
        <div v-for="filter in filters" :key="filter.key" class="filter-group">
          <NText depth="3" style="margin-right: 8px;">{{ filter?.label }}</NText>
          
          <!-- 单选筛选 -->
          <NSelect
            v-if="filter.type === 'single'"
            v-model:value="filterValues[filter.key]"
            :options="filter.options as SelectMixedOption[]"
            :placeholder="filter.placeholder"
            size="small"
            style="width: 150px"
            @update:value="handleFilterChange"
          />
          
          <!-- 多选筛选 -->
          <NSelect
            v-if="filter.type === 'multiple'"
            v-model:value="filterValues[filter.key]"
            :options="filter.options as SelectMixedOption[]"
            :placeholder="filter.placeholder"
            multiple
            size="small"
            style="width: 200px"
            @update:value="handleFilterChange"
          />
          
          <!-- 日期范围筛选 -->
          <template v-if="filter.type === 'dateRange'">
            <NDatePicker
              v-model:value="filterValues[filter.key]"
              type="daterange"
              :placeholder="[filter.placeholderStart, filter.placeholderEnd]"
              size="small"
              style="width: 250px"
              @update:value="handleFilterChange"
            />
          </template>
        </div>
      </NSpace>

      <!-- 快速筛选标签 -->
      <div v-if="quickFilters && quickFilters.length > 0" class="quick-filters">
        <NTag
          v-for="qf in quickFilters"
          :key="qf.key"
          :type="activeQuickFilter === qf.key ? 'primary' : 'default'"
          size="small"
          round
          @click="toggleQuickFilter(qf.key)"
        >
          {{ qf.label }}
        </NTag>
      </div>
    </div>

    <!-- 搜索结果统计 -->
    <div v-if="resultCount !== null" class="result-stats">
      <NText depth="3">
        {{ t('search.results', { count: resultCount, total: totalItems }) }}
      </NText>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import {
  NInput,
  NIcon,
  NButton,
  NCard,
  NText,
  NSelect,
  NSpace,
  NTag,
  NDivider,
  NDatePicker,
} from 'naive-ui'
import { SearchOutline } from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'

interface FilterOption {
  label: string
  value: string | number
}

interface SelectMixedOption {
  label: string
  value: string | number
  type?: string
}

interface FilterConfig {
  key: string
  label: string
  type: 'single' | 'multiple' | 'dateRange'
  options?: SelectMixedOption[]
  placeholder?: string
  placeholderStart?: string
  placeholderEnd?: string
}

interface QuickFilter {
  key: string
  label: string
  filters: Record<string, any>
}

const props = defineProps<{
  filters?: FilterConfig[]
  quickFilters?: QuickFilter[]
  totalItems?: number
  debounceMs?: number
}>()

const emit = defineEmits<{
  (e: 'search', query: string, filters: any): void
  (e: 'update:query', query: string): void
  (e: 'update:filters', filters: any): void
}>()

const { t, locale } = useI18n()

const searchQuery = ref('')
const filterValues = ref<Record<string, any>>({})
const showSuggestions = ref(false)
const suggestions = ref<string[]>([])
const isSearching = ref(false)
const resultCount = ref<number | null>(null)
const activeQuickFilter = ref<string | null>(null)

let searchTimer: ReturnType<typeof setTimeout> | null = null

// 初始化筛选器默认值
onMounted(() => {
  if (props.filters) {
    props.filters.forEach(filter => {
      filterValues.value[filter.key] = filter.type === 'multiple' ? [] : null
    })
  }
})

function handleSearch(): void {
  isSearching.value = true
  resultCount.value = null
  
  // 模拟搜索延迟
  setTimeout(() => {
    isSearching.value = false
    resultCount.value = Math.floor(Math.random() * props.totalItems!)
    emit('search', searchQuery.value, getActiveFilters())
  }, props.debounceMs || 300)
}

function cancelSearch(): void {
  searchQuery.value = ''
  isSearching.value = false
  showSuggestions.value = false
  emit('search', '', {})
}

function handleFilterChange(): void {
  emit('search', searchQuery.value, getActiveFilters())
}

function getActiveFilters(): Record<string, any> {
  const active: Record<string, any> = {}
  
  Object.entries(filterValues.value).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      if (Array.isArray(value) && value.length > 0) {
        active[key] = value
      } else if (!Array.isArray(value)) {
        active[key] = value
      }
    }
  })
  
  return active
}

function applySuggestion(suggestion: string): void {
  searchQuery.value = suggestion
  showSuggestions.value = false
  handleSearch()
}

function toggleQuickFilter(key: string): void {
  if (activeQuickFilter.value === key) {
    // 取消筛选
    activeQuickFilter.value = null
    searchQuery.value = ''
    filterValues.value = {}
    emit('search', '', {})
  } else {
    // 应用快速筛选
    activeQuickFilter.value = key
    const qf = props.quickFilters?.find(f => f.key === key)
    if (qf) {
      // 重置其他筛选器
      Object.keys(filterValues.value).forEach(k => {
        filterValues.value[k] = null
      })
      // 应用新筛选器
      Object.entries(qf.filters).forEach(([k, v]) => {
        if (filterValues.value.hasOwnProperty(k)) {
          filterValues.value[k] = v
        }
      })
      emit('search', '', getActiveFilters())
    }
  }
}

// 监听搜索变化，实现防抖
watch(searchQuery, (newQuery) => {
  if (searchTimer) {
    clearTimeout(searchTimer)
  }
  
  if (newQuery.trim()) {
    // 显示建议（模拟）
    suggestions.value = [
      `${newQuery} 相关`,
      `${newQuery} 配置`,
      `${newQuery} 任务`,
    ]
    showSuggestions.value = true
    
    searchTimer = setTimeout(() => {
      handleSearch()
    }, props.debounceMs || 300)
  } else {
    showSuggestions.value = false
    emit('search', '', getActiveFilters())
  }
})

// 暴露方法给父组件
defineExpose({
  reset: () => {
    searchQuery.value = ''
    activeQuickFilter.value = null
    Object.keys(filterValues.value).forEach(k => {
      filterValues.value[k] = null
    })
    emit('search', '', {})
  },
  getFilters: getActiveFilters
})
</script>

<style scoped>
.smart-search-filter {
  padding: 16px;
  background: var(--n-color);
  border-radius: 8px;
  margin-bottom: 16px;
}

.search-section {
  position: relative;
  margin-bottom: 16px;
}

.search-suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 100;
  background: var(--n-color);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  margin-top: 4px;
}

.suggestion-item {
  cursor: pointer;
  margin-bottom: 4px;
  transition: background 0.2s;
}

.suggestion-item:hover {
  background: var(--n-color-hover);
}

.filter-section {
  margin-top: 16px;
}

.filter-group {
  display: flex;
  align-items: center;
}

.quick-filters {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.result-stats {
  margin-top: 12px;
  padding: 8px;
  background: var(--n-color-embedded);
  border-radius: 4px;
}
</style>
