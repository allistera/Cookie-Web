import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CalendarFeeds from '../CalendarFeeds.vue'
import { useInboxStore } from '../../stores/inbox'
import { setCalendarsOwner } from '../../composables/useCalendars'
import { CALENDAR_API_URL } from '../../lib/apiWorkers'

const calendars = [{ id: 'work', name: 'Work', color: '#4f7c6b' }]
const endpoint = `${CALENDAR_API_URL}/calendar-feeds`
const token = 'a'.repeat(64)
const url = `${CALENDAR_API_URL}/calendar-feed.ics?token=${token}`
let wrapper
let fetchMock
let clipboard

function reply(body, status = 200) {
  return { ok: status < 400, status, json: async () => body }
}

async function render(feeds = []) {
  fetchMock.mockResolvedValueOnce(reply({ feeds }))
  wrapper = mount(CalendarFeeds, { props: { calendars } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  setCalendarsOwner('feed-owner')
  vi.spyOn(useInboxStore(), 'authHeaders').mockResolvedValue({ Authorization: 'Bearer fixture' })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  clipboard = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText: clipboard } })
})

afterEach(() => {
  wrapper?.unmount()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setCalendarsOwner(null)
})

describe('private calendar feeds in Settings', () => {
  it('generates and copies a private link without persisting it in the store or browser storage', async () => {
    const storeWrite = vi.spyOn(Storage.prototype, 'setItem')
    await render()
    fetchMock.mockResolvedValueOnce(reply({ calendarId: 'work', token }, 201))
    await wrapper.get('[aria-label="Generate private link for Work"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenLastCalledWith(
      endpoint,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ calendarId: 'work' }),
        cache: 'no-store',
      }),
    )
    expect(wrapper.get('[aria-label="Private subscription link for Work"]').element.value).toBe(url)
    expect(wrapper.text()).toContain('Private feed enabled')
    await wrapper.get('[aria-label="Copy private link for Work"]').trigger('click')
    await flushPromises()
    expect(clipboard).toHaveBeenCalledWith(url)
    expect(wrapper.get('[role="status"]').text()).toBe('Private link copied.')
    expect(storeWrite).not.toHaveBeenCalled()
    expect(JSON.stringify(useInboxStore().$state)).not.toContain(token)
  })

  it('shows enabled status after reopening, without recovering the old secret', async () => {
    await render([{ calendarId: 'work' }])
    expect(wrapper.text()).toContain('Private feed enabled')
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Copy private link for Work"]').exists()).toBe(false)
    await wrapper.get('[aria-label="Replace private link for Work"]').trigger('click')
    expect(wrapper.text()).toContain('The old link will stop working.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockResolvedValueOnce(reply({ calendarId: 'work', token }, 201))
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Confirm replace')
      .trigger('click')
    await flushPromises()
    expect(wrapper.get('input').element.value).toBe(url)
  })

  it('requires confirmation to revoke and removes the generated link on success', async () => {
    await render()
    fetchMock.mockResolvedValueOnce(reply({ calendarId: 'work', token }, 201))
    await wrapper.get('[aria-label="Generate private link for Work"]').trigger('click')
    await flushPromises()
    await wrapper.get('[aria-label="Revoke private link for Work"]').trigger('click')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    fetchMock.mockResolvedValueOnce(reply({ ok: true }))
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Confirm revoke')
      .trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenLastCalledWith(
      endpoint,
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.text()).toContain('Not shared')
    expect(wrapper.get('[role="status"]').text()).toContain('Link revoked.')
  })

  it('preserves the current link if revocation fails', async () => {
    await render()
    fetchMock.mockResolvedValueOnce(reply({ calendarId: 'work', token }, 201))
    await wrapper.get('[aria-label="Generate private link for Work"]').trigger('click')
    await flushPromises()
    await wrapper.get('[aria-label="Revoke private link for Work"]').trigger('click')
    fetchMock.mockResolvedValueOnce(reply({}, 503))
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Confirm revoke')
      .trigger('click')
    await flushPromises()
    expect(wrapper.get('input').element.value).toBe(url)
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not update')
    expect(wrapper.text()).toContain('Private feed enabled')
  })

  it('offers manual copying when clipboard access fails', async () => {
    await render()
    fetchMock.mockResolvedValueOnce(reply({ calendarId: 'work', token }, 201))
    await wrapper.get('[aria-label="Generate private link for Work"]').trigger('click')
    await flushPromises()
    clipboard.mockRejectedValue(new Error('denied'))
    await wrapper.get('[aria-label="Copy private link for Work"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('copy it manually')
    expect(wrapper.get('input').attributes('readonly')).toBeDefined()
  })

  it('blocks generation while status is unknown and lets the user retry', async () => {
    fetchMock.mockResolvedValueOnce(reply({}, 503))
    wrapper = mount(CalendarFeeds, { props: { calendars } })
    await flushPromises()
    expect(wrapper.get('[aria-label="Generate private link for Work"]').element.disabled).toBe(true)
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not load')
    fetchMock.mockResolvedValueOnce(reply({ feeds: [{ calendarId: 'work' }] }))
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Retry private feeds')
      .trigger('click')
    await flushPromises()
    expect(wrapper.get('[aria-label="Replace private link for Work"]').element.disabled).toBe(false)
  })

  it('disables repeat mutations while a generation request is pending', async () => {
    await render()
    let finish
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await wrapper.get('[aria-label="Generate private link for Work"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[aria-label="Generate private link for Work"]').element.disabled).toBe(true)
    finish(reply({ calendarId: 'work', token }, 201))
    await flushPromises()
    expect(wrapper.get('input').element.value).toBe(url)
  })

  it('discards a generated secret when the account changes before the request completes', async () => {
    await render()
    let finish
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await wrapper.get('[aria-label="Generate private link for Work"]').trigger('click')
    await flushPromises()
    setCalendarsOwner('different-owner')
    await wrapper.setProps({ calendars: [] })
    finish(reply({ calendarId: 'work', token }, 201))
    await flushPromises()
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(token)
  })
})
