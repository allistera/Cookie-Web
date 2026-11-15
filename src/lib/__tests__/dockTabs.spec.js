import { describe, expect, it } from 'vitest'

import { emailBucketItem } from '../bucketItems'
import { dockTabRoute, dockTabTitle, emailDockTab, isDockTabOpen, isDockVisible } from '../dockTabs'

const email = { id: 42, subject: 'Revised floor plan', sender: 'City Construction' }
const emailTab = emailDockTab(emailBucketItem(email, { folder: 'label', label: 'Home' }))
const openMessage = { key: 'compose:1', kind: 'compose', snapshot: null }
const minimised = { key: 'compose:2', kind: 'compose', snapshot: { subject: 'Lunch on Friday' } }
const restored = {
  key: 'compose:draft:d1',
  kind: 'compose',
  snapshot: null,
  stored: { draftId: 'd1', subject: 'Holiday plans' },
}

function store(state = {}) {
  return { dockTabs: [], composerTabKey: null, composerSubject: '', openEmailId: null, ...state }
}

describe('dock tabs', () => {
  it('routes an email tab back to the folder it was open in', () => {
    expect(emailTab.key).toBe('email:42')
    expect(dockTabRoute(emailTab)).toEqual({
      path: '/inbox',
      query: { filter: 'label', label: 'Home', open: '42' },
    })
  })

  it('titles a tab by its subject', () => {
    expect(dockTabTitle(emailTab, store())).toBe('Revised floor plan')
    expect(dockTabTitle(minimised, store())).toBe('Lunch on Friday')
    // The message in the composer is titled from what is being typed.
    const composing = { composerTabKey: 'compose:1', composerSubject: 'Quarterly numbers' }
    expect(dockTabTitle(openMessage, store(composing))).toBe('Quarterly numbers')
    expect(dockTabTitle(openMessage, store({ ...composing, composerSubject: '  ' }))).toBe(
      'New message',
    )
    // One restored after a refresh keeps the subject stored with it, until
    // it is opened and typed in again.
    expect(dockTabTitle(restored, store(composing))).toBe('Holiday plans')
    expect(
      dockTabTitle(restored, store({ composerTabKey: restored.key, composerSubject: 'Edited' })),
    ).toBe('Edited')
  })

  it('knows which tab is open, whatever type the email id is', () => {
    expect(isDockTabOpen(emailTab, store({ openEmailId: 42 }))).toBe(true)
    expect(isDockTabOpen(emailTab, store({ openEmailId: 7 }))).toBe(false)
    expect(isDockTabOpen(emailTab, store())).toBe(false)
    expect(isDockTabOpen(openMessage, store({ composerTabKey: 'compose:1' }))).toBe(true)
    expect(isDockTabOpen(minimised, store({ composerTabKey: 'compose:1' }))).toBe(false)
  })

  it('shows the dock once there is something to switch to', () => {
    expect(isDockVisible(store())).toBe(false)
    // One message, already open in the composer: no tab needed under it.
    expect(isDockVisible(store({ dockTabs: [openMessage], composerTabKey: 'compose:1' }))).toBe(
      false,
    )
    expect(isDockVisible(store({ dockTabs: [minimised] }))).toBe(true)
    expect(
      isDockVisible(store({ dockTabs: [openMessage, emailTab], composerTabKey: 'compose:1' })),
    ).toBe(true)
  })
})
