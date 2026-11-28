import { AUTH0_INJECTION_KEY } from '@auth0/auth0-vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import AutomationsDashboard from '../AutomationsDashboard.vue'
import { greetingNameOf } from '../../lib/greetingName'

// Local time, as the page reads it: a Saturday afternoon unless told otherwise.
function mountAt(hour, user = { name: 'Allister Antosik' }) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 28, hour, 30))
  return mount(AutomationsDashboard, {
    global: { provide: { [AUTH0_INJECTION_KEY]: { user: ref(user) } } },
  })
}

describe('AutomationsDashboard', () => {
  afterEach(() => vi.useRealTimers())

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

describe('greetingNameOf', () => {
  it('takes the first word of the first claim that holds a real name', () => {
    expect(greetingNameOf({ given_name: 'Allister', name: 'Someone Else' })).toBe('Allister')
    expect(greetingNameOf({ name: 'a@example.com', nickname: ' Ali Baba ' })).toBe('Ali')
    expect(greetingNameOf({ name: 'a@example.com' })).toBe('')
    expect(greetingNameOf(null)).toBe('')
  })
})
