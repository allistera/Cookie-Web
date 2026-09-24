import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ShareAvailability from '../ShareAvailability.vue'
import { useInboxStore } from '../../stores/inbox'
import { resetCalendarsStateForTests, setCalendarsOwner } from '../../composables/useCalendars'

const calendar = { id: '11111111-1111-1111-1111-111111111111', name: 'Work' }
let wrapper
let store
let fetchMock
const json = (body) => ({ ok: true, json: async () => body })

beforeEach(() => {
  setActivePinia(createPinia())
  store = useInboxStore()
  store.setComposeOwner('owner-a')
  resetCalendarsStateForTests()
  setCalendarsOwner('owner-a')
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.open = true
    },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.open = false
    },
  })
  fetchMock = vi.fn().mockResolvedValueOnce(json({ calendars: [calendar] }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  wrapper?.unmount()
  delete HTMLDialogElement.prototype.showModal
  delete HTMLDialogElement.prototype.close
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function openDialog() {
  wrapper = mount(ShareAvailability, { attachTo: document.body })
  await wrapper.get('button').trigger('click')
  await flushPromises()
  return new DOMWrapper(document.querySelector('dialog'))
}

describe('Share availability review', () => {
  it('requires a selected calendar and explicit interpretation consent', async () => {
    const dialog = await openDialog()
    expect(dialog.get('button[type="submit"]').attributes()).toHaveProperty('disabled')
    const inputs = dialog.findAll('input[type="checkbox"]')
    await inputs.at(-1).setValue(true)
    expect(dialog.get('button[type="submit"]').attributes()).not.toHaveProperty('disabled')
    await inputs[0].setValue(false)
    expect(dialog.get('button[type="submit"]').attributes()).toHaveProperty('disabled')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('insert')).toBeUndefined()
  })

  it('cannot suggest times after a failed fresh check', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ complete: false, busy: [], sources: [], error: 'Availability is incomplete.' }),
    )
    const dialog = await openDialog()
    await dialog.findAll('input[type="checkbox"]').at(-1).setValue(true)
    await dialog.get('form').trigger('submit')
    await flushPromises()
    expect(dialog.get('[role="alert"]').text()).toBe('Availability is incomplete.')
    expect(dialog.find('.availability-slots').exists()).toBe(false)
    expect(wrapper.emitted('insert')).toBeUndefined()
  })

  it('closes on account change and ignores a late response from the previous account', async () => {
    let resolveOld
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    const dialog = await openDialog()
    await dialog.findAll('input[type="checkbox"]').at(-1).setValue(true)
    await dialog.get('form').trigger('submit')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    setCalendarsOwner('owner-b')
    store.setComposeOwner('owner-b')
    await nextTick()
    resolveOld(
      json({ complete: true, busy: [], window: { start: Date.now(), end: Date.now() + 86400000 } }),
    )
    await flushPromises()
    expect(document.querySelector('dialog')).toBeNull()
    expect(wrapper.emitted('insert')).toBeUndefined()
    expect(wrapper.emitted('previewState')).toEqual([[true], [false]])
  })
})
