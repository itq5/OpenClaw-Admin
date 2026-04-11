import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { NText, NButton, NIcon, NSpin, NAlert } from 'naive-ui'
import { createI18n } from 'vue-i18n'
import DashboardCard from '@/components/charts/DashboardCard.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: {}
})

describe('DashboardCard', () => {
  const createWrapper = (props = {}, options = {}) => {
    return mount(DashboardCard, {
      props,
      global: {
        plugins: [i18n],
        stubs: {
          NText: true,
          NButton: true,
          NIcon: true,
          NSpin: true,
          NAlert: true
        }
      },
      ...options
    })
  }

  it('renders with title', () => {
    const wrapper = createWrapper({
      title: 'Test Card'
    })
    
    expect(wrapper.findComponent(NText).exists()).toBe(true)
  })

  it('shows refresh button when showRefresh is true', () => {
    const wrapper = createWrapper({
      title: 'Test Card',
      showRefresh: true
    })
    
    expect(wrapper.findComponent(NButton).exists()).toBe(true)
  })

  it('emits refresh event when refresh button clicked', async () => {
    const wrapper = createWrapper({
      title: 'Test Card',
      showRefresh: true
    })
    
    const button = wrapper.findComponent(NButton)
    await button.trigger('click')
    expect(wrapper.emitted('refresh')).toBeTruthy()
  })

  it('shows loading spinner when loading is true', () => {
    const wrapper = createWrapper({
      title: 'Test Card',
      loading: true
    })
    
    expect(wrapper.findComponent(NSpin).exists()).toBe(true)
  })

  it('shows error alert when error is provided', () => {
    const wrapper = createWrapper({
      title: 'Test Card',
      error: 'Something went wrong'
    })
    
    expect(wrapper.findComponent(NAlert).exists()).toBe(true)
  })

  it('renders default slot content', () => {
    const wrapper = createWrapper(
      { title: 'Test Card' },
      {
        slots: {
          default: '<div class="custom-content">Custom</div>'
        }
      }
    )
    
    expect(wrapper.find('.custom-content').exists()).toBe(true)
    expect(wrapper.find('.custom-content').text()).toBe('Custom')
  })
})
