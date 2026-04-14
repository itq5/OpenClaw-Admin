import { describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'

describe('app i18n runtime messages', () => {
  it('interpolates named placeholders for zh-CN messages', () => {
    i18n.global.locale.value = 'zh-CN'

    expect(
      i18n.global.t('components.connectionStatus.newVersionAvailable', {
        version: '2026.4.6',
      }),
    ).toBe('发现新版本 2026.4.6')

    expect(
      i18n.global.t('pages.dashboard.usage.coverage.text', {
        withUsage: 3,
        total: 11,
      }),
    ).toBe('有 usage 数据 3/11 个会话')

    expect(
      i18n.global.t('pages.settings.currentStatus', {
        status: '已连接',
      }),
    ).toBe('当前状态：已连接')
  })
})
