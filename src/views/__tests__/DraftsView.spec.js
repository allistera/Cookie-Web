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
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-21T12:00:00Z'))
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
    expect(wrapper.text()).toContain('Loading your drafts')
    store.isDraftsLoading = false
    await nextTick()
    expect(wrapper.text()).toContain('Nothing saved')
  })

  it.each([
    ['2026-10-21T11:59:50Z', 'Saved just now'],
    ['2026-10-21T11:55:00Z', 'Saved 5m ago'],
    ['2026-10-21T10:00:00Z', 'Saved 2h ago'],
    ['2026-10-19T12:00:00Z', 'Saved 19 Oct'],
    ['invalid', ''],
  ])('formats the last save time %s', (updatedAt, expected) => {
    store.drafts = [{ id: 'draft-1', updatedAt }]
    wrapper = mount(DraftsView)
    expect(wrapper.get('.drafts-time').text()).toBe(expected)
    expect(wrapper.get('.drafts-subject').text()).toBe('(no subject)')
    expect(wrapper.get('.drafts-to').text()).toBe('No recipient yet')
  })

  it('shows previews and attachment counts and opens a draft', async () => {
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
    const rows = wrapper.findAll('.drafts-row')
    expect(rows[0].get('.drafts-preview').text()).toBe(`${'x'.repeat(140)}…`)
    expect(rows[1].get('.drafts-preview').text()).toBe('Two lines')
    expect(rows[0].get('.drafts-attachments').text()).toContain('2')
    expect(rows[1].get('.drafts-attachments').text()).toContain('1')
    await rows[0].get('.drafts-open').trigger('click')
    expect(open).toHaveBeenCalledWith(draft)
  })

  it.each([true, false])(
    'closes the composer only when discarding its own draft: %s',
    async (active) => {
      store.drafts = [{ id: 'draft-1', subject: 'Hello' }]
      store.composerDraftId = active ? 'draft-1' : 'another-draft'
      const discard = vi.spyOn(store, 'discardDraft').mockResolvedValue(true)
      const close = vi.spyOn(store, 'closeComposer').mockImplementation(() => {})
      wrapper = mount(DraftsView)
      await wrapper.get('.drafts-discard').trigger('click')
      await flushPromises()
      expect(discard).toHaveBeenCalledWith('draft-1')
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
    store.composerRecoveryId = record.id
    const open = vi.spyOn(store, 'openRecoveredDraft').mockResolvedValue()
    const discard = vi.spyOn(store, 'discardComposerRecovery').mockResolvedValue()
    const close = vi.spyOn(store, 'closeComposer').mockImplementation(() => {})
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    wrapper = mount(DraftsView)
    expect(wrapper.text()).toContain('Saved on this device')
    expect(wrapper.text()).toContain('Storage unavailable — keep this tab open')
    await wrapper.get('.drafts-open').trigger('click')
    expect(open).toHaveBeenCalledWith(record)
    await wrapper.get('.drafts-discard').trigger('click')
    expect(discard).not.toHaveBeenCalled()
    await wrapper.get('.drafts-discard').trigger('click')
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(discard).toHaveBeenCalledWith(record.id, record.owner)
    expect(close).toHaveBeenCalledWith({ save: false })
  })
})
