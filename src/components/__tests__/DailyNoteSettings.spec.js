import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DailyNoteSettings from '../DailyNoteSettings.vue'
import { useDocumentsStore } from '../../stores/documents'

const DocumentEditor = {
  name: 'DocumentEditor',
  props: ['doc', 'compact'],
  template: '<div class="editor-stub">{{ doc.blocks.length }}</div>',
  methods: { snapshot: async () => ({}) },
}

function mountSettings() {
  return mount(DailyNoteSettings, { global: { stubs: { DocumentEditor } } })
}

describe('DailyNoteSettings', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useDocumentsStore()
    vi.spyOn(store, 'notify').mockImplementation(() => {})
  })

  const saveButton = (wrapper) =>
    wrapper.findAll('button').find((button) => button.text() === 'Save')

  it('shows the saved template and allows saving once it has loaded', async () => {
    vi.spyOn(store, 'loadDailyNoteSeed').mockImplementation(async () => {
      store.dailyNoteSeed = [{ type: 'paragraph', data: { text: 'Mine' } }]
      store.dailyNoteSeedLoaded = true
      return true
    })
    const wrapper = mountSettings()
    await flushPromises()

    expect(wrapper.find('.editor-stub').text()).toBe('1')
    expect(saveButton(wrapper).attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid="retry-daily-note"]').exists()).toBe(false)
  })

  // The built-in default must not stand in for a template that failed to
  // load: one Save would overwrite the person's own.
  it('keeps the default out and Save disabled when the load fails, then retries', async () => {
    const load = vi.spyOn(store, 'loadDailyNoteSeed').mockResolvedValueOnce(false)
    const save = vi.spyOn(store, 'saveDailyNoteSeed').mockResolvedValue(true)
    const wrapper = mountSettings()
    await flushPromises()

    expect(wrapper.find('.editor-stub').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not load')
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
    await saveButton(wrapper).trigger('click')
    expect(save).not.toHaveBeenCalled()

    load.mockImplementationOnce(async () => {
      store.dailyNoteSeedLoaded = true
      return true
    })
    await wrapper.get('[data-testid="retry-daily-note"]').trigger('click')
    await flushPromises()

    expect(load).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.find('.editor-stub').exists()).toBe(true)
    expect(saveButton(wrapper).attributes('disabled')).toBeUndefined()
  })
})
