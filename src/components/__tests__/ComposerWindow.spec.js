import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import ComposerWindow from '../ComposerWindow.vue'
import { useInboxStore } from '../../stores/inbox'

describe('ComposerWindow emoji conversion', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('converts mapped emoji as the subject is typed and preserves unknown emoji', async () => {
    const store = useInboxStore()
    store.isComposerActive = true
    const wrapper = mount(ComposerWindow, { attachTo: document.body })
    const subject = wrapper.get('.composer-subject-inline')

    await subject.setValue('Hello 😊 🎉 🛸')

    expect(store.composerSubject).toBe('Hello :) \\o/ 🛸')
    expect(subject.element.value).toBe('Hello :) \\o/ 🛸')
    wrapper.unmount()
  })
})

describe('ComposerWindow forwarded attachments', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('shows carried attachments and lets the user remove one before sending', async () => {
    const store = useInboxStore()
    store.isComposerActive = true
    store.composerAttachments = [
      { id: 'att-1', filename: 'plan.pdf', content_type: 'application/pdf', size_bytes: 2048 },
      { id: 'att-2', filename: 'notes.txt', content_type: 'text/plain', size_bytes: 12 },
    ]
    const wrapper = mount(ComposerWindow)

    expect(wrapper.findAll('.composer-attachment-chip')).toHaveLength(2)
    expect(wrapper.text()).toContain('plan.pdf')

    await wrapper.get('[aria-label="Remove plan.pdf"]').trigger('click')

    expect(store.composerAttachments).toEqual([
      expect.objectContaining({ id: 'att-2', filename: 'notes.txt' }),
    ])
    expect(wrapper.text()).not.toContain('plan.pdf')
  })
})
