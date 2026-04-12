import { describe, expect, it } from 'vitest'
import type { RouteRecordRaw } from 'vue-router'
import { routes } from '@/router/routes'
import zhCN from '@/i18n/messages/zh-CN'
import enUS from '@/i18n/messages/en-US'

function collectTitleKeys(routeList: RouteRecordRaw[], keys = new Set<string>()) {
  for (const route of routeList) {
    const titleKey = route.meta?.titleKey
    if (typeof titleKey === 'string' && titleKey.length > 0) {
      keys.add(titleKey)
    }
    if (route.children?.length) {
      collectTitleKeys(route.children, keys)
    }
  }
  return [...keys]
}

function hasMessageKey(messages: Record<string, unknown>, key: string): boolean {
  return key.split('.').every((segment) => {
    if (!messages || typeof messages !== 'object' || !(segment in messages)) {
      return false
    }
    messages = messages[segment] as Record<string, unknown>
    return true
  })
}

describe('route title i18n coverage', () => {
  const titleKeys = collectTitleKeys(routes)

  it('defines every route title key in zh-CN messages', () => {
    const missing = titleKeys.filter((key) => !hasMessageKey(zhCN as Record<string, unknown>, key))
    expect(missing).toEqual([])
  })

  it('defines every route title key in en-US messages', () => {
    const missing = titleKeys.filter((key) => !hasMessageKey(enUS as Record<string, unknown>, key))
    expect(missing).toEqual([])
  })
})
