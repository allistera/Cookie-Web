import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInboxStore } from '../inbox'

let store

beforeEach(() => {
  setActivePinia(createPinia())
  store = useInboxStore()
  store.composeOwnerSub = 'account-a'
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(store, 'notify').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('mail settings failures', () => {
  const notifiedActions = [
    ['loadRules', [], 'Failed to load tag rules.'],
    ['createRule', [{ name: 'New rule' }], 'Failed to create rule.'],
    ['deleteRule', ['rule-1'], 'Failed to delete rule.'],
    ['createCategory', [{ name: 'Work' }], 'Failed to create category.'],
    ['deleteCategory', ['category-1'], 'Failed to delete category.'],
    ['createLabel', [{ name: 'Work' }], 'Failed to create label.'],
    ['deleteLabel', ['label-1'], 'Failed to delete label.'],
    ['requestAiSnippet', ['Write a greeting'], 'AI snippet generation failed. Please try again.'],
    ['setMessageCategory', [{ id: 'email-1' }, { id: 'category-1' }], 'Failed to update category.'],
  ]

  it.each(notifiedActions)(
    '%s reports API failures without deleting cached settings',
    async (action, args, message) => {
      store.rules = [{ id: 'rule-1', name: 'Existing rule' }]
      store.categories = [{ id: 'category-1', name: 'Existing category' }]
      store.labels = [{ id: 'label-1', name: 'Existing label' }]
      await store[action](...args)
      expect(store.notify).toHaveBeenCalledWith(message, 'error')
      expect(store.rules).toEqual([{ id: 'rule-1', name: 'Existing rule' }])
      expect(store.categories).toEqual([{ id: 'category-1', name: 'Existing category' }])
      expect(store.labels).toEqual([{ id: 'label-1', name: 'Existing label' }])
    },
  )

  it.each([
    ['saveInterests', ['testing']],
    ['loadEnrichmentSettings', []],
    ['saveEnrichmentSettings', [{}]],
    ['loadAutoArchive', []],
    ['saveAutoArchive', [{}]],
    ['saveSpamRetention', [30]],
    ['loadNtfySubscription', []],
    ['createNtfySubscription', []],
    ['disableNtfySubscription', []],
  ])('%s exposes server failure for the settings UI', async (action, args) => {
    await expect(store[action](...args)).rejects.toThrow('503')
  })

  it('restores optimistic rule edits when saving fails', async () => {
    const rule = { id: 'rule-1', name: 'Original', enabled: true }
    expect(await store.updateRule(rule, { name: 'Changed', enabled: false })).toBe(false)
    expect(rule).toEqual({ id: 'rule-1', name: 'Original', enabled: true })
    expect(store.notify).toHaveBeenCalledWith('Failed to update rule.', 'error')
  })

  it('restores optimistic automatic tagging when saving fails', async () => {
    const label = { id: 'label-1', auto_apply: false }
    await store.setLabelAutoApply(label, true)
    expect(label.auto_apply).toBe(false)
    expect(store.notify).toHaveBeenCalledWith('Failed to update auto-tagging.', 'error')
  })

  it('preserves the existing label when renaming fails', async () => {
    const label = { id: 'label-1', name: 'Original' }
    expect(await store.renameLabel(label, 'Changed')).toBe(false)
    expect(label.name).toBe('Original')
    expect(store.notify).toHaveBeenCalledWith('Failed to rename label.', 'error')
  })

  it.each(['createLabel', 'createCategory'])('%s explains duplicate names', async (action) => {
    fetch.mockResolvedValue({ ok: false, status: 409 })
    expect(await store[action]({ name: 'Existing' })).toBe(false)
    expect(store.notify).toHaveBeenCalledWith(expect.stringContaining('already exists'), 'error')
  })

  it.each(['javascript:alert(1)', 'data:text/html,hello', 'invalid-url'])(
    'rejects unsafe attachment URL %s',
    async (url) => {
      fetch.mockResolvedValue({ ok: true, json: async () => ({ url }) })
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
      expect(await store.downloadAttachment({ id: 'file-1', downloadable: true })).toBe(false)
      expect(click).not.toHaveBeenCalled()
      expect(store.notify).toHaveBeenCalledWith('Attachment download failed.', 'error')
    },
  )

  it('reports an attachment response missing its URL', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    expect(await store.downloadAttachment({ id: 'file-1', downloadable: true })).toBe(false)
    expect(store.notify).toHaveBeenCalledWith('Failed to download attachment.', 'error')
  })

  it('retains receipt state when its advisory endpoint is unavailable', async () => {
    const email = { id: 'email-1', readAt: '2026-10-21', readCount: 2 }
    await store.loadReadReceipts([email])
    expect(email).toEqual({ id: 'email-1', readAt: '2026-10-21', readCount: 2 })
    expect(store.notify).not.toHaveBeenCalled()
  })
})
