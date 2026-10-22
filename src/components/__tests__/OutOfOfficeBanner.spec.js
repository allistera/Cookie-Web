import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OutOfOfficeBanner from '../OutOfOfficeBanner.vue'
import { useOutOfOfficeStore } from '../../stores/outOfOffice'

let wrapper
beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-21T23:59:40Z'))
})
afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
const mountBanner = () =>
  mount(OutOfOfficeBanner, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })

describe('out-of-office banner', () => {
  it('hides when disabled with no delivery review', () => {
    wrapper = mountBanner()
    expect(wrapper.find('aside').exists()).toBe(false)
  })

  it('shows active dates, stops replies, and disables the stop button while saving', async () => {
    const store = useOutOfOfficeStore()
    Object.assign(store.document, {
      enabled: true,
      startDate: '2026-10-21',
      endDate: '2026-10-21',
      timeZone: 'UTC',
    })
    const stop = vi.spyOn(store, 'stop').mockResolvedValue(true)
    wrapper = mountBanner()
    expect(wrapper.get('[role=status]').text()).toContain('active through 2026-10-21 (UTC)')
    expect(wrapper.get('a').text()).toBe('Settings')
    await wrapper.get('button').trigger('click')
    expect(stop).toHaveBeenCalledOnce()
    store.saving = true
    store.error = 'Could not stop replies'
    await nextTick()
    expect(wrapper.get('button').element.disabled).toBe(true)
    expect(wrapper.get('[role=alert]').text()).toBe('Could not stop replies')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(wrapper.find('aside').exists()).toBe(false)
  })

  it('keeps delivery review visible after the schedule ends', () => {
    const store = useOutOfOfficeStore()
    store.document.review = [{ id: 'reply-1' }]
    wrapper = mountBanner()
    expect(wrapper.get('[role=status]').text()).toBe('An automatic reply needs delivery review.')
    expect(wrapper.get('a').text()).toBe('Review replies and settings')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('cleans up the refresh timer on unmount', () => {
    wrapper = mountBanner()
    expect(vi.getTimerCount()).toBe(1)
    wrapper.unmount()
    wrapper = null
    expect(vi.getTimerCount()).toBe(0)
  })
})
