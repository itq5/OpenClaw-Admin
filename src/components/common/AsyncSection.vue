<script setup lang="ts">
/**
 * AsyncSection — Unified loading / error / empty / default render container.
 *
 * Props:
 *   loading      – show skeleton / spinner instead of content
 *   refreshing  – show a subtle refresh indicator strip at top
 *   error       – Error instance or string; shows error state with retry button
 *   isEmpty     – true when there is no data to show (renders empty slot)
 *   showSkeleton – render skeleton slot while loading (default true)
 *   skeletonHeight – CSS height of skeleton placeholder (default '120px')
 *   errorLabel  – accessibility label for the error alert title
 *
 * Slots:
 *   skeleton    – custom skeleton (shown when loading && showSkeleton)
 *   refreshing  – shown above default content when refreshing
 *   error       – error content (default: error message + retry button)
 *   empty       – shown when data is loaded but empty
 *   default     – the actual content; always rendered so it stays mounted
 *
 * Emits:
 *   retry – fired when the built-in retry button is clicked
 *
 * Usage:
 *   <AsyncSection :loading="statsLoading" :error="statsError">
 *     <template #skeleton><div class="skeleton" /></template>
 *     <template #default>...content...</template>
 *   </AsyncSection>
 *
 *   <AsyncSection :loading="loading" :error="error" :is-empty="items.length === 0">
 *     <template #empty>No items found.</template>
 *     <template #default>...content...</template>
 *   </AsyncSection>
 */
import { computed } from 'vue'
import { NAlert, NButton, NEmpty } from 'naive-ui'

const props = withDefaults(
  defineProps<{
    loading?: boolean
    refreshing?: boolean
    error?: Error | string | null
    isEmpty?: boolean
    showSkeleton?: boolean
    skeletonHeight?: string
    errorLabel?: string
  }>(),
  {
    loading: false,
    refreshing: false,
    error: null,
    isEmpty: false,
    showSkeleton: true,
    skeletonHeight: '120px',
    errorLabel: 'Error',
  }
)

const emit = defineEmits<{
  retry: []
}>()

const errorMessage = computed<string>(() => {
  if (!props.error) return ''
  if (props.error instanceof Error) return props.error.message
  return String(props.error)
})

const showLoading = computed(() => props.loading && !props.refreshing)
</script>

<template>
  <div class="async-section" :class="{ 'async-section--refreshing': refreshing }">
    <!-- Loading skeleton -->
    <div v-if="showLoading && showSkeleton" class="async-section__skeleton">
      <slot name="skeleton">
        <div class="async-section__skeleton-default" :style="{ height: skeletonHeight }" />
      </slot>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="async-section__error">
      <slot name="error">
        <NAlert type="error" :bordered="false" :title="errorLabel">
          {{ errorMessage }}
        </NAlert>
        <div class="async-section__error-actions">
          <NButton size="small" @click="emit('retry')">重试 / Retry</NButton>
        </div>
      </slot>
    </div>

    <!-- Empty state -->
    <div v-else-if="isEmpty" class="async-section__empty">
      <slot name="empty">
        <NEmpty description="暂无数据 / No data" />
      </slot>
    </div>

    <!-- Default content — always rendered so it stays mounted across state transitions -->
    <div v-else class="async-section__content">
      <!-- Subtle refreshing indicator (thin shimmer strip at top) -->
      <div v-if="refreshing" class="async-section__refreshing-bar" />

      <slot />
    </div>
  </div>
</template>

<style scoped>
.async-section {
  position: relative;
  width: 100%;
}

.async-section--refreshing .async-section__content {
  opacity: 0.85;
}

/* Skeleton */
.async-section__skeleton {
  width: 100%;
}

.async-section__skeleton-default {
  width: 100%;
  border-radius: 10px;
  background: linear-gradient(
    90deg,
    var(--border-color) 25%,
    rgba(42, 127, 255, 0.1) 50%,
    var(--border-color) 75%
  );
  background-size: 200% 100%;
  animation: async-section-shimmer 1.4s ease-in-out infinite;
}

/* Error */
.async-section__error {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.async-section__error-actions {
  display: flex;
  justify-content: flex-start;
}

/* Empty */
.async-section__empty {
  width: 100%;
  padding: 24px 0;
  display: flex;
  justify-content: center;
}

/* Refreshing top strip */
.async-section__refreshing-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(42, 127, 255, 0.8) 40%,
    rgba(42, 127, 255, 0.8) 60%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: async-section-refresh-slide 1.2s ease-in-out infinite;
  border-radius: 1px;
  z-index: 1;
}

.async-section__content {
  width: 100%;
  transition: opacity 0.2s ease;
}

@keyframes async-section-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@keyframes async-section-refresh-slide {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
