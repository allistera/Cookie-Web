import { flushPromises, mount } from '@vue/test-utils'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OfflineBanner from '../OfflineBanner.vue'
import {
  noteNetworkFailure,
  noteNetworkSuccess,
  resetConnectivityForTests,
} from '../../lib/connectivity'
import { setOfflineOwner } from '../../lib/offlineCache'
import { OUTBOX_STORE, createOfflineDb, setOfflineDb } from '../../lib/offlineDb'
import {
  enqueueOutbox,
  outboxPending,
  refreshOutboxPending,
  registerOutboxHandler,
  resetOutboxForTests,
} from '../../lib/outbox'

let wrapper
let db
beforeEach(() => {
  db = createOfflineDb({ indexedDB: new IDBFactory() })
  setOfflineDb(db)
  setOfflineOwner('test-account')
  resetOutboxForTests()
  resetConnectivityForTests()
})
afterEach(() => {
  wrapper?.unmount()
  setOfflineDb(null)
  setOfflineOwner(null)
  vi.restoreAllMocks()
})

async function queue(count) {
  for (let index = 0; index < count; index++) {
    await enqueueOutbox({
      kind: 'task-patch',
      key: String(index),
      payload: { content: `Task ${index}` },
    })
  }
}

describe('offline sync status', () => {
  it('hides when online with no pending changes', () => {
    wrapper = mount(OfflineBanner)
    expect(wrapper.find('aside').exists()).toBe(false)
  })

  it.each([
    [0, ''],
    [1, '1 change will sync when you are back online.'],
    [3, '3 changes will sync when you are back online.'],
  ])('describes %s pending changes while offline', async (count, message) => {
    noteNetworkFailure()
    await queue(count)
    wrapper = mount(OfflineBanner)
    expect(wrapper.get('[role=status]').text()).toContain('You are offline')
    expect(
      wrapper
        .findAll('aside > span')
        .slice(1)
        .map((span) => span.text())
        .join(''),
    ).toBe(message)
  })

  it('shows saved changes while online and retries the selected failure', async () => {
    await db.updateAll(OUTBOX_STORE, () => [
      {
        owner: 'test-account',
        kind: 'task-patch',
        key: '1',
        payload: { content: 'Edit task' },
        failure: 'authentication',
      },
      {
        owner: 'test-account',
        kind: 'task-patch',
        key: '2',
        payload: { content: 'Edit document' },
        failure: 'blocked',
      },
      {
        owner: 'test-account',
        kind: 'task-patch',
        key: '3',
        payload: { content: 'Archive mail' },
        failure: 'retry',
      },
    ])
    await refreshOutboxPending()
    noteNetworkSuccess()
    const sent = []
    registerOutboxHandler('task-patch', async (payload) => {
      sent.push(payload.content)
    })
    wrapper = mount(OfflineBanner)
    expect(wrapper.get('[role=status]').text()).toBe('3 changes are saved on this device.')
    const rows = wrapper.findAll('li')
    expect(rows[0].text()).toContain('Sign in again to sync.')
    expect(rows[1].text()).toContain('The server could not accept this change.')
    expect(rows[2].text()).toContain('Waiting to retry.')
    await rows[1].findAll('button')[0].trigger('click')
    await vi.waitFor(() => expect(outboxPending.value).toBe(0))
    await flushPromises()
    expect(sent).toContain('Edit document')
    expect(wrapper.find('aside').exists()).toBe(false)
  })

  it('preserves an unsynced edit until its discard is confirmed', async () => {
    await db.updateAll(OUTBOX_STORE, () => [
      {
        owner: 'test-account',
        kind: 'task-patch',
        key: '1',
        payload: { content: 'Edit task' },
        failure: 'blocked',
      },
    ])
    await refreshOutboxPending()
    wrapper = mount(OfflineBanner)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    await wrapper.findAll('li button')[1].trigger('click')
    expect(outboxPending.value).toBe(1)
    await wrapper.findAll('li button')[1].trigger('click')
    await vi.waitFor(() => expect(outboxPending.value).toBe(0))
    expect(confirm).toHaveBeenLastCalledWith(
      'Discard the unsynced change "Edit task"? This cannot be undone.',
    )
    expect(await db.getAll(OUTBOX_STORE)).toEqual([])
  })
})
