import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DraftsView from '../DraftsView.vue'
import { useInboxStore } from '../../stores/inbox'

let store
let wrapper
beforeEach(() => {
  setActivePinia(createPinia())
  store = useInboxStore()
  vi.spyOn(store, 'loadDrafts').mockResolvedValue()
  vi.spyOn(store, 'loadDraftRecoveries').mockResolvedValue()
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})

describe('drafts page', () => {
  it('refreshes account drafts and local recovery copies and shows loading and empty states', async () => {
    store.isDraftsLoading = true
    wrapper = mount(DraftsView)
    expect(store.loadDrafts).toHaveBeenCalledWith({ force: true })
    expect(store.loadDraftRecoveries).toHaveBeenCalledOnce()
    expect(wrapper.get('.ni-header h1').text()).toBe('Drafts')
    expect(wrapper.get('.ni-empty').text()).toContain('Loading your drafts')
    store.isDraftsLoading = false
    await nextTick()
    expect(wrapper.get('.ni-empty').text()).toContain('Nothing saved')
  })

  it.each([
    ['2026-10-19T12:00:00Z', '19 Oct'],
    ['invalid', ''],
  ])('shows the last save the way mail lists show a date: %s', (updatedAt, expected) => {
    store.drafts = [{ id: 'draft-1', updatedAt }]
    wrapper = mount(DraftsView)
    expect(wrapper.get('.drafts-time').text()).toBe(expected)
    expect(wrapper.get('.ni-subject-text').text()).toBe('(no subject)')
    expect(wrapper.get('.ni-sender').text()).toBe('No recipient yet')
  })

  it('shows the time of day for a draft saved today', () => {
    store.drafts = [{ id: 'draft-1', updatedAt: new Date().toISOString() }]
    wrapper = mount(DraftsView)
    expect(wrapper.get('.drafts-time').text()).toMatch(/^\d{1,2}:\d{2} [ap]m$/)
  })

  it('lays drafts out as mail list rows with recipient, preview and attachments, and opens one', async () => {
    const draft = {
      id: 'draft-1',
      subject: 'Hello',
      to: 'reader@example.com',
      preview: 'x'.repeat(141),
      attachmentCount: 2,
    }
    store.drafts = [draft, { id: 'draft-2', text: '  Two\n lines ', attachments: [{}] }]
    const open = vi.spyOn(store, 'openDraft').mockResolvedValue()
    wrapper = mount(DraftsView)
    const rows = wrapper.findAll('.ni-list .ni-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].attributes('aria-label')).toBe('To: reader@example.com: Hello')
    expect(rows[0].get('.ni-sender').text()).toBe('To: reader@example.com')
    expect(rows[0].get('.drafts-preview').text()).toBe(`${'x'.repeat(140)}…`)
    expect(rows[1].get('.drafts-preview').text()).toBe('Two lines')
    expect(rows[0].get('.ni-row-attachment-icon').attributes('title')).toBe('2 attachments')
    expect(rows[1].get('.ni-row-attachment-icon').attributes('title')).toBe('1 attachment')
    // No band is needed while every draft is an account draft.
    expect(wrapper.find('.ni-group-header').exists()).toBe(false)
    await rows[0].trigger('click')
    expect(open).toHaveBeenCalledWith(draft)
    await rows[1].trigger('keydown', { key: 'Enter' })
    expect(open).toHaveBeenLastCalledWith(store.drafts[1])
  })

  it.each([true, false])(
    'closes the composer only when discarding its own draft: %s',
    async (active) => {
      store.drafts = [{ id: 'draft-1', subject: 'Hello' }]
      store.composerDraftId = active ? 'draft-1' : 'another-draft'
      const discard = vi.spyOn(store, 'discardDraft').mockResolvedValue(true)
      const close = vi.spyOn(store, 'closeComposer').mockImplementation(() => {})
      const open = vi.spyOn(store, 'openDraft').mockResolvedValue()
      wrapper = mount(DraftsView)
      await wrapper.get('.ni-actions .ni-action-btn').trigger('click')
      await flushPromises()
      expect(discard).toHaveBeenCalledWith('draft-1')
      // Discarding from the row's actions must not also open the draft.
      expect(open).not.toHaveBeenCalled()
      expect(close).toHaveBeenCalledTimes(active ? 1 : 0)
    },
  )

  it('opens recovered drafts and requires confirmation before discarding', async () => {
    const record = {
      id: 'recovery-1',
      owner: 'account',
      snapshot: { subject: 'Recovered', to: 'reader@example.com', text: 'Unsaved' },
      durable: true,
    }
    store.draftRecoveries = [record, { id: 'recovery-2', snapshot: {}, durable: false }]
    store.drafts = [{ id: 'draft-9', subject: 'On the account' }]
    store.composerRecoveryId = record.id
    const open = vi.spyOn(store, 'openRecoveredDraft').mockResolvedValue()
    const discard = vi.spyOn(store, 'discardComposerRecovery').mockResolvedValue()
    const close = vi.spyOn(store, 'closeComposer').mockImplementation(() => {})
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    wrapper = mount(DraftsView)
    // With both kinds on the page, a band names each group.
    expect(wrapper.findAll('.ni-group-header').map((band) => band.text())).toEqual([
      'Recoverable local drafts',
      'Saved to your account',
    ])
    expect(wrapper.text()).toContain('Saved on this device')
    expect(wrapper.text()).toContain('Storage unavailable — keep this tab open')
    await wrapper.get('.drafts-row').trigger('click')
    expect(open).toHaveBeenCalledExactlyOnceWith(record)
    await wrapper.get('.ni-actions .ni-action-btn').trigger('click')
    expect(discard).not.toHaveBeenCalled()
    await wrapper.get('.ni-actions .ni-action-btn').trigger('click')
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(discard).toHaveBeenCalledWith(record.id, record.owner)
    expect(close).toHaveBeenCalledWith({ save: false })
    // Neither Discard click reached the row and opened the copy again.
    expect(open).toHaveBeenCalledTimes(1)
  })
})
