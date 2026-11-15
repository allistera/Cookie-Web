import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setAuth0Client } from '../../auth0-client'
import { useInboxStore } from '../inbox'

// The window dock keeps several messages and emails open as tabs
// (components/WindowDock.vue). These cover the inbox store's side of it:
// which tabs exist, and what a minimised message holds.

const DRAFT_ID = 'draft-1'

let store

function write(subject, text = 'Some words.') {
  store.composerSubject = subject
  store.composerTextArea = text
  store.composerHtml = `<p>${text}</p>`
}

function titles() {
  return store.dockTabs.map((tab) => tab.snapshot?.subject ?? '(in the composer)')
}

beforeEach(() => {
  setActivePinia(createPinia())
  setAuth0Client({ getAccessTokenSilently: vi.fn().mockResolvedValue('test-access-token') })
  // Opening the composer loads its preferences and contacts in passing.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
  store = useInboxStore()
  vi.spyOn(store, 'persistDraft').mockResolvedValue(DRAFT_ID)
})

afterEach(async () => {
  await vi.dynamicImportSettled()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('messages in the window dock', () => {
  it('gives the open message a tab, which closes with it', () => {
    store.composeNew()
    expect(store.dockTabs).toEqual([{ key: store.composerTabKey, kind: 'compose', snapshot: null }])

    store.closeComposer()
    expect(store.dockTabs).toEqual([])
    expect(store.composerTabKey).toBeNull()
  })

  it('keeps a message being written as a tab when another is composed', () => {
    store.composeNew()
    write('Quarterly numbers')
    const first = store.composerTabKey

    store.composeNew()

    expect(store.isComposerActive).toBe(true)
    expect(store.composerSubject).toBe('')
    expect(store.composerTabKey).not.toBe(first)
    expect(titles()).toEqual(['Quarterly numbers', '(in the composer)'])
  })

  it('does not stack tabs for a message nothing was written in', () => {
    store.signatureHtml = '<p>Regards,<br>Me</p>'
    store.composeNew()
    const key = store.composerTabKey

    store.composeNew()

    expect(store.composerTabKey).toBe(key)
    expect(store.dockTabs).toHaveLength(1)
  })

  it('brings a minimised message back with everything it held', () => {
    store.composeNew()
    write('Quarterly numbers', 'Up eight percent.')
    store.composerTo = 'finance@example.com'
    store.composerAttachments = [{ id: 'att-1', filename: 'q3.pdf' }]
    const first = store.composerTabKey
    store.composeNew()
    write('Lunch on Friday')
    const second = store.composerTabKey

    store.openComposerTab(first)

    expect(store.composerTabKey).toBe(first)
    expect(store.composerSubject).toBe('Quarterly numbers')
    expect(store.composerTo).toBe('finance@example.com')
    expect(store.composerTextArea).toBe('Up eight percent.')
    expect(store.composerAttachments).toEqual([{ id: 'att-1', filename: 'q3.pdf' }])
    // The message it replaced waits in its own tab, in the same place.
    expect(store.dockTabs.map((tab) => tab.key)).toEqual([first, second])
    expect(titles()).toEqual(['(in the composer)', 'Lunch on Friday'])
  })

  it('saves a minimised message to Drafts and reopens it onto that row', async () => {
    store.composeNew()
    write('Quarterly numbers')
    const key = store.composerTabKey

    store.minimizeComposer()

    expect(store.isComposerActive).toBe(false)
    await vi.waitFor(() => expect(store.dockTabs[0].snapshot.draftId).toBe(DRAFT_ID))
    expect(store.persistDraft).toHaveBeenCalledTimes(1)
    expect(store.persistDraft.mock.calls[0][1]).toMatchObject({ subject: 'Quarterly numbers' })

    store.openComposerTab(key)
    expect(store.composerDraftId).toBe(DRAFT_ID)
  })

  it('hands the row to a message reopened before its first save landed', async () => {
    let finishSave
    store.persistDraft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = () => resolve(DRAFT_ID)
        }),
    )
    store.composeNew()
    write('Quarterly numbers')
    const key = store.composerTabKey

    store.minimizeComposer()
    store.openComposerTab(key)
    expect(store.composerDraftId).toBeNull()

    await vi.waitFor(() => expect(finishSave).toBeTypeOf('function'))
    finishSave()

    // Without this the next autosave would write a second row for it.
    await vi.waitFor(() => expect(store.composerDraftId).toBe(DRAFT_ID))
  })

  it('keeps one row for a message minimised again before its first save landed', async () => {
    const rows = []
    let finishSave
    store.persistDraft.mockImplementation((draftId) => {
      rows.push(draftId)
      if (rows.length > 1) return Promise.resolve(draftId ?? 'a-second-row')
      return new Promise((resolve) => {
        finishSave = () => resolve('row-7')
      })
    })
    store.composeNew()
    write('Quarterly numbers')
    const key = store.composerTabKey

    store.minimizeComposer()
    store.openComposerTab(key)
    store.minimizeComposer()
    await vi.waitFor(() => expect(finishSave).toBeTypeOf('function'))
    finishSave()

    // The second save writes into the row the first one made.
    await vi.waitFor(() => expect(rows).toHaveLength(2))
    expect(rows[1]).toBe('row-7')
    expect(store.dockTabs[0].snapshot.draftId).toBe('row-7')
  })

  it('closes a minimised tab without touching the open message', () => {
    store.composeNew()
    write('Quarterly numbers')
    const first = store.composerTabKey
    store.composeNew()
    write('Lunch on Friday')

    store.closeDockTab(first)

    expect(titles()).toEqual(['(in the composer)'])
    expect(store.composerSubject).toBe('Lunch on Friday')
  })

  it('opens a saved draft that is minimised from its tab, not as a second copy', async () => {
    store.composeNew()
    write('Quarterly numbers', 'Edited since the last look at Drafts.')
    const key = store.composerTabKey
    store.minimizeComposer()
    await vi.waitFor(() => expect(store.dockTabs[0].snapshot.draftId).toBe(DRAFT_ID))

    await store.openDraft({ id: DRAFT_ID, subject: 'Quarterly numbers', text: 'An older save.' })

    expect(store.composerTabKey).toBe(key)
    expect(store.composerTextArea).toBe('Edited since the last look at Drafts.')
    expect(store.dockTabs).toHaveLength(1)
  })

  it('keeps the open message as a tab when a saved draft opens', async () => {
    store.composeNew()
    write('Lunch on Friday')

    await store.openDraft({ id: 'draft-2', subject: 'Holiday plans', text: 'Where to?' })

    expect(store.composerSubject).toBe('Holiday plans')
    expect(titles()).toEqual(['Lunch on Friday', '(in the composer)'])
  })

  it('keeps the open message as a tab when an undone send returns', () => {
    store.composeNew()
    write('Lunch on Friday')

    store.restoreComposerMessage(
      { to: 'a@example.com', subject: 'Sent too soon', text: 'Wait.', html: '<p>Wait.</p>' },
      'draft-9',
    )

    expect(store.composerSubject).toBe('Sent too soon')
    expect(store.composerDraftId).toBe('draft-9')
    expect(titles()).toEqual(['Lunch on Friday', '(in the composer)'])
  })

  it('drops every tab when the account changes', () => {
    store.setComposeOwner('user-a')
    store.composeNew()
    write('Quarterly numbers')
    store.minimizeComposer()
    store.dockTabs.push({ key: 'email:m1', kind: 'email', item: { id: 'm1', title: 'Hi' } })

    store.setComposeOwner('user-b')

    expect(store.dockTabs).toEqual([])
    expect(store.composerTabKey).toBeNull()
  })
})

describe('emails in the window dock', () => {
  it('drops the tab of an email that left its list, and closes the reader on it', () => {
    store.dockTabs.push(
      { key: 'email:m1', kind: 'email', item: { id: 'm1', title: 'First' } },
      { key: 'email:m2', kind: 'email', item: { id: 'm2', title: 'Second' } },
    )
    store.openEmailId = 'm1'

    store.releaseEmail('m1')

    expect(store.openEmailId).toBeNull()
    expect(store.dockTabs.map((tab) => tab.key)).toEqual(['email:m2'])
  })

  it('leaves the reader on another email alone', () => {
    store.openEmailId = 'm2'

    store.releaseEmail('m1')

    expect(store.openEmailId).toBe('m2')
  })
})
