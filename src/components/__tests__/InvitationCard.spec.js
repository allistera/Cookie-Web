import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import InvitationCard from '../InvitationCard.vue'

// The messages Worker's payload, as the inbox view hands it over.
const invitation = (overrides = {}) => ({
  id: 'invitation-1',
  status: 'active',
  current: true,
  title: 'Team sync',
  location: 'Room 4',
  start_at: new Date(2026, 11, 1, 10, 0).toISOString(),
  end_at: new Date(2026, 11, 1, 11, 0).toISOString(),
  all_day: false,
  recurring: true,
  occurrence: false,
  organizer: { name: 'Olive Organiser', address: 'olive@example.com' },
  attendee: 'me@cookie.test',
  sender: 'me@cookie.test',
  can_reply: true,
  reply_blocked: null,
  response: null,
  responded_at: null,
  event: null,
  ...overrides,
})

const mountCard = (props = {}) =>
  mount(InvitationCard, { props: { payload: invitation(), ...props } })

const responseButtons = (wrapper) => wrapper.findAll('.invitation-card-response')
// A button's text includes the icon ligature of a chosen answer's tick.
const labels = (wrapper) =>
  responseButtons(wrapper).map((button) => button.text().replace(/^check\s*/, ''))

describe('InvitationCard', () => {
  it('shows who invited, what to and when, with the three answers', () => {
    const wrapper = mountCard()

    expect(wrapper.attributes('aria-label')).toBe('Calendar invitation')
    expect(wrapper.get('.invitation-card-heading').text()).toBe('Olive Organiser invited you')
    expect(wrapper.get('.invitation-card-title').text()).toBe('Team sync')
    expect(wrapper.get('.invitation-card-details').text()).toBe(
      'Tue 1 Dec 2026, 10:00 to 11:00 · Repeats · Room 4',
    )
    expect(labels(wrapper)).toEqual(['Accept', 'Maybe', 'Decline'])
    expect(responseButtons(wrapper).map((button) => button.attributes('aria-pressed'))).toEqual([
      'false',
      'false',
      'false',
    ])
    expect(wrapper.find('[data-testid="invitation-answer"]').exists()).toBe(false)
  })

  it('asks to answer only when a button is pressed', async () => {
    const wrapper = mountCard()
    expect(wrapper.emitted('respond')).toBeUndefined()

    await responseButtons(wrapper)[1].trigger('click')
    await responseButtons(wrapper)[2].trigger('click')

    expect(wrapper.emitted('respond')).toEqual([['tentative'], ['declined']])
  })

  it('marks the answer on record and says when the organiser was told', () => {
    const wrapper = mountCard({
      payload: invitation({
        response: 'accepted',
        responded_at: new Date(2026, 10, 17, 12, 0).toISOString(),
      }),
    })

    expect(responseButtons(wrapper).map((button) => button.attributes('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
    ])
    expect(wrapper.get('[data-testid="invitation-answer"]').text()).toBe(
      'You accepted. Olive Organiser was told on 17 Nov.',
    )
    expect(wrapper.classes()).toContain('invitation-card-answered')
  })

  it('holds every answer while one is being sent', () => {
    const wrapper = mountCard({ sending: 'declined' })

    expect(labels(wrapper)).toEqual(['Accept', 'Maybe', 'Sending…'])
    expect(responseButtons(wrapper).every((button) => button.element.disabled)).toBe(true)
  })

  it('announces a reply that could not be sent', () => {
    const wrapper = mountCard({ error: 'The reply could not be sent. Try again.' })
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toBe('The reply could not be sent. Try again.')
  })

  it('offers the calendar entry once there is one', async () => {
    const event = { id: 'event-1', date: '2026-12-01' }
    const wrapper = mountCard({ payload: invitation({ response: 'accepted', event }) })

    await wrapper.get('.invitation-card-event').trigger('click')

    expect(wrapper.emitted('open-event')).toEqual([[event]])
    expect(mountCard().find('.invitation-card-event').exists()).toBe(false)
  })

  it('explains an invitation it cannot answer and offers no answers', () => {
    const wrapper = mountCard({
      payload: invitation({
        can_reply: false,
        reply_blocked: 'alias',
        attendee: 'alex@personal.example',
      }),
    })

    expect(responseButtons(wrapper)).toHaveLength(0)
    expect(wrapper.get('[data-testid="invitation-blocked"]').text()).toContain(
      'This invitation was sent to alex@personal.example.',
    )
    expect(wrapper.find('.invitation-card-actions').exists()).toBe(false)
  })

  it('shows a cancelled event as cancelled, whatever was answered before', () => {
    const wrapper = mountCard({
      payload: invitation({
        status: 'cancelled',
        can_reply: false,
        reply_blocked: 'cancelled',
        response: 'accepted',
      }),
    })

    expect(wrapper.get('.invitation-card-heading').text()).toBe(
      'Olive Organiser cancelled this event',
    )
    expect(wrapper.classes()).toContain('invitation-card-cancelled')
    expect(wrapper.classes()).not.toContain('invitation-card-answered')
    expect(responseButtons(wrapper)).toHaveLength(0)
    expect(wrapper.find('[data-testid="invitation-answer"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="invitation-blocked"]').text()).toBe(
      'There is nothing to answer, and it is off your calendar.',
    )
  })

  it('renders nothing for a payload that is not an invitation', () => {
    const wrapper = mountCard({ payload: { id: 'invitation-1', title: 'No times' } })
    expect(wrapper.find('[data-testid="invitation-card"]').exists()).toBe(false)
  })

  it('says when the open message is an earlier version of the invitation', () => {
    const wrapper = mountCard({ payload: invitation({ current: false }) })
    expect(wrapper.text()).toContain(
      'This message has an earlier version of the invitation. The details here are the latest.',
    )
    // The latest details can still be answered from here.
    expect(responseButtons(wrapper)).toHaveLength(3)
  })
})
