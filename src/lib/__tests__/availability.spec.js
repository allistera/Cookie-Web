import { describe, expect, it } from 'vitest'
import { availabilityProposal, suggestAvailability } from '../availability'

const at = (value) => Date.parse(value)
const data = (busy = [], start = '2026-10-24T00:00Z', end = '2026-10-25T00:00Z') => ({
  complete: true,
  busy,
  window: { start: at(start), end: at(end) },
})
const options = { timeZone: 'UTC', duration: 30, workStart: '09:00', workEnd: '11:00' }

describe('availability suggestions', () => {
  it('excludes overlapping busy calendars and treats touching endpoints as free', () => {
    const slots = suggestAvailability(
      data([
        { start: at('2026-10-24T09:00Z'), end: at('2026-10-24T09:45Z') },
        { start: at('2026-10-24T09:30Z'), end: at('2026-10-24T10:00Z') },
      ]),
      options,
      0,
    )
    expect(slots.map((slot) => new Date(slot.start).toISOString())).toEqual([
      '2026-10-24T10:00:00.000Z',
      '2026-10-24T10:30:00.000Z',
    ])
  })

  it('blocks all-day and cross-day conflicts and never returns past proposals', () => {
    expect(
      suggestAvailability(
        data([{ start: at('2026-10-23T23:00Z'), end: at('2026-10-25T00:00Z') }]),
        options,
        0,
      ),
    ).toEqual([])
    const slots = suggestAvailability(
      data([{ start: at('2026-10-23T23:00Z'), end: at('2026-10-24T09:30Z') }]),
      options,
      at('2026-10-24T10:01Z'),
    )
    expect(slots[0].start).toBe(at('2026-10-24T10:15Z'))
  })

  it('uses the proposal timezone for working hours independently of busy instants', () => {
    const slots = suggestAvailability(
      data([{ start: at('2026-10-24T08:00Z'), end: at('2026-10-24T09:00Z') }]),
      { ...options, timeZone: 'Europe/London' },
      0,
    )
    expect(slots[0].start).toBe(at('2026-10-24T09:00Z'))
  })

  it('omits repeated wall times and slots crossing the autumn DST transition', () => {
    const slots = suggestAvailability(
      data([], '2026-10-24T23:00Z', '2026-10-26T00:00Z'),
      { ...options, timeZone: 'Europe/London', workStart: '00:00', workEnd: '04:00' },
      0,
    )
    expect(slots.map((slot) => new Date(slot.start).toISOString())).toEqual([
      '2026-10-24T23:00:00.000Z',
      '2026-10-25T02:00:00.000Z',
      '2026-10-25T02:30:00.000Z',
      '2026-10-25T03:00:00.000Z',
      '2026-10-25T03:30:00.000Z',
    ])
  })

  it('omits the nonexistent spring hour and slots crossing the clock jump', () => {
    const slots = suggestAvailability(
      data([], '2026-03-29T00:00Z', '2026-03-29T23:00Z'),
      { ...options, timeZone: 'Europe/London', workStart: '00:00', workEnd: '04:00' },
      0,
    )
    expect(slots.map((slot) => new Date(slot.start).toISOString())).toEqual([
      '2026-03-29T00:00:00.000Z',
      '2026-03-29T01:00:00.000Z',
      '2026-03-29T01:30:00.000Z',
      '2026-03-29T02:00:00.000Z',
      '2026-03-29T02:30:00.000Z',
    ])
  })

  it('fails closed on incomplete or malformed busy data', () => {
    expect(suggestAvailability({ ...data(), complete: false }, options, 0)).toEqual([])
    expect(suggestAvailability({ ...data(), busy: null }, options, 0)).toEqual([])
    expect(suggestAvailability(data([{ start: 100, end: 1 }]), options, 0)).toEqual([])
  })

  it('inserts only explicit proposals with duration, IANA timezone and offsets', () => {
    const text = availabilityProposal(
      [{ start: at('2026-10-24T08:00Z'), end: at('2026-10-24T08:30Z') }],
      'Europe/London',
      30,
    )
    expect(text).toContain('Proposed meeting times (30 minutes each; timezone: Europe/London)')
    expect(text).toContain('09:00 GMT+1')
    expect(text).toContain('proposals only, not reserved times')
    expect(text).not.toContain('http')
  })
})
