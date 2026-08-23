import process from 'node:process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createHandler } from '../calendar-events.js'
import { generateCalendarEventDraft, normalizeCalendarEventDraft } from '../_lib/calendar-ai.js'

const USER_ID = '99999999-9999-9999-9999-999999999999'

function response() {
  return {
    statusCode: 0,
    body: null,
    setHeader: vi.fn(),
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null
    },
  }
}

describe('calendar event AI parsing', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key'
  })

  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_CALENDAR_MODEL
  })

  it('requests strict structured output and normalizes optional fields', async () => {
    process.env.OPENAI_CALENDAR_MODEL = 'test-calendar-model'
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          title: 'Dinner with Sam',
          description: '',
          location: '',
          date: '2026-08-24',
          start: '19:00',
          duration: 120,
          repeat: 'none',
          repeatUntil: '',
          repeatDays: [],
        }),
      }),
    }))

    const result = await generateCalendarEventDraft(
      {
        text: 'Dinner with Sam tomorrow at 7pm for two hours',
        now: '2026-08-23T12:00:00.000Z',
        timeZone: 'Europe/London',
      },
      'test-key',
      fetchImpl,
    )

    expect(result).toEqual({
      model: 'test-calendar-model',
      draft: {
        title: 'Dinner with Sam',
        description: null,
        location: null,
        date: '2026-08-24',
        start: '19:00',
        duration: 120,
        repeat: 'none',
        repeatUntil: null,
        repeatDays: null,
      },
    })
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(request.model).toBe('test-calendar-model')
    expect(request.text.format).toMatchObject({
      type: 'json_schema',
      name: 'calendar_event',
      strict: true,
    })
    expect(request.input[1].content).toContain('Europe/London')
  })

  it('rejects impossible dates and times from the model', () => {
    expect(() =>
      normalizeCalendarEventDraft({
        title: 'Bad event',
        date: '2026-02-30',
        start: '25:00',
        duration: 30,
        repeat: 'none',
        repeatDays: [],
      }),
    ).toThrow('invalid calendar event')
  })

  it('validates text before claiming quota', async () => {
    const allowRequest = vi.fn()
    const calendarEventGenerator = vi.fn()
    const handler = createHandler({
      verifyAccessToken: vi.fn(async () => ({ userId: USER_ID })),
      getSql: vi.fn(() => vi.fn()),
      allowRequest,
      calendarEventGenerator,
    })
    const res = response()

    await handler(
      {
        method: 'POST',
        url: '/api/calendar-events',
        headers: {},
        body: { action: 'interpret', text: '   ', timeZone: 'Europe/London' },
      },
      res,
    )

    expect(res.statusCode).toBe(400)
    expect(allowRequest).not.toHaveBeenCalled()
    expect(calendarEventGenerator).not.toHaveBeenCalled()
  })

  it('returns an authenticated, rate-limited AI event draft', async () => {
    const draft = {
      title: 'Dinner with Sam',
      date: '2026-08-24',
      start: '19:00',
      duration: 120,
      repeat: 'none',
    }
    const allowRequest = vi.fn(async () => true)
    const calendarEventGenerator = vi.fn(async () => ({ draft, model: 'test-model' }))
    const handler = createHandler({
      verifyAccessToken: vi.fn(async () => ({ userId: USER_ID })),
      getSql: vi.fn(() => vi.fn()),
      allowRequest,
      calendarEventGenerator,
      now: () => new Date('2026-08-23T12:00:00.000Z'),
    })
    const res = response()

    await handler(
      {
        method: 'POST',
        url: '/api/calendar-events',
        headers: {},
        body: {
          action: 'interpret',
          text: 'Dinner with Sam tomorrow at 7pm for two hours',
          timeZone: 'Europe/London',
        },
      },
      res,
    )

    expect(allowRequest).toHaveBeenCalledWith(expect.any(Function), USER_ID, 'ai', {
      limit: 10,
      windowMs: 60_000,
    })
    expect(calendarEventGenerator).toHaveBeenCalledWith(
      {
        text: 'Dinner with Sam tomorrow at 7pm for two hours',
        now: '2026-08-23T12:00:00.000Z',
        timeZone: 'Europe/London',
      },
      'test-key',
    )
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ draft, model: 'test-model' })
  })
})
