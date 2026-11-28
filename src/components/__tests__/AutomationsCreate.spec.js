import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AutomationsCreate from '../AutomationsCreate.vue'
import { localTimeZone } from '../../lib/automationJobs'
import { useAutomationsStore } from '../../stores/automations'

let store

beforeEach(() => {
  setActivePinia(createPinia())
  store = useAutomationsStore()
})

afterEach(() => vi.restoreAllMocks())

async function mountPage(path = '/automations/new') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  })
  await router.push(path)
  const wrapper = mount(AutomationsCreate, { global: { plugins: [router] } })
  return { wrapper, router }
}

const day = (wrapper, id) => wrapper.get(`.create-day input[value="${id}"]`)

describe('AutomationsCreate', () => {
  it('offers the automation that can be set up, at its usual time on every day', async () => {
    const { wrapper } = await mountPage()

    expect(wrapper.get('h1').text()).toBe('Create Automation')
    expect(wrapper.get('.create-job-title').text()).toBe('Reschedule Overdue Tasks to Today')
    expect(wrapper.get('.create-job input').element.checked).toBe(true)
    expect(wrapper.get('input[type="time"]').element.value).toBe('00:00')
    expect(wrapper.findAll('.create-day input').every((input) => input.element.checked)).toBe(true)
    expect(wrapper.get('.create-summary').text()).toBe(
      `Every day at 00:00, ${localTimeZone()} time.`,
    )
  })

  it('opens on the job a Templates card names and ignores one it does not know', async () => {
    const known = await mountPage('/automations/new?job=reschedule_overdue')
    expect(known.wrapper.get('.create-job input').element.checked).toBe(true)

    const unknown = await mountPage('/automations/new?job=send_everything')
    expect(unknown.wrapper.get('.create-job input').element.checked).toBe(true)
  })

  it('creates the automation on the chosen schedule and goes to the Dashboard', async () => {
    const create = vi.spyOn(store, 'create').mockResolvedValue({ id: 'automation-1' })
    const { wrapper, router } = await mountPage()

    await wrapper.get('input[type="time"]').setValue('07:30')
    await day(wrapper, 'sat').setValue(false)
    await day(wrapper, 'sun').setValue(false)
    expect(wrapper.get('.create-summary').text()).toBe(
      `Weekdays at 07:30, ${localTimeZone()} time.`,
    )
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(create).toHaveBeenCalledWith({
      handler: 'reschedule_overdue',
      trigger: {
        type: 'schedule',
        time: '07:30',
        days: ['mon', 'tue', 'wed', 'thu', 'fri'],
        timeZone: localTimeZone(),
      },
    })
    expect(router.currentRoute.value.path).toBe('/automations')
  })

  it('stays on the page when the automation could not be created', async () => {
    vi.spyOn(store, 'create').mockResolvedValue(null)
    const { wrapper, router } = await mountPage()

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/automations/new')
    expect(wrapper.get('button[type="submit"]').element.disabled).toBe(false)
  })

  it('will not create a schedule with no day on it', async () => {
    const create = vi.spyOn(store, 'create')
    const { wrapper } = await mountPage()

    for (const input of wrapper.findAll('.create-day input')) await input.setValue(false)

    expect(wrapper.get('.create-summary').text()).toBe('Choose a time and at least one day.')
    expect(wrapper.get('button[type="submit"]').element.disabled).toBe(true)
    await wrapper.get('form').trigger('submit')
    expect(create).not.toHaveBeenCalled()
  })
})
