import { vi } from 'vitest'
import { config } from '@vue/test-utils'
import { i18n } from '@/i18n'

vi.mock('naive-ui', async () => {
  const actual = await vi.importActual<typeof import('naive-ui')>('naive-ui')
  return {
    ...actual,
    useMessage: () => ({
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      loading: vi.fn(),
      destroyAll: vi.fn(),
    }),
    useDialog: () => ({
      warning: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
      info: vi.fn(),
      create: vi.fn(),
      destroyAll: vi.fn(),
    }),
    useNotification: () => ({
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      create: vi.fn(),
      destroyAll: vi.fn(),
    }),
  }
})

if (typeof window !== 'undefined') {
  window.localStorage.setItem('openclaw_locale', 'zh-CN')

  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  }
}

i18n.global.locale.value = 'zh-CN'
i18n.global.mergeLocaleMessage('zh-CN', {
  theme: {
    light: '亮色',
    dark: '暗色',
    auto: '自动',
  },
  batch: {
    selectedCount: '已选择 {count} 项',
    enable: '启用',
    disable: '禁用',
    delete: '删除',
    export: '导出',
    selectAll: '全选',
    confirmDelete: '确认删除 {count} 项？',
  },
  search: {
    placeholder: '搜索',
    search: '搜索',
    cancel: '取消',
    filters: '筛选器',
    results: '共 {total} 项，命中 {count} 项',
  },
  common: {
    error: '错误',
    reset: '重置',
    save: '保存',
  },
  cron: {
    editor: {
      title: 'Cron 编辑器',
      quickPresets: '快速预设',
      scheduleType: '调度类型',
      cronExpression: 'Cron 表达式',
      minutes: '分钟',
      hours: '小时',
      days: '天',
      daysOfMonth: '日期',
      months: '月份',
      weekdays: '星期',
      sunday: '周日',
      monday: '周一',
      tuesday: '周二',
      wednesday: '周三',
      thursday: '周四',
      friday: '周五',
      saturday: '周六',
      nextRuns: '下次运行',
      cron: 'Cron',
      every: '每隔',
      at: '指定时间',
      interval: '间隔',
      unit: '单位',
      specificTime: '时间',
      specificDate: '日期',
      lastRunPreview: '预览',
      invalidCron: 'invalidCron',
      noNextRun: 'noNextRun',
      everyMinute: 'everyMinute',
      everyHour: 'everyHour',
      everyDay: 'everyDay',
      everyWeek: 'everyWeek',
      everyMonth: 'everyMonth',
    },
  },
})

config.global.plugins = [...(config.global.plugins || []), i18n]
config.global.stubs = {
  ...(config.global.stubs || {}),
  NDatePicker: {
    template: '<input data-test="n-date-picker" />',
  },
  NTimePicker: {
    template: '<input data-test="n-time-picker" />',
  },
}
