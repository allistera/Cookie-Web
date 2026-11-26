import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DocumentEditor from '../DocumentEditor.vue'
import { useDocumentsStore } from '../../stores/documents'

beforeEach(() => {
  setActivePinia(createPinia())
  // Editor.js probes matchMedia during its async init — jsdom doesn't
  // implement it.
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DocumentEditor', () => {
  it('still hands the final blocks to its save handler when unmounted mid-debounce', async () => {
    const onSave = vi.fn()
    const onDirty = vi.fn()
    const wrapper = mount(DocumentEditor, {
      attachTo: document.body,
      props: {
        doc: { id: 'doc-1', title: 'Doc', blocks: [{ type: 'paragraph', data: { text: 'Old' } }] },
        onSave,
        onDirty,
      },
    })
    // The holder stops being aria-busy once Editor.js reports onReady.
    await vi.waitFor(() =>
      expect(wrapper.get('.document-blocks').attributes('aria-busy')).toBe('false'),
    )
    const paragraph = wrapper.get('.ce-paragraph').element

    // Editor.js reports the edit (the component announces it as dirty), and
    // the serialize debounce is now pending.
    paragraph.textContent = 'Last edit'
    paragraph.dispatchEvent(new InputEvent('input', { bubbles: true }))
    await vi.waitFor(() => expect(onDirty).toHaveBeenCalled(), { timeout: 2000 })

    // Unmounting flushes that pending edit, but Editor.js only returns the
    // blocks after this component is already gone.
    wrapper.unmount()
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled())
    await flushPromises()

    expect(onSave).toHaveBeenCalledWith({
      id: 'doc-1',
      blocks: [expect.objectContaining({ type: 'paragraph', data: { text: 'Last edit' } })],
    })
  })

  it('hands the blocks over and sends the pending save when the page is hidden', async () => {
    const store = useDocumentsStore()
    const flush = vi.spyOn(store, 'flushPendingSave').mockResolvedValue(true)
    const onSave = vi.fn()
    const wrapper = mount(DocumentEditor, {
      attachTo: document.body,
      props: {
        doc: { id: 'doc-1', title: 'Doc', blocks: [{ type: 'paragraph', data: { text: 'Old' } }] },
        onSave,
        onDirty: () => store.markContentDirty(),
      },
    })
    await vi.waitFor(() =>
      expect(wrapper.get('.document-blocks').attributes('aria-busy')).toBe('false'),
    )
    const paragraph = wrapper.get('.ce-paragraph').element
    paragraph.textContent = 'Last edit'
    paragraph.dispatchEvent(new InputEvent('input', { bubbles: true }))
    await vi.waitFor(() => expect(store.saveState).toBe('saving'), { timeout: 2000 })

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    try {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.waitFor(() => expect(flush).toHaveBeenCalled())
    } finally {
      delete document.visibilityState
    }

    expect(onSave).toHaveBeenCalledWith({
      id: 'doc-1',
      blocks: [expect.objectContaining({ type: 'paragraph', data: { text: 'Last edit' } })],
    })
    expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(flush.mock.invocationCallOrder[0])
    wrapper.unmount()
  })

  it('hands title and tag edits to its save handler', async () => {
    const onSave = vi.fn()
    const wrapper = mount(DocumentEditor, {
      attachTo: document.body,
      props: { doc: { id: 'doc-1', title: 'Doc', tags: ['home'], blocks: [] }, onSave },
    })
    await vi.waitFor(() =>
      expect(wrapper.get('.document-blocks').attributes('aria-busy')).toBe('false'),
    )

    const title = wrapper.get('.document-title')
    title.element.textContent = 'Renamed'
    await title.trigger('input')
    await wrapper.get('button.document-tag').trigger('click')

    expect(onSave).toHaveBeenCalledWith({ id: 'doc-1', title: 'Renamed' })
    expect(onSave).toHaveBeenCalledWith({ id: 'doc-1', tags: [] })
    wrapper.unmount()
  })
})
