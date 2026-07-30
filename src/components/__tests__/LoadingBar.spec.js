import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import LoadingBar from '../LoadingBar.vue'
import { useInboxStore } from '../../stores/inbox'

describe('LoadingBar', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
  })

  it('is hidden while nothing is loading', () => {
    const wrapper = mount(LoadingBar)
    expect(wrapper.find('.loading-bar').exists()).toBe(false)
  })

  it('shows while the inbox is loading and hides when it settles', async () => {
    const wrapper = mount(LoadingBar)

    store.isRefreshing = true
    await wrapper.vm.$nextTick()
    const bar = wrapper.find('.loading-bar')
    expect(bar.exists()).toBe(true)
    expect(bar.attributes('role')).toBe('progressbar')

    store.isRefreshing = false
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.loading-bar').exists()).toBe(false)
  })

  it.each([
    ['sent', 'isSentRefreshing'],
    ['spam', 'isSpamRefreshing'],
    ['snoozed', 'isSnoozedRefreshing'],
    ['done', 'isDoneRefreshing'],
  ])('also shows while the %s list is loading', async (_folder, flag) => {
    const wrapper = mount(LoadingBar)

    store[flag] = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.loading-bar').exists()).toBe(true)

    store[flag] = false
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.loading-bar').exists()).toBe(false)
  })
})
