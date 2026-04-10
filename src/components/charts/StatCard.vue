<template>
  <div class="stat-card">
    <div class="stat-icon" :style="{ background: iconBg }">
      <NIcon :size="24" :color="iconColor">
        <component :is="icon" />
      </NIcon>
    </div>
    
    <div class="stat-content">
      <div class="stat-value">
        <CountUp :value="value" :duration="1.5" />
      </div>
      <div class="stat-label">{{ label }}</div>
      <div v-if="trend !== null && trend !== undefined" class="stat-trend" :class="trend >= 0 ? 'up' : 'down'">
        <NIcon :size="12">
          <component :is="trend >= 0 ? ArrowUpOutline : ArrowDownOutline" />
        </NIcon>
        {{ Math.abs(trend || 0) }}%
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NIcon } from 'naive-ui'
import { ArrowUpOutline, ArrowDownOutline } from '@vicons/ionicons5'

interface CountUpProps {
  value: number
  duration?: number
}

const CountUp = {
  props: ['value', 'duration'],
  setup(props: CountUpProps) {
    return () => props.value.toLocaleString()
  }
}

defineProps<{
  icon: any
  value: number
  label: string
  trend?: number | null
  iconBg?: string
  iconColor?: string
}>()
</script>

<style scoped>
.stat-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: var(--n-color);
  border-radius: 8px;
  transition: transform 0.2s, box-shadow 0.2s;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-content {
  flex: 1;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--n-text-color);
}

.stat-label {
  font-size: 14px;
  color: var(--n-text-color-3);
  margin-top: 4px;
}

.stat-trend {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  margin-top: 4px;
  padding: 2px 8px;
  border-radius: 4px;
}

.stat-trend.up {
  color: #52c41a;
  background: rgba(82, 196, 26, 0.1);
}

.stat-trend.down {
  color: #ff4d4f;
  background: rgba(255, 77, 79, 0.1);
}
</style>
