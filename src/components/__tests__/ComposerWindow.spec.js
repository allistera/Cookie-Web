import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

import ComposerWindow from '../ComposerWindow.vue'
import ComposerEditor from '../ComposerEditor.vue'
import ShareAvailability from '../ShareAvailability.vue'
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

describe('ComposerWindow snippet preview', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('disables background send actions until the editor closes its preview', async () => {
    const store = useInboxStore()
    store.isComposerActive = true
    store.composerTo = 'alice@example.com'
    store.composerTextArea = 'Before /intro'
    const wrapper = mount(ComposerWindow, { attachTo: document.body })
    const editor = wrapper.findComponent(ComposerEditor)

    editor.vm.$emit('previewState', true)
    await nextTick()
    expect(store.composerSnippetPreviewOpen).toBe(true)
    expect(wrapper.get('.composer-send-btn-split').attributes()).toHaveProperty('disabled')
    expect(wrapper.get('.composer-schedule-caret').attributes()).toHaveProperty('disabled')

    editor.vm.$emit('previewState', false)
    await nextTick()
    expect(store.composerSnippetPreviewOpen).toBe(false)
    expect(wrapper.get('.composer-send-btn-split').attributes()).not.toHaveProperty('disabled')
    wrapper.unmount()
  })

  it('guards background send and scheduling while availability is under review', async () => {
    const store = useInboxStore()
    store.isComposerActive = true
    store.composerTo = 'alice@example.com'
    store.composerTextArea = 'Existing draft'
    const wrapper = mount(ComposerWindow)
    wrapper.findComponent(ShareAvailability).vm.$emit('previewState', true)
    await nextTick()
    expect(store.composerAvailabilityPreviewOpen).toBe(true)
    expect(wrapper.get('.composer-send-btn-split').attributes()).toHaveProperty('disabled')
    expect(await store.sendEmailLater(new Date(Date.now() + 3600000).toISOString(), 'Later')).toBe(
      false,
    )
    wrapper.findComponent(ShareAvailability).vm.$emit('previewState', false)
    await nextTick()
    expect(wrapper.get('.composer-send-btn-split').attributes()).not.toHaveProperty('disabled')
    wrapper.unmount()
  })
})

