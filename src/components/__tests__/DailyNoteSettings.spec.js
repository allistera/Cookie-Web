import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

  afterEach(() => vi.restoreAllMocks())

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
  // An editor unmounting after a reset still flushes its last blocks, tagged
  // with the id of the draft it was showing; they must not land on the new one.
  it('ignores a block save from an editor whose draft was replaced', async () => {
    vi.spyOn(store, 'loadDailyNoteSeed').mockImplementation(async () => {
      store.dailyNoteSeed = [{ type: 'paragraph', data: { text: 'Mine' } }]
      store.dailyNoteSeedLoaded = true
      return true
    })
    const wrapper = mountSettings()
    await flushPromises()
    const editor = wrapper.findComponent(DocumentEditor)
    const blocks = [
      { type: 'paragraph', data: { text: 'a' } },
      { type: 'paragraph', data: { text: 'b' } },
    ]

    editor.vm.$emit('save', { id: 'daily-note-seed-0', blocks })
    await flushPromises()
    expect(wrapper.find('.editor-stub').text()).toBe('1')

    editor.vm.$emit('save', { id: editor.props('doc').id, blocks })
    await flushPromises()
    expect(wrapper.find('.editor-stub').text()).toBe('2')
  })
})

describe('saving daily-note defaults', () => {
  let store
  let wrapper
  beforeEach(() => {
    setActivePinia(createPinia())
    store = useDocumentsStore()
    vi.spyOn(store, 'notify').mockImplementation(() => {})
    vi.spyOn(store, 'loadDailyNoteSeed').mockImplementation(async () => {
      store.dailyNoteSeed = [{ type: 'paragraph', data: { text: 'Saved template' } }]
      store.dailyNoteSeedLoaded = true
      return true
    })
  })
  afterEach(() => {
    wrapper?.unmount()
    vi.restoreAllMocks()
  })

  it('saves the latest editor snapshot instead of an older emitted draft', async () => {
    const blocks = [{ type: 'paragraph', data: { text: 'Latest edit' } }]
    const snapshot = vi.spyOn(DocumentEditor.methods, 'snapshot').mockResolvedValue({ blocks })
    const save = vi.spyOn(store, 'saveDailyNoteSeed').mockResolvedValue(true)
    wrapper = mountSettings()
    await flushPromises()
    await wrapper.get('.btn-primary').trigger('click')
    await flushPromises()
    expect(snapshot).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledExactlyOnceWith(blocks)
    expect(store.notify).toHaveBeenCalledWith('Daily note default saved.')
    expect(store.dailyNoteSeed[0].data.text).toBe('Saved template')
  })

  it('prevents duplicate saves and restores the button after a failed save', async () => {
    let resolveSave
    const save = vi.spyOn(store, 'saveDailyNoteSeed').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )
    wrapper = mountSettings()
    await flushPromises()
    await wrapper.get('.btn-primary').trigger('click')
    await flushPromises()
    expect(wrapper.get('.btn-primary').text()).toBe('Saving…')
    expect(wrapper.get('.btn-primary').element.disabled).toBe(true)
    await wrapper.get('.btn-primary').trigger('click')
    expect(save).toHaveBeenCalledOnce()
    resolveSave(false)
    await flushPromises()
    expect(wrapper.get('.btn-primary').text()).toBe('Save')
    expect(wrapper.get('.btn-primary').element.disabled).toBe(false)
    expect(store.notify).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'resets the editor only after a successful reset (%s)',
    async (success) => {
      const save = vi.spyOn(store, 'saveDailyNoteSeed').mockImplementation(async () => {
        if (success) store.dailyNoteSeed = []
        return success
      })
      wrapper = mountSettings()
      await flushPromises()
      const oldId = wrapper.findComponent(DocumentEditor).props('doc').id
      await wrapper.get('.btn-secondary').trigger('click')
      await flushPromises()
      expect(save).toHaveBeenCalledExactlyOnceWith([])
      expect(wrapper.findComponent(DocumentEditor).props('doc').id === oldId).toBe(!success)
      expect(store.notify.mock.calls).toEqual(success ? [['Daily note default reset.']] : [])
      expect(wrapper.get('.btn-primary').element.disabled).toBe(false)
    },
  )

  it('keeps current blocks when the editor emits a title-only patch', async () => {
    wrapper = mountSettings()
    await flushPromises()
    const editor = wrapper.findComponent(DocumentEditor)
    editor.vm.$emit('save', { title: 'Ignored title' })
    await flushPromises()
    expect(editor.props('doc').blocks).toEqual([
      { type: 'paragraph', data: { text: 'Saved template' } },
    ])
  })
})
