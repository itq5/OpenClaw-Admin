<template>
  <NCard :title="t('cron.editor.title')" :bordered="false" size="small">
    <NSpace vertical size="large">
      <!-- 快速预设模板 -->
      <div v-if="showPresets" class="preset-templates">
        <NText depth="3">{{ t('cron.editor.quickPresets') }}</NText>
        <NSpace wrap>
          <NButton
            v-for="preset in quickPresets"
            :key="preset.id"
            size="small"
            @click="applyPreset(preset)"
          >
            {{ preset.label }}
          </NButton>
        </NSpace>
      </div>

      <!-- 调度类型选择 -->
      <NForm :model="scheduleForm" label-placement="left">
        <NFormItem :label="t('cron.editor.scheduleType')">
          <NRadioGroup v-model:value="scheduleForm.scheduleType">
            <NRadio value="cron">{{ t('cron.editor.cron') }}</NRadio>
            <NRadio value="every">{{ t('cron.editor.every') }}</NRadio>
            <NRadio value="at">{{ t('cron.editor.at') }}</NRadio>
          </NRadioGroup>
        </NFormItem>

        <!-- Cron 表达式编辑 -->
        <template v-if="scheduleForm.scheduleType === 'cron'">
          <NFormItem :label="t('cron.editor.cronExpression')">
            <NInput
              v-model:value="scheduleForm.cronExpression"
              placeholder="* * * * *"
              @blur="validateCron"
            />
          </NFormItem>

          <!-- Cron 字段可视化选择器 -->
          <div class="cron-fields">
            <div v-for="field in cronFields" :key="field.key" class="cron-field">
              <NText depth="3">{{ field.label }}</NText>
              <NSpace wrap>
                <NButton
                  v-for="option in field.options"
                  :key="option.value"
                  size="small"
                  :type="isSelected(field.key, option.value) ? 'primary' : 'default'"
                  @click="toggleCronValue(field.key, option.value)"
                >
                  {{ option.label }}
                </NButton>
              </NSpace>
            </div>
          </div>

          <!-- 执行预览 -->
          <NAlert type="info" :title="t('cron.editor.nextRuns')">
            <div class="cron-preview-list">
              <div v-for="(run, idx) in nextRunPreviews" :key="idx" class="cron-preview-item">
                <NText depth="3">{{ idx + 1 }}. {{ run }}</NText>
              </div>
            </div>
          </NAlert>
        </template>

        <!-- 每隔 X 时间 -->
        <template v-if="scheduleForm.scheduleType === 'every'">
          <NGrid :cols="2" :x-gap="16">
            <NGridItem>
              <NFormItem :label="t('cron.editor.interval')">
                <NInputNumber
                  v-model:value="scheduleForm.everyValue"
                  :min="1"
                  placeholder="1"
                  style="width: 100%"
                />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem :label="t('cron.editor.unit')">
                <NSelect
                  v-model:value="scheduleForm.everyUnit"
                  :options="everyUnitOptions"
                  style="width: 100%"
                />
              </NFormItem>
            </NGridItem>
          </NGrid>
        </template>

        <!-- 指定时间 -->
        <template v-if="scheduleForm.scheduleType === 'at'">
          <NFormItem :label="t('cron.editor.specificTime')">
            <NTimePicker
              v-model:value="scheduleForm.specificTime"
              format="HH:mm"
              style="width: 200px"
            />
          </NFormItem>
          <NFormItem :label="t('cron.editor.specificDate')">
            <NDatePicker
              v-model:value="scheduleForm.specificDate"
              type="date"
              format="YYYY-MM-DD"
              style="width: 250px"
            />
          </NFormItem>
        </template>
      </NForm>

      <!-- 操作按钮 -->
      <NSpace>
        <NButton @click="resetForm">{{ t('common.reset') }}</NButton>
        <NButton type="primary" @click="emit('save', getScheduleData())">
          {{ t('common.save') }}
        </NButton>
      </NSpace>
    </NSpace>
  </NCard>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import {
  NCard,
  NButton,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NText,
  NRadio,
  NRadioGroup,
  NAlert,
  NTimePicker,
  NDatePicker,
  NGrid,
  NGridItem,
  useMessage,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { CronExpressionParser } from 'cron-parser'

const message = useMessage()

const cronParser = CronExpressionParser

interface CronPreset {
  id: string
  label: string
  cronExpression: string
  description: string
}

interface ScheduleForm {
  scheduleType: 'cron' | 'every' | 'at'
  cronExpression: string
  everyValue: number | null
  everyUnit: 'minutes' | 'hours' | 'days'
  specificTime: number | null
  specificDate: number | null
}

const props = defineProps<{
  showPresets?: boolean
  initialSchedule?: string
}>()

const emit = defineEmits<{
  save: [schedule: any]
}>()

const { t, locale } = useI18n()

const scheduleForm = ref<ScheduleForm>({
  scheduleType: 'cron',
  cronExpression: '* * * * *',
  everyValue: 1,
  everyUnit: 'minutes',
  specificTime: null,
  specificDate: null,
})

const quickPresets: CronPreset[] = [
  { id: 'minutely', label: '每分钟', cronExpression: '* * * * *', description: '每分钟执行一次' },
  { id: 'hourly', label: '每小时', cronExpression: '0 * * * *', description: '每小时整点执行' },
  { id: 'daily', label: '每天', cronExpression: '0 0 * * *', description: '每天凌晨执行' },
  { id: 'weekly', label: '每周', cronExpression: '0 0 * * 0', description: '每周日凌晨执行' },
  { id: 'monthly', label: '每月', cronExpression: '0 0 1 * *', description: '每月 1 号执行' },
]

const cronFields = computed(() => [
  {
    key: 'minutes',
    label: t('cron.editor.minutes'),
    options: Array.from({ length: 60 }, (_, i) => ({ value: i.toString(), label: i.toString() })),
  },
  {
    key: 'hours',
    label: t('cron.editor.hours'),
    options: Array.from({ length: 24 }, (_, i) => ({ value: i.toString(), label: i.toString() })),
  },
  {
    key: 'days',
    label: t('cron.editor.daysOfMonth'),
    options: Array.from({ length: 31 }, (_, i) => ({ value: (i + 1).toString(), label: (i + 1).toString() })),
  },
  {
    key: 'months',
    label: t('cron.editor.months'),
    options: [
      { value: '1', label: '1 月' },
      { value: '2', label: '2 月' },
      { value: '3', label: '3 月' },
      { value: '4', label: '4 月' },
      { value: '5', label: '5 月' },
      { value: '6', label: '6 月' },
      { value: '7', label: '7 月' },
      { value: '8', label: '8 月' },
      { value: '9', label: '9 月' },
      { value: '10', label: '10 月' },
      { value: '11', label: '11 月' },
      { value: '12', label: '12 月' },
    ],
  },
  {
    key: 'weekdays',
    label: t('cron.editor.weekdays'),
    options: [
      { value: '0', label: t('cron.editor.sunday') },
      { value: '1', label: t('cron.editor.monday') },
      { value: '2', label: t('cron.editor.tuesday') },
      { value: '3', label: t('cron.editor.wednesday') },
      { value: '4', label: t('cron.editor.thursday') },
      { value: '5', label: t('cron.editor.friday') },
      { value: '6', label: t('cron.editor.saturday') },
    ],
  },
])

const everyUnitOptions = [
  { label: t('cron.editor.minutes'), value: 'minutes' },
  { label: t('cron.editor.hours'), value: 'hours' },
  { label: t('cron.editor.days'), value: 'days' },
]

const cronPreview = computed(() => {
  const expr = scheduleForm.value.cronExpression
  return `${t('cron.editor.lastRunPreview')}: ${parseCronPreview(expr)}`
})

const nextRunPreviews = computed(() => {
  const expr = scheduleForm.value.cronExpression
  return getNextRunTimes(expr, 5)
})

function getNextRunTimes(expr: string, count: number = 5): string[] {
  try {
    const parts = expr.split(' ')
    if (parts.length !== 5) return [t('cron.editor.invalidCron')]
    
    // 使用 cron-parser 库解析
    const interval = CronExpressionParser.parse(expr)
    
    const runs: string[] = []
    for (let i = 0; i < count; i++) {
      try {
        const next = interval.next()
        runs.push(next.toDate().toLocaleString('zh-CN'))
      } catch {
        break
      }
    }
    
    return runs.length > 0 ? runs : [t('cron.editor.noNextRun')]
  } catch (error) {
    return [t('cron.editor.invalidCron')]
  }
}

function parseCronPreview(expr: string): string {
  // 简化版的 cron 预览
  const parts = expr.split(' ')
  if (parts.length !== 5) return t('cron.editor.invalidCron')
  
  const [min, hour, day, month, weekday] = parts
  
  if (min === '*' && hour === '*') return t('cron.editor.everyMinute')
  if (min === '0' && hour === '*') return t('cron.editor.everyHour')
  if (min === '0' && hour === '0' && day === '*') return t('cron.editor.everyDay')
  if (min === '0' && hour === '0' && day === '*' && weekday === '0') return t('cron.editor.everyWeek')
  if (min === '0' && hour === '0' && day === '1') return t('cron.editor.everyMonth')
  
  return expr
}

function isSelected(fieldKey: string, value: string): boolean {
  const parts = scheduleForm.value.cronExpression.split(' ')
  const fieldIndex = ['minutes', 'hours', 'days', 'months', 'weekdays'].indexOf(fieldKey)
  if (fieldIndex === -1) return false
  
  const fieldValue = parts[fieldIndex]
  return fieldValue === value || fieldValue === '*'
}

function toggleCronValue(fieldKey: string, value: string): void {
  const parts = scheduleForm.value.cronExpression.split(' ')
  const fieldIndex = ['minutes', 'hours', 'days', 'months', 'weekdays'].indexOf(fieldKey)
  if (fieldIndex === -1) return

  const current = parts[fieldIndex] ?? '*'
  if (current === '*') {
    parts[fieldIndex] = value
  } else if (current === value) {
    parts[fieldIndex] = '*'
  } else if (current.includes(',')) {
    const values = current.split(',')
    if (values.includes(value)) {
      parts[fieldIndex] = values.filter(v => v !== value).join(',')
    } else {
      parts[fieldIndex] = [...values, value].join(',')
    }
  } else {
    parts[fieldIndex] = `${current},${value}`
  }
  
  scheduleForm.value.cronExpression = parts.join(' ')
}

function applyPreset(preset: CronPreset): void {
  scheduleForm.value.cronExpression = preset.cronExpression
}

function validateCron(): void {
  const expr = scheduleForm.value.cronExpression
  const parts = expr.split(' ')
  if (parts.length !== 5) {
    message.error(t('cron.editor.invalidCronExpression'))
    return
  }
  try {
    // 使用 cron-parser 验证表达式
    CronExpressionParser.parse(expr)
    message.success(t('cron.editor.cronExpressionValid'))
  } catch (e) {
    message.error(t('cron.editor.cronExpressionInvalid'))
  }
}

function resetForm(): void {
  scheduleForm.value = {
    scheduleType: 'cron',
    cronExpression: '* * * * *',
    everyValue: 1,
    everyUnit: 'minutes',
    specificTime: null,
    specificDate: null,
  }
}

function getScheduleData(): any {
  if (scheduleForm.value.scheduleType === 'cron') {
    return {
      kind: 'cron',
      expression: scheduleForm.value.cronExpression,
    }
  } else if (scheduleForm.value.scheduleType === 'every') {
    return {
      kind: 'every',
      value: scheduleForm.value.everyValue,
      unit: scheduleForm.value.everyUnit,
    }
  } else {
    return {
      kind: 'at',
      time: scheduleForm.value.specificTime,
      date: scheduleForm.value.specificDate,
    }
  }
}

// 初始化
if (props.initialSchedule) {
  scheduleForm.value.cronExpression = props.initialSchedule
}
</script>

<style scoped>
.preset-templates {
  padding: 12px;
  background: var(--n-color-target);
  border-radius: 8px;
  margin-bottom: 16px;
}

.cron-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--n-color-embedded);
  border-radius: 8px;
}

.cron-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cron-field :deep(.n-text) {
  font-weight: 500;
}

.cron-preview-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cron-preview-item {
  padding: 4px 0;
  border-bottom: 1px dashed rgba(0, 0, 0, 0.08);
}

.cron-preview-item:last-child {
  border-bottom: none;
}
</style>
