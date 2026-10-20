import { IDBFactory } from 'fake-indexeddb'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useInboxStore } from '../inbox'
import { createOfflineDb, setOfflineDb } from '../../lib/offlineDb'
import { drainDraftRecoveryWrites, loadDraftRecoveries } from '../../lib/draftRecovery'

let store
beforeEach(() => {
  setOfflineDb(createOfflineDb({ indexedDB: new IDBFactory() }))
  setActivePinia(createPinia())
  store = useInboxStore()
  store.composeOwnerSub = 'alice'
  store.isComposerActive = true
  store.composerSubject = 'Important message'
  store.composerTextArea = 'Keep my latest words'
  store.composerHtml = '<p>Keep my latest words</p>'
  vi.spyOn(store, 'notify').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(async () => {
  store.closeComposer({ save: false })
  await drainDraftRecoveryWrites()
  setOfflineDb(null)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('durable draft recovery', () => {
  it.each(['auth', 'fetch'])(
    'does not restore an old account’s scheduled draft after switching during %s',
    async (stage) => {
      store.composerTo = 'recipient@example.com'
      let release
      const blocked = new Promise((resolve) => {
        release = resolve
      })
      const auth = vi
        .spyOn(store, 'authHeaders')
        .mockImplementation(() => (stage === 'auth' ? blocked : Promise.resolve({})))
      const fetchMock = vi.fn(() => blocked)
      vi.stubGlobal('fetch', fetchMock)
      const sending = store.sendEmailLater('2026-10-22T10:00:00Z', 'tomorrow')
      await vi.waitFor(() => expect(stage === 'auth' ? auth : fetchMock).toHaveBeenCalledOnce())

      store.setComposeOwner('bob')
      store.isComposerActive = true
      store.composerSubject = 'Bob’s subject'
      store.composerTextArea = 'Bob’s own message'
      release(
        stage === 'auth'
          ? {}
          : new Response(
              JSON.stringify({
                scheduledSend: { id: 'old-account-send' },
              }),
            ),
      )

      expect(await sending).toBe(false)
      expect(store.composeOwnerSub).toBe('bob')
      expect(store.isComposerActive).toBe(true)
      expect(store.composerSubject).toBe('Bob’s subject')
      expect(store.composerTextArea).toBe('Bob’s own message')
      expect(store.draftRecoveries).toEqual([])
      expect(store.notify).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(stage === 'auth' ? 0 : 1)
    },
  )

  it('rejects restoring another account’s message before changing the active composer', () => {
    const session = store.composerSessionId
    expect(store.restoreComposerMessage({ owner: 'bob', text: 'Private Bob message' })).toBeNull()
    expect(store.composerTextArea).toBe('Keep my latest words')
    expect(store.composerSessionId).toBe(session)
    expect(store.isComposerActive).toBe(true)
  })

  it('recovers a closed composer after a failed save and a fresh store', async () => {
    const save = vi.spyOn(store, 'persistDraft').mockRejectedValue(new Error('Unavailable'))
    store.closeComposer()
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
    await drainDraftRecoveryWrites()
    expect(store.isComposerActive).toBe(false)

    setActivePinia(createPinia())
    const reloaded = useInboxStore()
    reloaded.composeOwnerSub = 'alice'
    await reloaded.loadDraftRecoveries()
    expect(reloaded.draftCount).toBe(1)
    reloaded.openRecoveredDraft(reloaded.draftRecoveries[0])
    expect(reloaded.composerTextArea).toBe('Keep my latest words')
    expect(reloaded.composerDraftId).toBeNull()
    expect(reloaded.composerSaveState).toBe('local')
  })

  it('keeps a newer local edit when an older server save is acknowledged', async () => {
    let finish
    vi.spyOn(store, 'persistDraft').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const saving = store.saveComposerDraft()
    await vi.waitFor(() => expect(finish).toBeDefined())
    store.composerTextArea = 'A newer sentence'
    store.scheduleComposerDraftSave()
    await drainDraftRecoveryWrites()
    finish('server-draft')
    await saving
    expect((await loadDraftRecoveries('alice'))[0].snapshot.text).toBe('A newer sentence')
  })

  it('keeps local words when a conflict adopts the server version', async () => {
    store.composerDraftId = 'd1'
    vi.spyOn(store, 'authHeaders').mockResolvedValue({})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            draft: {
              id: 'd1',
              subject: 'Changed elsewhere',
              text: 'Server words',
              updatedAt: 'v2',
            },
          }),
          { status: 409 },
        ),
      ),
    )
    await store.saveComposerDraft()
    expect(store.composerTextArea).toBe('Server words')
    expect(store.composerRecoveryId).toBeNull()
    expect((await loadDraftRecoveries('alice'))[0].snapshot.text).toBe('Keep my latest words')
    store.composerTextArea = 'Editing the server version'
    store.scheduleComposerDraftSave()
    await drainDraftRecoveryWrites()
    expect(await loadDraftRecoveries('alice')).toHaveLength(2)
  })

  it('keeps a failed draft when another server draft is opened', async () => {
    vi.spyOn(store, 'persistDraft').mockRejectedValue(new Error('Unavailable'))
    await store.openDraft({ id: 'd2', text: 'Other message', subject: 'Other subject' })
    expect(store.composerTextArea).toBe('Other message')
    expect((await loadDraftRecoveries('alice'))[0].snapshot.text).toBe('Keep my latest words')
  })

  it('shows unsaved state and retains an in-memory copy when local storage and server fail', async () => {
    setOfflineDb(createOfflineDb({ indexedDB: null }))
    vi.spyOn(store, 'persistDraft').mockRejectedValue(new Error('Unavailable'))
    await store.saveComposerDraft()
    expect(store.composerSaveState).toBe('error')
    expect(store.draftRecoveries[0]).toMatchObject({
      durable: false,
      snapshot: { text: 'Keep my latest words' },
    })
  })

  it('does not mistake an invalid-draft 400 for a successful empty save', async () => {
    vi.spyOn(store, 'authHeaders').mockResolvedValue({})
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'Invalid draft' }), { status: 400 }),
        ),
    )
    await store.saveComposerDraft()
    expect(await loadDraftRecoveries('alice')).toHaveLength(1)
  })

  it('keeps submitted delivery identity across a server autosave and reload', async () => {
    const identity = {
      requestId: 'delivery-1',
      fingerprint: 'body-hash',
      outgoing: { text: 'Frozen body' },
    }
    store.composerSendIdentity = identity
    vi.spyOn(store, 'persistDraft').mockResolvedValue('d1')
    await store.saveComposerDraft()
    const [record] = await loadDraftRecoveries('alice')
    expect(record.snapshot.sendIdentity).toEqual(identity)
    store.openRecoveredDraft(record)
    expect(store.composerSendIdentity).toEqual(identity)
    await store.discardComposerRecovery(record.id, 'alice')
    expect(await loadDraftRecoveries('alice')).toEqual([])
  })

  it('does not attach a pending send’s recovery identity to a newly opened composer', async () => {
    const submitted = store.composerDraftSnapshot()
    await store.persistComposerRecovery(submitted)
    store.closeComposer({ save: false })
    store.isComposerActive = true
    store.composerTextArea = 'A different message'
    submitted.sendIdentity = { requestId: 'in-flight', fingerprint: 'original', outgoing: {} }
    await store.persistComposerRecovery(submitted)
    expect(store.composerRecoveryId).toBeNull()
    expect(store.composerSendIdentity).toBeNull()
    expect(store.composerTextArea).toBe('A different message')
  })

  it('loads only the current account’s recovery copies', async () => {
    await store.persistComposerRecovery(store.composerDraftSnapshot())
    store.setComposeOwner('bob')
    await store.loadDraftRecoveries()
    expect(store.draftRecoveries).toEqual([])
    expect(await loadDraftRecoveries('alice')).toHaveLength(1)
  })

  it('does not erase newer edits when an earlier send finishes', async () => {
    const submitted = store.composerDraftSnapshot()
    await store.persistComposerRecovery(submitted)
    store.composerTextArea = 'Additional words typed during delivery'
    const newer = store.composerDraftSnapshot()
    await store.persistComposerRecovery(newer)
    await store.discardComposerRecovery(
      submitted.recoveryId,
      submitted.owner,
      submitted.recoveryRevision,
    )
    expect(store.draftRecoveries).toHaveLength(1)
    expect((await loadDraftRecoveries('alice'))[0].snapshot.text).toBe(
      'Additional words typed during delivery',
    )
  })

  it('does not write queued local snapshots after an account change', async () => {
    const save = vi.spyOn(store, 'persistDraft').mockResolvedValue('d1')
    const saving = store.saveComposerDraft()
    store.setComposeOwner('bob')
    await saving
    await drainDraftRecoveryWrites()
    expect(save).not.toHaveBeenCalled()
    expect(await loadDraftRecoveries('alice')).toEqual([])
    expect(store.draftRecoveries).toEqual([])
  })

  it('preserves a departing inline reply when its final remote save fails', async () => {
    vi.spyOn(store, 'persistDraft').mockRejectedValue(new Error('Unavailable'))
    await store.leaveReplyDraft({
      to: 'reader@example.com',
      subject: 'Re: Message',
      text: 'Unsent reply',
      replyToMessageId: 'm1',
    })
    const [record] = await loadDraftRecoveries('alice')
    expect(record.snapshot.text).toBe('Unsent reply')
    store.openRecoveredDraft(record)
    expect(store.composerReplyToMessageId).toBe('m1')
  })
})