describe('ComposerWindow save status', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it.each(['saved', 'saving', 'local'])('shows nothing while the draft is %s', (state) => {
    const store = useInboxStore()
    store.isComposerActive = true
    store.composerSaveState = state
    const wrapper = mount(ComposerWindow, { attachTo: document.body })

    expect(wrapper.find('.composer-save-status').exists()).toBe(false)
    wrapper.unmount()
  })

  it('warns and offers a retry when the draft is saved nowhere', async () => {
    const store = useInboxStore()
    store.isComposerActive = true
    store.composerSaveState = 'error'
    const flush = vi.spyOn(store, 'flushComposerDraft').mockResolvedValue()
    const wrapper = mount(ComposerWindow, { attachTo: document.body })

    const warning = wrapper.get('.composer-save-status')
    expect(warning.attributes('role')).toBe('alert')
    expect(warning.text()).toContain('Not saved. Keep this tab open and retry.')
    await warning.get('button').trigger('click')

    expect(flush).toHaveBeenCalledOnce()
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

it('shows the original time and retries scheduling instead of offering a new send time', async () => {
  setActivePinia(createPinia())
  const store = useInboxStore()
  store.isComposerActive = true
  store.composerTo = 'reader@example.com'
  store.composerTextArea = 'Scheduled message'
  const sendAt = '2099-01-01T09:00:00Z'
  store.composerSendIdentity = {
    requestId: 'original-request',
    fingerprint: 'original-message',
    outgoing: { sendAt },
  }
  const retry = vi.spyOn(store, 'sendEmailLater').mockResolvedValue(true)
  const wrapper = mount(ComposerWindow)
  try {
    expect(wrapper.text()).toContain(new Date(sendAt).toLocaleString())
    expect(wrapper.get('.composer-send-btn-split').text()).toBe('Retry schedule')
    expect(wrapper.find('.composer-schedule-caret').exists()).toBe(false)

    await wrapper.get('.composer-send-btn-split').trigger('click')

    expect(retry).toHaveBeenCalledExactlyOnceWith()
    expect(store.composerSendIdentity.outgoing.sendAt).toBe(sendAt)
  } finally {
    wrapper.unmount()
    store.closeComposer({ save: false })
    retry.mockRestore()
  }
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

  // Escape must stop at the prompt: the window's own Escape closes the
  // whole composer, draft and all.
  it('closes the prompt on Escape, and only the prompt', async () => {
    const { store, wrapper } = mountActive()
    await wrapper.get('.composer-ai-toggle').trigger('click')

    await wrapper.get('[aria-label="Describe your message"]').trigger('keydown', { key: 'Escape' })

    expect(wrapper.find('.composer-ai-inline').exists()).toBe(false)
    expect(store.isComposerActive).toBe(true)
    wrapper.unmount()
  })

  // The window is lazily loaded, so a reply drafted from the inbox can have
  // the AI panel open before it ever mounts.
  it('shows the prompt when mounted with the AI panel already open', async () => {
    const store = useInboxStore()
    store.isComposerActive = true
    store.isAiDraftActive = true
    const wrapper = mount(ComposerWindow, { attachTo: document.body })
    await nextTick()

    expect(wrapper.find('.composer-ai-inline').exists()).toBe(true)
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

describe('ComposerWindow Cc and Bcc', () => {
  let wrapper

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => wrapper?.unmount())

  function openComposer() {
    const store = useInboxStore()
    store.isComposerActive = true
    store.composerTo = 'priya@example.com'
    store.composerTextArea = 'Hello'
    wrapper = mount(ComposerWindow, { attachTo: document.body })
    return store
  }

  it('offers the lines while the header has the focus and puts them away after', async () => {
    openComposer()
    expect(wrapper.find('.composer-copy-add').exists()).toBe(false)

    await wrapper.get('.composer-subject-inline').trigger('focusin')
    expect(wrapper.findAll('.composer-copy-add')).toHaveLength(2)

    // Focus moving within the header keeps them; leaving it does not.
    await wrapper
      .get('.composer-header')
      .trigger('focusout', { relatedTarget: wrapper.get('.composer-to-inline').element })
    expect(wrapper.findAll('.composer-copy-add')).toHaveLength(2)
    await wrapper.get('.composer-header').trigger('focusout', { relatedTarget: null })
    expect(wrapper.find('.composer-copy-add').exists()).toBe(false)
  })

  it('keeps a filled line and drops an empty one when the header loses the focus', async () => {
    const store = openComposer()
    await wrapper.get('.composer-subject-inline').trigger('focusin')
    await wrapper.get('[aria-label="Add Cc"]').trigger('click')
    await wrapper.get('[aria-label="Add Bcc"]').trigger('click')
    await nextTick()
    await wrapper.get('[data-copy="cc"] input').setValue('dana@example.com')
    expect(store.composerCc).toBe('dana@example.com')

    await wrapper.get('.composer-header').trigger('focusout', { relatedTarget: null })
    expect(wrapper.find('[data-copy="cc"] input').exists()).toBe(true)
    expect(wrapper.find('[data-copy="bcc"]').exists()).toBe(false)
  })

  it('blocks Send while a Cc or Bcc entry is not an address', async () => {
    const store = openComposer()
    const send = () => wrapper.get('.composer-send-btn-split').attributes()
    expect(send()).not.toHaveProperty('disabled')

    store.composerCc = 'dana'
    await nextTick()
    expect(send()).toHaveProperty('disabled')

    store.composerCc = 'dana@example.com'
    store.composerBcc = 'finance@example.com'
    await nextTick()
    expect(send()).not.toHaveProperty('disabled')
  })

  it('starts the next message without a line left empty in the last one', async () => {
    const store = openComposer()
    store.composerTabKey = 'compose:1'
    await nextTick()
    await wrapper.get('.composer-subject-inline').trigger('focusin')
    await wrapper.get('[aria-label="Add Cc"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-copy="cc"]').exists()).toBe(true)

    store.composerTabKey = 'compose:2'
    await nextTick()
    expect(wrapper.find('[data-copy="cc"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Add Cc"]').exists()).toBe(true)
  })

  it('tabs from "to" into a line that is shown', async () => {
    const store = openComposer()
    store.composerCc = 'dana@example.com'
    await nextTick()

    await wrapper.get('.composer-to-inline').trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(wrapper.get('[data-copy="cc"] input').element)
  })
})

describe('ComposerWindow draft conflict', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('shows the adopted body in the editor even while the caret is in it', async () => {
    const store = useInboxStore()
    vi.spyOn(store, 'notify').mockImplementation(() => {})
    store.isComposerActive = true
    store.composerDraftId = 'draft-1'
    store.composerHtml = '<p>Local words</p>'
    const wrapper = mount(ComposerWindow, { attachTo: document.body })
    // Opening focuses the subject on the next tick; then the user clicks in.
    await nextTick()
    const editor = wrapper.get('.composer-editor').element
    editor.focus()

    store.adoptConflictingComposerDraft(store.composerSessionId, {
      id: 'draft-1',
      to: 'alice@example.com',
      text: 'Other tab',
      html: '<p>Other tab</p>',
    })
    await nextTick()

    expect(document.activeElement).toBe(editor)
    expect(editor.innerHTML).toBe('<p>Other tab</p>')
    expect(store.composerHtml).toBe('<p>Other tab</p>')
    wrapper.unmount()
  })
})

describe('ComposerWindow recovery copy', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('writes the queued recovery copy when the focus leaves the window', async () => {
    const store = useInboxStore()
    store.isComposerActive = true
    const flush = vi.spyOn(store, 'flushComposerRecovery').mockResolvedValue(null)
    const outside = document.createElement('button')
    document.body.append(outside)
    const wrapper = mount(ComposerWindow, { attachTo: document.body })
    const subject = wrapper.get('.composer-subject-inline')

    await subject.trigger('focusout', { relatedTarget: wrapper.get('.composer-editor').element })
    expect(flush).not.toHaveBeenCalled()
    await subject.trigger('focusout', { relatedTarget: outside })
    expect(flush).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    outside.remove()
  })
})
