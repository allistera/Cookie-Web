import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

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

// The footer is either the send row with the AI icon at its right edge, or
// the Cookie AI prompt at full width; never both squeezed together.
describe('ComposerWindow AI prompt', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function mountActive() {
    const store = useInboxStore()
    store.isComposerActive = true
    return { store, wrapper: mount(ComposerWindow, { attachTo: document.body }) }
  }

  it('shows the send row with an AI icon on the right, and no prompt', () => {
    const { wrapper } = mountActive()

    expect(wrapper.find('.composer-attach-btn').exists()).toBe(true)
    expect(wrapper.find('.composer-follow-up-btn').exists()).toBe(true)
    expect(wrapper.get('.composer-ai-toggle').text()).toBe('auto_fix_high')
    expect(wrapper.find('.composer-ai-inline').exists()).toBe(false)
    wrapper.unmount()
  })

  it('swaps the row for the focused prompt when the icon is pressed, and back on close', async () => {
    const { wrapper } = mountActive()

    await wrapper.get('.composer-ai-toggle').trigger('click')
    await nextTick()

    const input = wrapper.get('[aria-label="Describe your message"]')
    expect(document.activeElement).toBe(input.element)
    expect(wrapper.find('.composer-attach-btn').exists()).toBe(false)
    expect(wrapper.find('.composer-send-btn-split').exists()).toBe(false)
    expect(wrapper.find('.composer-ai-toggle').exists()).toBe(false)

    await wrapper.get('.composer-ai-close').trigger('click')
    expect(wrapper.find('.composer-ai-inline').exists()).toBe(false)
    expect(wrapper.find('.composer-attach-btn').exists()).toBe(true)
    wrapper.unmount()
  })

  it('closes the prompt on Escape', async () => {
    const { wrapper } = mountActive()
    await wrapper.get('.composer-ai-toggle').trigger('click')

    await wrapper.get('[aria-label="Describe your message"]').trigger('keydown', { key: 'Escape' })

    expect(wrapper.find('.composer-ai-inline').exists()).toBe(false)
    wrapper.unmount()
  })

  it('opens the prompt when the AI panel opens, and drops it when the composer closes', async () => {
    const { store, wrapper } = mountActive()

    store.isAiDraftActive = true
    await nextTick()
    expect(wrapper.find('.composer-ai-inline').exists()).toBe(true)

    store.isComposerActive = false
    await nextTick()
    expect(wrapper.find('.composer-ai-inline').exists()).toBe(false)
    wrapper.unmount()
  })
})
