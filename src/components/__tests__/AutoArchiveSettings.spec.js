import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import AutoArchiveSettings from '../AutoArchiveSettings.vue'
import { useInboxStore } from '../../stores/inbox'
import { setAuth0Client } from '../../auth0-client'

const defaults = { marketing: false, coldPitches: false, socialNoise: false }
describe('Auto Archive settings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setAuth0Client(null)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ autoArchive: defaults }) }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('loads three independent opt-in controls and saves their choices', async () => {
    const wrapper = mount(AutoArchiveSettings)
    await flushPromises()
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(3)
    expect(wrapper.find('button[type="submit"]').element.disabled).toBe(true)
    await wrapper.get('input[aria-label="Marketing"]').setValue(true)
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ autoArchive: { ...defaults, marketing: true } }),
    })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(useInboxStore().autoArchive).toEqual({ ...defaults, marketing: true })
    expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toEqual({
      autoArchive: { ...defaults, marketing: true },
    })
    expect(wrapper.text()).toContain('mark read')
    wrapper.unmount()
  })

  it('keeps the draft and saved settings separate after a save failure', async () => {
    const wrapper = mount(AutoArchiveSettings)
    await flushPromises()
    await wrapper.get('input[aria-label="Cold pitches"]').setValue(true)
    fetch.mockResolvedValue({ ok: false, status: 500 })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not save')
    expect(useInboxStore().autoArchive).toEqual(defaults)
    expect(wrapper.get('input[aria-label="Cold pitches"]').element.checked).toBe(true)
    wrapper.unmount()
  })

  it('disables editing on a failed load and allows retry', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500 })
    const wrapper = mount(AutoArchiveSettings)
    await flushPromises()
    expect(wrapper.get('fieldset').element.disabled).toBe(true)
    await wrapper.get('[data-testid="retry-auto-archive"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('fieldset').element.disabled).toBe(false)
    wrapper.unmount()
  })
})
