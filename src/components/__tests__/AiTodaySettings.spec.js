import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AiTodaySettings from '../AiTodaySettings.vue'
import { defaultEnrichmentSettings } from '../../lib/enrichmentSettings'
import { useInboxStore } from '../../stores/inbox'
import { setAuth0Client } from '../../auth0-client'

const defaults = {
  model: defaultEnrichmentSettings.model,
  schedule: {
    ...defaultEnrichmentSettings.schedule,
    days: [...defaultEnrichmentSettings.schedule.days],
  },
}

describe('AI Today settings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setAuth0Client(null)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ enrichmentSettings: defaults }),
      }),
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it('loads the nano 09:00–19:00 default and saves editable model and schedule fields', async () => {
    const wrapper = mount(AiTodaySettings)
    await flushPromises()

    expect(wrapper.get('[aria-label="AI Today model"]').element.value).toBe('gpt-5-nano')
    expect(wrapper.get('[aria-label="Schedule start time"]').element.value).toBe('9')
    expect(wrapper.get('[aria-label="Schedule end time"]').element.value).toBe('19')
    expect(wrapper.findAll('.ai-today-days input:checked')).toHaveLength(7)

    await wrapper.get('[aria-label="AI Today model"]').setValue('gpt-4.1-nano')
    await wrapper.get('[aria-label="Schedule interval"]').setValue('3')
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        enrichmentSettings: {
          ...defaults,
          model: 'gpt-4.1-nano',
          schedule: { ...defaults.schedule, intervalHours: 3 },
        },
      }),
    })
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toEqual({
      enrichmentSettings: {
        ...defaults,
        model: 'gpt-4.1-nano',
        schedule: { ...defaults.schedule, intervalHours: 3 },
      },
    })
    expect(useInboxStore().enrichmentSettings.model).toBe('gpt-4.1-nano')
  })

  it('keeps an edited draft after a failed save', async () => {
    const wrapper = mount(AiTodaySettings)
    await flushPromises()
    await wrapper.get('[aria-label="Schedule start time"]').setValue('10')
    fetch.mockResolvedValueOnce({ ok: false, status: 500 })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not save')
    expect(wrapper.get('[aria-label="Schedule start time"]').element.value).toBe('10')
    expect(useInboxStore().enrichmentSettings.schedule.startHour).toBe(9)
  })

  it('disables editing after a failed load and supports retry', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500 })
    const wrapper = mount(AiTodaySettings)
    await flushPromises()
    expect(wrapper.get('.ai-today-settings > fieldset').element.disabled).toBe(true)
    await wrapper.get('[data-testid="retry-ai-today-settings"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.ai-today-settings > fieldset').element.disabled).toBe(false)
  })
})
