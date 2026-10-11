import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  emailCalendarEventRange,
  findEmailCalendarEvent,
  rememberEmailCalendarEvent,
  rememberedEmailCalendarEvent,
  relinkEmailCalendarEvent,
} from '../emailCalendarEvents'

const STORAGE_KEY = 'cookie.emailCalendarEvents'

const suggestion = {
  title: 'Guided tour',
  date: '2099-08-12',
  start: '10:00',
  end: '11:00',
  description: '',
  location: '',
}

const event = (overrides = {}) => ({
  id: 'tour',
  title: 'Guided tour',
  date: '2099-08-12',
  start: '10:00',
  duration: 60,
  calendar: 'personal',
  ...overrides,
})

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('remembered links', () => {
  it('round-trips a link per message, the newest save winning', () => {
    expect(rememberedEmailCalendarEvent('msg-1')).toBeNull()
    rememberEmailCalendarEvent('msg-1', { id: 'tour', date: '2099-08-12' })
    expect(rememberedEmailCalendarEvent('msg-1')).toEqual({ id: 'tour', date: '2099-08-12' })
    rememberEmailCalendarEvent('msg-1', { id: 'tour-2', date: '2099-08-13' })
    expect(rememberedEmailCalendarEvent('msg-1')).toEqual({ id: 'tour-2', date: '2099-08-13' })
    expect(rememberedEmailCalendarEvent('msg-2')).toBeNull()
  })

  it('ignores malformed links and corrupt storage', () => {
    rememberEmailCalendarEvent('msg-1', { id: '', date: '2099-08-12' })
    rememberEmailCalendarEvent('msg-2', { id: 'tour', date: 'next week' })
    rememberEmailCalendarEvent('', { id: 'tour', date: '2099-08-12' })
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()

    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(rememberedEmailCalendarEvent('msg-1')).toBeNull()
    rememberEmailCalendarEvent('msg-1', { id: 'tour', date: '2099-08-12' })
    expect(rememberedEmailCalendarEvent('msg-1')).toEqual({ id: 'tour', date: '2099-08-12' })

    localStorage.setItem(STORAGE_KEY, JSON.stringify([1, 2, ['msg-1', { id: 'tour' }]]))
    expect(rememberedEmailCalendarEvent('msg-1')).toBeNull()
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'msg-1': { id: 'tour', date: '2099-08-12' } }),
    )
    expect(rememberedEmailCalendarEvent('msg-1')).toBeNull()
  })

  it('follows a linked event to the day it was moved to', () => {
    rememberEmailCalendarEvent('msg-1', { id: 'tour', date: '2099-08-12' })
    rememberEmailCalendarEvent('msg-2', { id: 'other', date: '2099-08-12' })
    relinkEmailCalendarEvent('tour', '2099-08-14')
    expect(rememberedEmailCalendarEvent('msg-1')).toEqual({ id: 'tour', date: '2099-08-14' })
    expect(rememberedEmailCalendarEvent('msg-2')).toEqual({ id: 'other', date: '2099-08-12' })

    // Unknown ids and malformed dates change nothing.
    const before = localStorage.getItem(STORAGE_KEY)
    relinkEmailCalendarEvent('missing', '2099-08-15')
    relinkEmailCalendarEvent('tour', 'tomorrow')
    relinkEmailCalendarEvent('', '2099-08-15')
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
  })

  it('keeps only the newest 200 links', () => {
    for (let index = 0; index < 205; index += 1) {
      rememberEmailCalendarEvent(`msg-${index}`, { id: `event-${index}`, date: '2099-08-12' })
    }
    expect(rememberedEmailCalendarEvent('msg-0')).toBeNull()
    expect(rememberedEmailCalendarEvent('msg-4')).toBeNull()
    expect(rememberedEmailCalendarEvent('msg-5')).toEqual({ id: 'event-5', date: '2099-08-12' })
    expect(rememberedEmailCalendarEvent('msg-204')).toEqual({
      id: 'event-204',
      date: '2099-08-12',
    })
  })
})

describe('emailCalendarEventRange', () => {
  it('covers the suggested day, widened to a remembered day when they differ', () => {
    expect(emailCalendarEventRange(suggestion, null)).toEqual({
      from: '2099-08-12',
      to: '2099-08-12',
    })
    expect(emailCalendarEventRange(suggestion, { id: 'tour', date: '2099-08-10' })).toEqual({
      from: '2099-08-10',
      to: '2099-08-12',
    })
    expect(emailCalendarEventRange(null, null)).toBeNull()
  })
})

describe('findEmailCalendarEvent', () => {
  it('prefers the remembered event even after it was renamed or moved', () => {
    const moved = event({ id: 'tour', title: 'Campus visit', date: '2099-08-13', start: '09:00' })
    const lookalike = event({ id: 'other' })
    expect(
      findEmailCalendarEvent([lookalike, moved], {
        suggestion,
        remembered: { id: 'tour', date: '2099-08-13' },
      }),
    ).toBe(moved)
  })

  it('finds a recurring series through its occurrence on the remembered day', () => {
    const occurrence = event({ id: 'tour:2099-08-12', seriesId: 'tour', title: 'Weekly tour' })
    expect(
      findEmailCalendarEvent([occurrence], {
        suggestion,
        remembered: { id: 'tour', date: '2099-08-12' },
      }),
    ).toBe(occurrence)
  })

  it('falls back to a content match when the remembered event is gone', () => {
    const match = event({ id: 'recreated' })
    expect(
      findEmailCalendarEvent([match], {
        suggestion,
        remembered: { id: 'tour', date: '2099-08-12' },
      }),
    ).toBe(match)
    expect(findEmailCalendarEvent([event({ start: '11:00' })], { suggestion })).toBeNull()
    expect(findEmailCalendarEvent(undefined, { suggestion })).toBeNull()
  })
})
