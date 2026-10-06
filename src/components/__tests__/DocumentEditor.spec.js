import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DocumentEditor from '../DocumentEditor.vue'

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
})
