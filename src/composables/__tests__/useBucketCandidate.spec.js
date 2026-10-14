import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'

import { useBucketCandidate, useBucketPin } from '../useBucketCandidate'
import { useBucketsStore } from '../../stores/buckets'
import { useInboxStore } from '../../stores/inbox'

const email = { kind: 'email', id: 'msg-1', title: 'Re: Acme', meta: { sender: 'Jamie' } }
const task = { kind: 'task', id: 't1', title: 'Send MSA', meta: { projectName: 'Work' } }

// A stand-in for a view: it registers whatever `item` holds.
function viewShowing(item) {
  const Harness = defineComponent({
    setup() {
      useBucketCandidate(() => item.value)
      return () => null
    },
  })
  return mount(Harness)
}

function pinner() {
  let pin
  mount(
    defineComponent({
      setup() {
        pin = useBucketPin()
        return () => null
      },
    }),
  )
  return pin
}

let store

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  store = useBucketsStore()
  store.setOwner('auth0|me')
})

afterEach(() => localStorage.clear())

describe('useBucketCandidate', () => {
  it('registers what the view shows and follows changes to it', async () => {
    const shown = ref(email)
    const view = viewShowing(shown)
    expect(store.candidate).toEqual(email)

    shown.value = { ...email, title: 'Re: Acme (renamed)' }
    await nextTick()
    expect(store.candidate.title).toBe('Re: Acme (renamed)')

    shown.value = null
    await nextTick()
    expect(store.candidate).toBeNull()
    view.unmount()
  })

  it('clears its own registration on unmount, never a newer view’s', () => {
    const first = viewShowing(ref(email))
    const second = viewShowing(ref(task))
    expect(store.candidate).toEqual(task)
    first.unmount()
    expect(store.candidate).toEqual(task)
    second.unmount()
    expect(store.candidate).toBeNull()
  })
})

describe('useBucketPin', () => {
  it('pins the candidate with an undo toast, and unpins it the same way', async () => {
    const inbox = useInboxStore()
    const view = viewShowing(ref(email))
    const pin = pinner()

    expect(pin()).toBe('pinned')
    expect(store.items).toEqual([email])
    expect(inbox.toasts.at(-1)).toMatchObject({ message: 'Pinned to the bucket.', kind: 'success' })
    await inbox.runToastAction(inbox.toasts.at(-1).id)
    expect(store.items).toEqual([])

    pin()
    expect(pin()).toBe('unpinned')
    expect(inbox.toasts.at(-1)).toMatchObject({ message: 'Removed from the bucket.' })
    await inbox.runToastAction(inbox.toasts.at(-1).id)
    expect(store.items).toEqual([email])

    view.unmount()
    expect(pin()).toBeNull()
  })

  it('pins a given item rather than the candidate', () => {
    const pin = pinner()
    expect(pin(task)).toBe('pinned')
    expect(store.items).toEqual([task])
  })
})
