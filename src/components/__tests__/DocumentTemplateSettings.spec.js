import { shallowMount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DocumentTemplateSettings from '../DocumentTemplateSettings.vue'
import { useDocumentsStore } from '../../stores/documents'

let wrapper
let store
let snapshot
const Editor = defineComponent({
  props: ['doc'],
  emits: ['save'],
  setup(_, { expose }) {
    expose({ snapshot: () => snapshot() })
  },
  template: '<div class="editor-fixture" />',
})
beforeEach(() => {
  setActivePinia(createPinia())
  store = useDocumentsStore()
  vi.spyOn(store, 'loadTemplates').mockResolvedValue(true)
  vi.spyOn(store, 'notify').mockImplementation(() => {})
  snapshot = vi.fn().mockResolvedValue({
    title: 'Weekly notes',
    blocks: [{ type: 'paragraph', data: { text: 'Agenda' } }],
  })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
function render() {
  wrapper = shallowMount(DocumentTemplateSettings, {
    global: { stubs: { DocumentEditor: Editor } },
  })
}
async function create() {
  render()
  await wrapper.get('.document-template-heading button').trigger('click')
}
async function save() {
  await wrapper.get('.btn-primary').trigger('click')
  await flushPromises()
}

describe('document template settings', () => {
  it('loads templates on mount and displays empty/loading states', async () => {
    render()
    expect(store.loadTemplates).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('No templates yet.')
    store.templatesLoading = true
    await nextTick()
    expect(wrapper.text()).toContain('Loading templates')
  })

  it('saves the current editor snapshot as a new template', async () => {
    const createTemplate = vi.spyOn(store, 'createTemplate').mockResolvedValue({ id: 'saved' })
    await create()
    expect(wrapper.text()).toContain('New template')
    await save()
    expect(snapshot).toHaveBeenCalledOnce()
    expect(createTemplate).toHaveBeenCalledWith({
      title: 'Weekly notes',
      blocks: [{ type: 'paragraph', data: { text: 'Agenda' } }],
    })
    expect(wrapper.find('.editor-fixture').exists()).toBe(false)
    expect(store.notify).toHaveBeenCalledWith('Document template saved.')
  })

  it('requires a nonblank name and lets the user correct it', async () => {
    const createTemplate = vi.spyOn(store, 'createTemplate').mockResolvedValue({ id: 'saved' })
    snapshot
      .mockResolvedValueOnce({ title: '  ' })
      .mockResolvedValueOnce({ title: '  Notes  ', blocks: null })
    await create()
    await save()
    expect(wrapper.get('[role=alert]').text()).toContain('Give this template a name')
    expect(createTemplate).not.toHaveBeenCalled()
    await save()
    expect(createTemplate).toHaveBeenCalledWith({ title: 'Notes', blocks: [] })
  })

  it('keeps the editor open when persistence fails', async () => {
    vi.spyOn(store, 'createTemplate').mockResolvedValue(null)
    await create()
    await save()
    expect(wrapper.find('.editor-fixture').exists()).toBe(true)
    expect(wrapper.get('.btn-primary').attributes('disabled')).toBeUndefined()
    expect(store.notify).not.toHaveBeenCalled()
  })

  it('disables saving while the editor snapshot is being flushed', async () => {
    let finish
    snapshot.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    vi.spyOn(store, 'createTemplate').mockResolvedValue({ id: 'saved' })
    await create()
    await wrapper.get('.btn-primary').trigger('click')
    expect(wrapper.get('.btn-primary').text()).toBe('Saving…')
    expect(wrapper.get('.btn-primary').attributes('disabled')).toBeDefined()
    finish({ title: 'Ready', blocks: [] })
    await flushPromises()
    expect(wrapper.find('.editor-fixture').exists()).toBe(false)
  })

  it('loads and updates an existing template without mutating its source', async () => {
    const full = { id: 'existing', title: 'Original', blocks: [] }
    store.templates = [{ id: 'existing', title: 'Original', updated_at: '2026-10-21T12:00:00Z' }]
    vi.spyOn(store, 'loadTemplate').mockResolvedValue(full)
    const update = vi.spyOn(store, 'updateTemplate').mockResolvedValue({ id: 'existing' })
    render()
    expect(wrapper.text()).toContain('21 Oct 2026')
    await wrapper.get('[aria-label="Edit Original"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Edit template')
    wrapper.findComponent(Editor).vm.$emit('save', { id: 'existing', title: 'Changed' })
    await nextTick()
    expect(full.title).toBe('Original')
    await save()
    expect(update).toHaveBeenCalledWith(
      'existing',
      expect.objectContaining({ title: 'Weekly notes' }),
    )
  })

  it('stays in the list when a template cannot be loaded', async () => {
    store.templates = [{ id: 'missing', title: 'Missing' }]
    vi.spyOn(store, 'loadTemplate').mockResolvedValue(null)
    render()
    await wrapper.get('[aria-label="Edit Missing"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.editor-fixture').exists()).toBe(false)
  })

  it('ignores stale editor updates after opening a different draft', async () => {
    await create()
    const oldId = wrapper.findComponent(Editor).props('doc').id
    await wrapper.get('.document-template-editor-actions .btn-secondary').trigger('click')
    await wrapper.get('.document-template-heading button').trigger('click')
    const editor = wrapper.findComponent(Editor)
    expect(editor.props('doc').id).not.toBe(oldId)
    editor.vm.$emit('save', { id: oldId, title: 'Stale title' })
    await nextTick()
    expect(editor.props('doc').title).toBe('')
  })

  it.each([true, false])(
    'requires confirmation before deletion and handles result %s',
    async (success) => {
      store.templates = [{ id: 'existing', title: 'Notes' }]
      const remove = vi.spyOn(store, 'deleteTemplate').mockResolvedValue(success)
      render()
      await wrapper.get('[aria-label="Delete Notes"]').trigger('click')
      expect(remove).not.toHaveBeenCalled()
      await wrapper.get('[aria-label="Confirm delete Notes"]').trigger('click')
      await flushPromises()
      expect(remove).toHaveBeenCalledWith('existing')
      expect(store.notify.mock.calls).toEqual(success ? [['Document template deleted.']] : [])
      expect(wrapper.find('[aria-label="Confirm delete Notes"]').exists()).toBe(!success)
    },
  )
})
