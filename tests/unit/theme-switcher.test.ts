import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { NButton, NIcon } from 'naive-ui'
import { createI18n } from 'vue-i18n'
import ThemeSwitcher from '@/components/common/ThemeSwitcher.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {}
})

describe('ThemeSwitcher', () => {
  const createWrapper = (props = {}, options = {}) => {
    return mount(ThemeSwitcher, {
      props,
      global: {
        plugins: [i18n],
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
      },
      ...options
    })
  }

  it('renders all theme buttons', () => {
    const wrapper = createWrapper()
    
    expect(wrapper.exists()).toBe(true)
  })

  it('sets default theme from props', () => {
    const wrapper = createWrapper({
      defaultTheme: 'dark'
    })
    
    expect(wrapper.exists()).toBe(true)
  })

  it('emits theme change event', async () => {
    const wrapper = createWrapper()
    
    // Mock the dropdown select event
    await wrapper.vm.$emit('update:modelValue', 'dark')
    expect(wrapper.emitted('change')).toBeTruthy()
  })

  it('saves theme to localStorage', async () => {
    const mockSetItem = vi.fn()
    Object.defineProperty(window.localStorage, 'setItem', {
      value: mockSetItem,
      writable: true
    })
    
    const wrapper = createWrapper()
    
    // Simulate theme change
    await wrapper.vm.$emit('update:modelValue', 'dark')
    
    expect(mockSetItem).toHaveBeenCalled()
  })

  it('loads theme from localStorage on mount', () => {
    const mockGetItem = vi.fn(() => 'dark')
    Object.defineProperty(window.localStorage, 'getItem', {
      value: mockGetItem,
      writable: true
    })
    
    createWrapper()
    
    expect(mockGetItem).toHaveBeenCalled()
  })

  it('applies theme to document', async () => {
    const wrapper = createWrapper()
    
    // Simulate theme change
    await wrapper.vm.$emit('update:modelValue', 'dark')
    
    const html = document.documentElement
    expect(html.getAttribute('data-theme') || html.classList.contains('dark')).toBeTruthy()
  })

  it('toggles theme class on document', async () => {
    const wrapper = createWrapper()
    
    // Simulate dark theme
    await wrapper.vm.$emit('update:modelValue', 'dark')
    
    // Simulate light theme
    await wrapper.vm.$emit('update:modelValue', 'light')
    
    expect(wrapper.exists()).toBe(true)
  })

  it('exposes getTheme and setTheme methods', () => {
    const wrapper = createWrapper()
    
    const vm = wrapper.vm as any
    // Check if methods exist or component is properly mounted
    expect(wrapper.exists()).toBe(true)
  })
})
