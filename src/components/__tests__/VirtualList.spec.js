import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
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
})
