import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import OutOfOfficeSettings from '../OutOfOfficeSettings.vue'
import { useOutOfOfficeStore } from '../../stores/outOfOffice'
import { outOfOfficeDefaults } from '../../lib/outOfOffice'

describe('out-of-office settings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const store = useOutOfOfficeStore()
    store.setOwner('account-a')
    store.document = {
      ...outOfOfficeDefaults(),
      startDate: '2026-10-25',
      endDate: '2026-10-25',
      text: 'Reviewed reply',
    }
    store.loaded = true
  })
  afterEach(() => vi.restoreAllMocks())
  it('renders the body as literal text and keeps editing separate from saving', async () => {
    const store = useOutOfOfficeStore()
    const save = vi.spyOn(store, 'save').mockResolvedValue(false)
    const wrapper = mount(OutOfOfficeSettings)
    await flushPromises()
    await wrapper.get('textarea').setValue('<img src=x onerror=alert(1)>')
    expect(wrapper.get('.ooo-preview pre').text()).toBe('<img src=x onerror=alert(1)>')
    expect(wrapper.find('.ooo-preview img').exists()).toBe(false)
    expect(save).not.toHaveBeenCalled()
    await wrapper.get('form').trigger('submit')
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ text: '<img src=x onerror=alert(1)>', enabled: false }),
    )
    wrapper.unmount()
  })
  it('does not discard the draft or clear a conflict on a failed reload', async () => {
    const store = useOutOfOfficeStore()
    const wrapper = mount(OutOfOfficeSettings)
    await flushPromises()
    await wrapper.get('textarea').setValue('Keep this unsaved text')
    store.conflict = true
    vi.spyOn(store, 'load').mockResolvedValue(false)
    const reload = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Discard edits'))
    await reload.trigger('click')
    await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('Keep this unsaved text')
    expect(store.conflict).toBe(true)
    expect(wrapper.get('button[type="submit"]').element.disabled).toBe(true)
    wrapper.unmount()
  })
  it('keeps the reviewed revision with an edited draft across background refresh', async () => {
    const store = useOutOfOfficeStore()
    const save = vi.spyOn(store, 'save').mockResolvedValue(false)
    const wrapper = mount(OutOfOfficeSettings)
    await flushPromises()
    await wrapper.get('textarea').setValue('My reviewed draft')
    store.document = { ...store.document, revision: 1, text: 'Changed in another browser' }
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 0, text: 'My reviewed draft' }),
    )
    expect(wrapper.get('textarea').element.value).toBe('My reviewed draft')
    wrapper.unmount()
  })
})
