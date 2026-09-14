import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ContactAddress from '../ContactAddress.vue'
import { useContactInsightsStore } from '../../stores/contactInsights'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('ContactAddress', () => {
  it('reveals View Insights on hover and opens the selected contact', async () => {
    const store = useContactInsightsStore()
    const openContact = vi.spyOn(store, 'openContact').mockResolvedValue()
    const wrapper = mount(ContactAddress, {
      props: { address: 'alex@example.com', name: 'Alex Morgan' },
    })

    await wrapper.trigger('mouseenter')
    expect(wrapper.get('[role="dialog"]').text()).toContain('Alex Morgan')
    expect(wrapper.get('[role="dialog"]').text()).toContain('alex@example.com')

    await wrapper.get('button').trigger('click')
    expect(openContact).toHaveBeenCalledWith({
      address: 'alex@example.com',
      name: 'Alex Morgan',
    })
  })
})
