import { createI18n } from 'vue-i18n'
import messages from '@intlify/unplugin-vue-i18n/messages'
import { getPreferredLocale, type AppLocale } from './locale'

const DEFAULT_LOCALE: AppLocale = 'en-US'

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: getPreferredLocale(),
  fallbackLocale: DEFAULT_LOCALE,
  messages,
})

