import { AUTH0_INJECTION_KEY } from '@auth0/auth0-vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import AutomationsDashboard from '../AutomationsDashboard.vue'
import { localTimeZone } from '../../lib/automationJobs'
import { greetingNameOf } from '../../lib/greetingName'
import { useAutomationsStore } from '../../stores/automations'

const AUTOMATION = {
  id: 'automation-1',
  name: 'Reschedule Overdue Tasks to Today',
  handler: 'reschedule_overdue',
  trigger: {
    type: 'schedule',
    time: '00:00',
    days: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    // Wherever the suite runs: a schedule made in the zone the person is in.
    timeZone: localTimeZone(),
  },
  enabled: true,
  nextRunAt: '2026-11-29T12:00:00.000Z',
}
const RUN = {
  id: 'run-1',
  automationId: 'automation-1',
  automationName: 'Reschedule Overdue Tasks to Today',
  status: 'succeeded',
  summary: 'Moved 2 overdue tasks to today.',
  startedAt: '2026-11-28T12:00:00.000Z',
}

let store
// What the page's read on arrival brings back.
let loaded

beforeEach(() => {
  setActivePinia(createPinia())
  store = useAutomationsStore()
  loaded = { automations: [], runs: [] }
  vi.spyOn(store, 'load').mockImplementation(async () => {
    store.automations = loaded.automations
    store.runs = loaded.runs
    store.isLoaded = true
    return true
  })
})

// Local time, as the page reads it: a Saturday afternoon unless told otherwise.
function mountAt(hour, user = { name: 'Allister Antosik' }) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 28, hour, 30))
  return mount(AutomationsDashboard, {
    global: {
      provide: { [AUTH0_INJECTION_KEY]: { user: ref(user) } },
      stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  })
}

async function mountLoaded(automations = [AUTOMATION], runs = [RUN]) {
  loaded = { automations, runs }
  const wrapper = mountAt(14)
  await flushPromises()
  return wrapper
}

describe('AutomationsDashboard', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows the date, a greeting by first name and what the page is for', () => {
    const wrapper = mountAt(14)

    expect(wrapper.get('.dashboard-date').text()).toBe('Saturday 28 November')
    expect(wrapper.get('h1').text()).toBe('Good afternoon, Allister.')
    expect(wrapper.get('.dashboard-lead').text()).toBe(
      'Once your automations start running, you will see what they did here.',
    )
  })

  it.each([
    [0, 'Good morning'],
    [11, 'Good morning'],
    [12, 'Good afternoon'],
    [17, 'Good afternoon'],
    [18, 'Good evening'],
    [23, 'Good evening'],
  ])('at %i:30 says %s', (hour, words) => {
    expect(mountAt(hour).get('h1').text()).toBe(`${words}, Allister.`)
  })

  it('greets without a name rather than by an email address', () => {
    const wrapper = mountAt(9, { name: 'allisteraall@gmail.com' })

    expect(wrapper.get('h1').text()).toBe('Good morning.')
  })

  it('opens ChatGPT in a new tab with the example already in its box', () => {
    const card = mountAt(14).get('a.dashboard-start')
    const url = new URL(card.attributes('href'))

    expect(card.text()).toContain('Ask ChatGPT for your first automation')
    expect(card.text()).toContain('Open ChatGPT')
    expect(card.get('.dashboard-start-example').text()).toBe(
      '“Every Friday, add a task to review what I completed this week”',
    )
    expect(url.origin).toBe('https://chatgpt.com')
    expect(url.searchParams.get('prompt')).toBe(
      'Every Friday, add a task to review what I completed this week',
    )
    expect(card.attributes('target')).toBe('_blank')
    expect(card.attributes('rel')).toBe('noopener noreferrer')
  })

  it('says no automation has run, over a placeholder hidden from screen readers', () => {
    const activity = mountAt(14).get('section.dashboard-activity')

    expect(activity.get('h2').text()).toBe('Recent activity')
    expect(activity.get('[role="status"]').text()).toBe('No automation runs yet.')
    expect(activity.get('.dashboard-ghost').attributes('aria-hidden')).toBe('true')
    expect(activity.findAll('.dashboard-ghost-row')).toHaveLength(2)
  })
})

