import { describe, expect, it } from 'vitest'

import {
  AUTOMATION_JOBS,
  SCHEDULE_DAYS,
  automationJob,
  automationWhen,
  formatMoment,
  localTimeZone,
  scheduleLabel,
  scheduleTrigger,
} from '../automationJobs'
import { TEMPLATE_GROUPS } from '../automationTemplates'
import { MATERIAL_SYMBOL_NAMES } from '../iconFont'

const ALL_DAYS = SCHEDULE_DAYS.map((day) => day.id)

describe('automation jobs', () => {
  it('gives every job a handler of its own, an icon the font carries and a usable time', () => {
    const handlers = AUTOMATION_JOBS.map((job) => job.handler)

    expect(new Set(handlers).size).toBe(handlers.length)
    for (const job of AUTOMATION_JOBS) {
      expect(MATERIAL_SYMBOL_NAMES).toContain(job.icon)
      expect(job.defaultTime).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
    }
  })

  it('finds a job by its handler and nothing for anything else', () => {
    expect(automationJob('reschedule_overdue').title).toBe('Reschedule Overdue Tasks to Today')
    expect(automationJob('send_everything')).toBeNull()
    expect(automationJob(undefined)).toBeNull()
  })

  it('backs every template that says it can be set up', () => {
    const jobs = TEMPLATE_GROUPS.flatMap((group) => group.templates)
      .map((template) => template.job)
      .filter(Boolean)

    expect(jobs).toEqual(['reschedule_overdue'])
    for (const handler of jobs) expect(automationJob(handler)).not.toBeNull()
  })
})

describe('scheduleTrigger', () => {
  it('writes the Worker’s trigger with the days in week order', () => {
    expect(
      scheduleTrigger({ time: '07:30', days: ['fri', 'mon'], timeZone: 'Europe/London' }),
    ).toEqual({ type: 'schedule', time: '07:30', days: ['mon', 'fri'], timeZone: 'Europe/London' })
  })

  it('keeps time in the person’s own zone unless given another', () => {
    expect(scheduleTrigger({ time: '00:00', days: ALL_DAYS }).timeZone).toBe(localTimeZone())
    expect(localTimeZone()).not.toBe('')
  })
})

describe('scheduleLabel', () => {
  it.each([
    [ALL_DAYS, 'Every day at 00:00'],
    [['mon', 'tue', 'wed', 'thu', 'fri'], 'Weekdays at 00:00'],
    [['sun', 'sat'], 'Weekends at 00:00'],
    [['wed', 'mon'], 'Mon, Wed at 00:00'],
    [['sat'], 'Sat at 00:00'],
  ])('reads %j as %s', (days, label) => {
    expect(scheduleLabel({ time: '00:00', days })).toBe(label)
  })
})

describe('formatMoment', () => {
  it('writes a day and a 24-hour time', () => {
    // Midday UTC is the same calendar day in every zone the suite runs in.
    expect(formatMoment('2026-11-29T12:00:00Z')).toMatch(/^Sun,? 29 Nov,? \d\d:\d\d$/)
  })

  it('writes nothing for a missing or unreadable time', () => {
    expect(formatMoment(null)).toBe('')
    expect(formatMoment('soon')).toBe('')
  })

  it('writes the time in the zone it is given', () => {
    const midnightInLondon = '2026-11-29T00:00:00Z'

    expect(formatMoment(midnightInLondon, 'Europe/London')).toMatch(/^Sun,? 29 Nov,? 00:00$/)
    expect(formatMoment(midnightInLondon, 'America/New_York')).toMatch(/^Sat,? 28 Nov,? 19:00$/)
  })

  it('falls back to the person’s own zone for one the browser does not know', () => {
    expect(formatMoment('2026-11-29T12:00:00Z', 'Mars/Olympus')).toBe(
      formatMoment('2026-11-29T12:00:00Z'),
    )
  })
})

describe('automationWhen', () => {
  const automation = {
    enabled: true,
    nextRunAt: '2026-11-29T00:00:00Z',
    trigger: { type: 'schedule', time: '00:00', days: ALL_DAYS, timeZone: 'Europe/London' },
  }

  it('gives the schedule and the next run for someone in the schedule’s zone', () => {
    expect(automationWhen(automation, 'Europe/London')).toMatch(
      /^Every day at 00:00 · Next run Sun,? 29 Nov,? 00:00$/,
    )
  })

  it('keeps both times in the schedule’s zone, and names it, for someone elsewhere', () => {
    // In New York the next run is 19:00 on Saturday. Written that way beside
    // "at 00:00" the line would contradict itself.
    expect(automationWhen(automation, 'America/New_York')).toMatch(
      /^Every day at 00:00 · Next run Sun,? 29 Nov,? 00:00 · Europe\/London time$/,
    )
  })

  it('says an automation is switched off instead of naming a next run', () => {
    const off = { ...automation, enabled: false, nextRunAt: null }

    expect(automationWhen(off, 'Europe/London')).toBe('Every day at 00:00 · Switched off')
    expect(automationWhen(off, 'Asia/Tokyo')).toBe(
      'Every day at 00:00 · Switched off · Europe/London time',
    )
  })
})
