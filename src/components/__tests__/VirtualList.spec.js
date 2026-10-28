import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VirtualList from '../VirtualList.vue'

const rows = Array.from({ length: 10000 }, (_, i) => ({ key: `row-${i}`, title: `Row ${i}` }))
const options = { props: { items: rows }, slots: { default: '<button>{{ item.title }}</button>' } }

describe('VirtualList', () => {
  it('bounds the DOM, reaches distant rows, and preserves its anchor on prepend', async () => {
    const wrapper = mount(VirtualList, options)
    expect(wrapper.findAll('[data-virtual-key]').length).toBeLessThan(50)
    wrapper.vm.scrollToKey('row-5000')
    await nextTick()
    expect(wrapper.find('[data-virtual-key="row-5000"]').exists()).toBe(true)
    const before = wrapper.element.scrollTop
    await wrapper.setProps({ items: [{ key: 'new', title: 'New' }, ...rows] })
    await nextTick()
    expect(wrapper.element.scrollTop).toBe(before + 40)
    expect(wrapper.findAll('[data-virtual-key]').length).toBeLessThan(60)
    wrapper.unmount()
  })

  it('keeps a focused row mounted when scrolling away and releases it on blur', async () => {
    const wrapper = mount(VirtualList, options)
    const first = wrapper.find('[data-virtual-key="row-0"] button')
    await first.trigger('focusin')
    wrapper.vm.scrollToKey('row-5000')
    await nextTick()
    expect(wrapper.find('[data-virtual-key="row-0"]').exists()).toBe(true)
    await first.trigger('focusout')
    expect(wrapper.find('[data-virtual-key="row-0"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('focusKey mounts a distant row and focuses its content', async () => {
    const wrapper = mount(VirtualList, { ...options, attachTo: document.body })
    await wrapper.vm.focusKey('row-5000')
    expect(document.activeElement).toBe(
      wrapper.find('[data-virtual-key="row-5000"] button').element,
    )
    // An unknown key leaves focus where it is.
    await wrapper.vm.focusKey('missing')
    expect(document.activeElement.textContent).toBe('Row 5000')
    wrapper.unmount()
  })
})

describe('VirtualList measurements', () => {
  let wrapper
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function observe() {
    let notify
    let frame
    const observer = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback) {
          notify = callback
          return observer
        }
      },
    )
    const request = vi.fn((callback) => {
      frame = callback
      return 7
    })
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', cancel)
    return {
      observer,
      request,
      cancel,
      notify: (entries) => notify(entries),
      flush: async () => {
        frame()
        await nextTick()
        await nextTick()
      },
    }
  }

  it('batches row measurements and preserves the visible anchor', async () => {
    const measurements = observe()
    wrapper = mount(VirtualList, options)
    wrapper.element.scrollTop = 80
    await wrapper.trigger('scroll')
    const first = wrapper.get('[data-virtual-key="row-0"]').element
    measurements.notify([{ target: first, borderBoxSize: [{ blockSize: 60 }] }])
    measurements.notify([{ target: first, borderBoxSize: [{ blockSize: 100 }] }])
    expect(measurements.request).toHaveBeenCalledTimes(1)
    await measurements.flush()
    expect(wrapper.element.scrollTop).toBe(140)
    expect(wrapper.get('.virtual-content').attributes('style')).toContain('400060px')
    expect(wrapper.get('[data-virtual-key="row-2"]').attributes('style')).toContain(
      'translateY(140px)',
    )
    measurements.notify([{ target: first, borderBoxSize: [{ blockSize: 100 }] }])
    await measurements.flush()
    expect(wrapper.element.scrollTop).toBe(140)
  })

  it('uses measured viewport and row bounds and drops deleted row measurements', async () => {
    const measurements = observe()
    wrapper = mount(VirtualList, { props: { items: rows.slice(0, 30) } })
    const first = wrapper.get('[data-virtual-key="row-0"]').element
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({ height: 70 })
    measurements.notify([
      { target: wrapper.element, contentRect: { height: 200 } },
      { target: first },
    ])
    await measurements.flush()
    wrapper.vm.scrollToKey('row-10')
    await nextTick()
    expect(wrapper.element.scrollTop).toBe(270)
    wrapper.vm.scrollToKey('row-0')
    await nextTick()
    expect(wrapper.element.scrollTop).toBe(0)
    await wrapper.setProps({ items: rows.slice(1, 30) })
    await nextTick()
    expect(measurements.observer.unobserve).toHaveBeenCalledWith(first)
    await wrapper.setProps({ items: rows.slice(0, 30) })
    await nextTick()
    expect(wrapper.get('.virtual-content').attributes('style')).toContain('1200px')
  })

  it('cancels queued measurements and disconnects on unmount', () => {
    const measurements = observe()
    wrapper = mount(VirtualList, options)
    measurements.notify([{ target: wrapper.element, contentRect: { height: 0 } }])
    wrapper.unmount()
    wrapper = null
    expect(measurements.cancel).toHaveBeenCalledExactlyOnceWith(7)
    expect(measurements.observer.disconnect).toHaveBeenCalledTimes(1)
  })

  it('handles an empty list and an unknown scroll target', async () => {
    vi.stubGlobal('ResizeObserver', undefined)
    wrapper = mount(VirtualList, { props: { items: [] } })
    wrapper.vm.scrollToKey('missing')
    await wrapper.trigger('scroll')
    expect(wrapper.get('.virtual-content').attributes('style')).toContain('0px')
    expect(wrapper.findAll('[data-virtual-key]')).toHaveLength(0)
  })
})
