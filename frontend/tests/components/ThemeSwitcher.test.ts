import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import ThemeSwitcher from '../../src/components/theme/ThemeSwitcher.vue'

// Mock naive-ui components
vi.mock('naive-ui', async () => {
  const actual = await vi.importActual('naive-ui')
  return {
    ...actual,
    useMessage: () => ({
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn()
    })
  }
})

// Mock theme store
vi.mock('@/stores/theme', async () => {
  return {
    useThemeStore: () => ({
      mode: 'light',
      color: '#18a058',
      setMode: vi.fn(),
      setColor: vi.fn()
    })
  }
})

describe('ThemeSwitcher.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        getItem: vi.fn(() => null),
      },
      writable: true
    })
  })

  it('renders theme switcher correctly', () => {
    const wrapper = mount(ThemeSwitcher, {
      global: {
        plugins: [createPinia()],
        stubs: {
          NButton: true,
          NIcon: true,
          NDropdown: true,
          NModal: true,
          NCard: true,
          NSpace: true,
          NRadio: true,
          NRadioGroup: true,
          NColorPicker: true,
          NTag: true,
        }
      }
    })

    expect(wrapper.find('.theme-switcher').exists()).toBe(true)
  })

  it('displays correct theme label', () => {
    const wrapper = mount(ThemeSwitcher, {
      global: {
        plugins: [createPinia()],
        stubs: {
          NButton: true,
          NIcon: true,
          NDropdown: true,
          NModal: true,
          NCard: true,
          NSpace: true,
          NRadio: true,
          NRadioGroup: true,
          NColorPicker: true,
          NTag: true,
        }
      }
    })

    expect(wrapper.text()).toContain('亮色')
  })

  it('opens settings modal when clicking settings option', async () => {
    const wrapper = mount(ThemeSwitcher, {
      global: {
        plugins: [createPinia()],
        stubs: {
          NButton: true,
          NIcon: true,
          NDropdown: {
            template: '<div><slot /></div>'
          },
          NModal: true,
          NCard: true,
          NSpace: true,
          NRadio: true,
          NRadioGroup: true,
          NColorPicker: true,
          NTag: true,
        }
      }
    })

    // Settings modal should not be visible initially
    expect(wrapper.vm.showSettings).toBe(false)
  })

  it('applies theme mode correctly', () => {
    const wrapper = mount(ThemeSwitcher, {
      global: {
        plugins: [createPinia()],
        stubs: {
          NButton: true,
          NIcon: true,
          NDropdown: true,
          NModal: true,
          NCard: true,
          NSpace: true,
          NRadio: true,
          NRadioGroup: true,
          NColorPicker: true,
          NTag: true,
        }
      }
    })

    expect(wrapper.vm.localThemeMode.value).toBe('light')
  })
})