describe('AutomationsDashboard automations', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('points to Create Automation when there are none', async () => {
    const list = (await mountLoaded([], [])).get('section.dashboard-list')

    expect(list.get('h2').text()).toBe('Your automations')
    expect(list.get('.dashboard-note').text()).toBe('You have no automations yet. Create one')
    expect(list.get('a').attributes('href')).toBe('/automations/new')
  })

  it('lists each automation with its schedule and next run', async () => {
    const row = (await mountLoaded()).get('[data-testid="dashboard-automation"]')

    expect(row.get('.dashboard-automation-name').text()).toBe('Reschedule Overdue Tasks to Today')
    expect(row.get('.dashboard-automation-when').text()).toMatch(
      /^Every day at 00:00 · Next run Sun,? 29 Nov,? \d\d:\d\d$/,
    )
    expect(row.get('input[type="checkbox"]').element.checked).toBe(true)
  })

  it('says an automation is switched off instead of naming a next run', async () => {
    const wrapper = await mountLoaded([{ ...AUTOMATION, enabled: false, nextRunAt: null }])

    expect(wrapper.get('.dashboard-automation-when').text()).toBe(
      'Every day at 00:00 · Switched off',
    )
    expect(wrapper.get('.dashboard-switch input').element.checked).toBe(false)
  })

  it('switches an automation off and runs it now through the store', async () => {
    const setEnabled = vi.spyOn(store, 'setEnabled').mockResolvedValue(true)
    vi.spyOn(store, 'refreshTasks').mockResolvedValue()
    const runNow = vi.spyOn(store, 'runNow').mockResolvedValue(true)
    const wrapper = await mountLoaded()

    await wrapper.get('.dashboard-switch input').setValue(false)
    await wrapper
      .get('button[aria-label="Run Reschedule Overdue Tasks to Today now"]')
      .trigger('click')

    expect(setEnabled).toHaveBeenCalledWith('automation-1', false)
    expect(runNow).toHaveBeenCalledWith('automation-1')
  })

  it('names the schedule’s time zone when the person is somewhere else', async () => {
    const elsewhere = localTimeZone() === 'Pacific/Kiritimati' ? 'Etc/GMT+12' : 'Pacific/Kiritimati'
    const wrapper = await mountLoaded([
      { ...AUTOMATION, trigger: { ...AUTOMATION.trigger, timeZone: elsewhere } },
    ])

    expect(wrapper.get('.dashboard-automation-when').text()).toMatch(
      new RegExp(`^Every day at 00:00 · Next run .* · ${elsewhere.replace('+', '\\+')} time$`),
    )
  })

  it('puts the switch back when the Worker refuses the change', async () => {
    vi.spyOn(store, 'authHeaders').mockResolvedValue({})
    vi.spyOn(store, 'notify').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    )
    const wrapper = await mountLoaded()
    const box = wrapper.get('.dashboard-switch input')

    await box.setValue(false)
    await flushPromises()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ id: 'automation-1', enabled: false })
    // The automation is still on, and the box says so again.
    expect(store.automations[0].enabled).toBe(true)
    expect(box.element.checked).toBe(true)
    expect(box.element.disabled).toBe(false)
    vi.unstubAllGlobals()
  })

  it('leaves the switch where the person put it once the Worker agrees', async () => {
    vi.spyOn(store, 'authHeaders').mockResolvedValue({})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ automation: { ...AUTOMATION, enabled: false, nextRunAt: null } }),
      })),
    )
    const wrapper = await mountLoaded()
    const box = wrapper.get('.dashboard-switch input')

    await box.setValue(false)
    await flushPromises()

    expect(box.element.checked).toBe(false)
    expect(wrapper.get('.dashboard-automation-when').text()).toBe(
      'Every day at 00:00 · Switched off',
    )
    vi.unstubAllGlobals()
  })

  it('holds an automation’s controls while a change to it is under way', async () => {
    const wrapper = await mountLoaded()
    store.busy = ['automation-1']
    await flushPromises()

    const row = wrapper.get('[data-testid="dashboard-automation"]')
    expect(row.findAll('button').every((button) => button.element.disabled)).toBe(true)
    expect(row.get('input[type="checkbox"]').element.disabled).toBe(true)
  })

  it('deletes an automation only after the person confirms', async () => {
    const remove = vi.spyOn(store, 'remove').mockResolvedValue(true)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true)
    const wrapper = await mountLoaded()
    const button = wrapper.get('button[aria-label="Delete Reschedule Overdue Tasks to Today"]')

    await button.trigger('click')
    expect(remove).not.toHaveBeenCalled()

    await button.trigger('click')
    expect(confirm).toHaveBeenLastCalledWith(
      'Delete “Reschedule Overdue Tasks to Today”? Its activity is deleted with it.',
    )
    expect(remove).toHaveBeenCalledWith('automation-1')
  })

  it('lists what the automations did, newest first, and marks a failure', async () => {
    const failed = { ...RUN, id: 'run-2', status: 'failed', summary: 'The run failed.' }
    const wrapper = await mountLoaded([AUTOMATION], [failed, RUN])
    const runs = wrapper.findAll('[data-testid="dashboard-run"]')

    expect(wrapper.find('.dashboard-empty').exists()).toBe(false)
    expect(runs.map((run) => run.get('.dashboard-run-summary').text())).toEqual([
      'Failed. The run failed.',
      'Moved 2 overdue tasks to today.',
    ])
    expect(runs[0].classes()).toContain('is-failed')
    expect(runs[1].get('time').attributes('datetime')).toBe('2026-11-28T12:00:00.000Z')
  })

  it('offers another go when the automations could not be loaded', async () => {
    const wrapper = mountAt(14)
    await flushPromises()
    store.isLoaded = false
    store.loadFailed = true
    await flushPromises()

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('Could not load your automations.')
    await alert.get('button').trigger('click')
    expect(store.load).toHaveBeenCalledTimes(2)
  })
})

describe('greetingNameOf', () => {
  it('takes the first word of the first claim that holds a real name', () => {
    expect(greetingNameOf({ given_name: 'Allister', name: 'Someone Else' })).toBe('Allister')
    expect(greetingNameOf({ name: 'a@example.com', nickname: ' Ali Baba ' })).toBe('Ali')
    expect(greetingNameOf({ name: 'a@example.com' })).toBe('')
    expect(greetingNameOf(null)).toBe('')
  })
})
