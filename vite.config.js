import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// Serves /api/emails locally, where Vercel's serverless functions don't run.
// E2E mode (and dev without DATABASE_URL) answers from fixtures; otherwise the
// real Vercel handler runs against Postgres.
function localApiPlugin(mode) {
  // Fixture mutations are scoped by a same-origin cookie so separate browser
  // contexts (including parallel Playwright projects) never leak state.
  const stubMailboxState = new Map()
  const fixtureMailboxState = (req, res) => {
    const match = /(?:^|;\s*)cookie_fixture_session=([^;]+)/.exec(req.headers.cookie || '')
    const sessionId = match?.[1] || randomUUID()
    if (!match) {
      res.setHeader('Set-Cookie', `cookie_fixture_session=${sessionId}; Path=/; SameSite=Lax`)
    }
    if (!stubMailboxState.has(sessionId)) {
      stubMailboxState.set(sessionId, {
        schedules: new Map(),
        archived: new Set(),
        summaries: new Map(),
        calendarEvents: null,
        calendars: null,
      })
    }
    return stubMailboxState.get(sessionId)
  }

  const handleEmails = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      const { fixtureEmails, fixtureSentEmails } = await import('./api/_fixtures/emails.js')
      const folder = new URL(req.url, 'http://localhost').searchParams.get('folder') || 'inbox'
      const { schedules, archived, summaries } = fixtureMailboxState(req, res)
      const now = Date.now()
      const inbox = fixtureEmails().map((email) => ({
        ...email,
        scheduled_for: schedules.get(email.id) ?? null,
        has_ai_summary: email.has_ai_summary || summaries.has(email.id),
      }))
      const emails =
        folder === 'sent'
          ? fixtureSentEmails().map((email) => ({
              ...email,
              has_ai_summary: email.has_ai_summary || summaries.has(email.id),
            }))
          : folder === 'done'
            ? inbox.filter((email) => archived.has(email.id))
          : folder === 'spam'
            ? []
          : folder === 'snoozed'
              ? inbox.filter(
                  (email) => !archived.has(email.id) && Date.parse(email.scheduled_for) > now,
                )
              : inbox.filter(
                  (email) =>
                    !archived.has(email.id) &&
                    (!email.scheduled_for || Date.parse(email.scheduled_for) <= now),
                )
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          emails,
          nextCursor: null,
          unreadCount: emails.filter((e) => e.is_unread).length,
          userId: '11111111-1111-4111-8111-111111111111',
          readReceiptsAvailable: folder === 'sent',
        }),
      )
      return
    }
    const { default: handler } = await import('./api/emails.js')
    await handler(req, res)
  }
  const handleSend = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ id: 'e2e-fixture' }))
      return
    }
    const { default: handler } = await import('./api/send.js')
    await handler(req, res)
  }
  const handleReadReceipts = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      const url = new URL(req.url, 'http://localhost')
      if (url.searchParams.has('token')) {
        res.statusCode = 200
        res.setHeader('Content-Type', 'image/gif')
        res.end(Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64'))
        return
      }
      const ids = (url.searchParams.get('messageIds') || '').split(',')
      const firstId = ids.find(Boolean)
      const openedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString()
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          receipts: firstId
            ? [
                {
                  message_id: firstId,
                  first_opened_at: openedAt,
                  last_opened_at: openedAt,
                  open_count: 1,
                },
              ]
            : [],
        }),
      )
      return
    }
    const { default: handler } = await import('./api/read-receipts.js')
    await handler(req, res)
  }
  const handleMessages = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'GET') {
        const { fixtureMessageBody } = await import('./api/_fixtures/messages.js')
        const id = new URL(req.url, 'http://localhost').searchParams.get('id')
        const { summaries } = fixtureMailboxState(req, res)
        res.end(JSON.stringify({ ...fixtureMessageBody(id), summary: summaries.get(id) ?? null }))
        return
      }
      if (req.method === 'POST') {
        let raw = ''
        for await (const chunk of req) raw += chunk
        const body = JSON.parse(raw || '{}')
        if (body.action === 'unsubscribe') {
          res.end(JSON.stringify({ status: 'unsubscribed', method: 'one-click' }))
          return
        }
        if (body.action === 'add_label' || body.action === 'remove_label') {
          const labels = await ensureStubLabels()
          const label = labels.find((l) => l.id === body.label_id)
          const state = fixtureMailboxState(req, res)
          if (!state.messageLabels) state.messageLabels = new Map()
          let current = state.messageLabels.get(body.id)
          if (!current) {
            const { fixtureEmails } = await import('./api/_fixtures/emails.js')
            current = [...(fixtureEmails().find((e) => e.id === body.id)?.labels || [])]
          }
          if (label && body.action === 'add_label' && !current.some((l) => l.name === label.name)) {
            current = [...current, { name: label.name, color: label.color, kind: label.kind }]
          } else if (label && body.action === 'remove_label') {
            current = current.filter((l) => l.name !== label.name)
          }
          current.sort((a, b) => a.name.localeCompare(b.name))
          state.messageLabels.set(body.id, current)
          res.end(JSON.stringify({ labels: current }))
          return
        }
      }
      if (req.method === 'PATCH') {
        let raw = ''
        for await (const chunk of req) raw += chunk
        const body = JSON.parse(raw || '{}')
        if (Object.hasOwn(body, 'scheduled_for')) {
          const { schedules } = fixtureMailboxState(req, res)
          if (body.scheduled_for === null) schedules.delete(body.id)
          else schedules.set(body.id, body.scheduled_for)
        }
        if (Object.hasOwn(body, 'is_archived')) {
          const { archived } = fixtureMailboxState(req, res)
          if (body.is_archived) archived.add(body.id)
          else archived.delete(body.id)
        }
        res.end(JSON.stringify({ message: body }))
        return
      }
      res.end(JSON.stringify({ ok: true }))
      return
    }
    const { default: handler } = await import('./api/messages.js')
    await handler(req, res)
  }
  const handleSearch = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      const { fixtureEmails } = await import('./api/_fixtures/emails.js')
      const q = (new URL(req.url, 'http://localhost').searchParams.get('q') || '').toLowerCase()
      const { summaries } = fixtureMailboxState(req, res)
      const emails = fixtureEmails()
        .filter((email) =>
          [email.subject, email.body_text, email.from_name, email.from_address]
            .join(' ')
            .toLowerCase()
            .includes(q),
        )
        .map((email) => ({
          ...email,
          has_ai_summary: email.has_ai_summary || summaries.has(email.id),
        }))
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ emails }))
      return
    }
    const { default: handler } = await import('./api/search.js')
    await handler(req, res)
  }
  const handleAsk = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          answer:
            'Here is a summary of your Kitchen Renovation updates:\n\n1. **City Construction**: Sent a revised floor plan this morning.\n2. **Insurance Claim**: Your claim has been processed.',
          sources: [
            {
              id: 'fixture-1',
              subject: 'Revised Floor Plan - Natural Light adjustments',
              from_name: 'City Construction',
            },
          ],
        }),
      )
      return
    }
    const { default: handler } = await import('./api/ask.js')
    await handler(req, res)
  }
  const handleCompose = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw || '{}')
      res.setHeader('Content-Type', 'application/json')
      if (body.mode === 'snippet') {
        res.end(JSON.stringify({ snippet: { name: 'hello-world', text: 'Hello world!' } }))
        return
      }
      res.end(
        JSON.stringify({
          draft: { subject: 'AI draft', text: 'A reviewable AI-generated draft.' },
        }),
      )
      return
    }
    const { default: handler } = await import('./api/compose.js')
    await handler(req, res)
  }
  const handleSummarize = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const { id } = JSON.parse(raw || '{}')
      const summary =
        'City Construction shared a revised kitchen floor plan designed to bring in more natural light.\n\n• Review the updated room dimensions and full plan.\n• Reply if any layout changes are needed.'
      const { summaries } = fixtureMailboxState(req, res)
      summaries.set(id, summary)
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          summary,
          messageCount: 1,
          model: 'fixture',
        }),
      )
      return
    }
    const { default: handler } = await import('./api/summarize.js')
    await handler(req, res)
  }
  // Stateful in e2e/no-DB mode so create/delete are visible within a session.
  let stubLabels = null
  const ensureStubLabels = async () => {
    if (!stubLabels) {
      const { fixtureEmails } = await import('./api/_fixtures/emails.js')
      const byName = new Map()
      for (const email of fixtureEmails()) {
        for (const label of email.labels || []) byName.set(label.name, label)
      }
      stubLabels = [...byName.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((label, i) => ({
          id: `stub-label-${i + 1}`,
          name: label.name,
          color: label.color,
          kind: 'user',
          description: null,
          auto_apply: true,
          message_count: 0,
        }))
    }
    return stubLabels
  }
  const handleLabels = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      const labels = await ensureStubLabels()
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'POST') {
        let raw = ''
        for await (const chunk of req) raw += chunk
        const body = JSON.parse(raw || '{}')
        const label = {
          id: `stub-label-${Date.now()}`,
          name: body.name,
          color: body.color,
          kind: 'user',
          description: body.description || null,
          auto_apply: true,
          message_count: 0,
        }
        labels.push(label)
        res.statusCode = 201
        res.end(JSON.stringify({ label }))
        return
      }
      if (req.method === 'DELETE') {
        let raw = ''
        for await (const chunk of req) raw += chunk
        const body = JSON.parse(raw || '{}')
        stubLabels = labels.filter((l) => l.id !== body.id)
        res.end(JSON.stringify({ ok: true }))
        return
      }
      if (req.method === 'PATCH') {
        let raw = ''
        for await (const chunk of req) raw += chunk
        const body = JSON.parse(raw || '{}')
        const label = labels.find((item) => item.id === body.id)
        if (label && Object.hasOwn(body, 'name')) label.name = body.name
        if (label && Object.hasOwn(body, 'auto_apply')) label.auto_apply = body.auto_apply
        res.end(JSON.stringify({ label }))
        return
      }
      res.end(JSON.stringify({ labels }))
      return
    }
    const { default: handler } = await import('./api/labels.js')
    await handler(req, res)
  }
  const handleTasks = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'POST') {
        // Completing a task: pretend the Todoist close + row delete succeeded.
        res.end(JSON.stringify({ ok: true, closedInTodoist: true }))
        return
      }
      res.end(
        JSON.stringify({
          tasks: [
            {
              id: 'stub-task-1',
              source: 'todoist',
              content: 'Renew car insurance',
              description: 'Policy lapses on Friday — compare two quotes first.',
              due_date: null,
              priority: 4,
              url: 'https://app.todoist.com/app/task/stub-task-1',
              message_id: null,
            },
            {
              id: 'stub-task-2',
              source: 'todoist',
              content: 'Book dentist appointment',
              description: 'Six-month check-up for the whole family.',
              due_date: null,
              priority: 2,
              url: 'https://app.todoist.com/app/task/stub-task-2',
              message_id: null,
            },
            {
              id: 'stub-email-task-1',
              source: 'email',
              content: 'Confirm the revised floor plan',
              description: 'Follow up with City Construction before the framing crew is booked.',
              due_date: null,
              priority: 3,
              url: null,
              message_id: 'fixture-1',
              reply_to: 'updates@cityconstruction.com',
              message_subject: 'Revised Floor Plan - Natural Light adjustments',
            },
          ],
        }),
      )
      return
    }
    const { default: handler } = await import('./api/tasks.js')
    await handler(req, res)
  }
  const handleCalendarEvents = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      const state = fixtureMailboxState(req, res)
      if (!state.calendarEvents) {
        const { fixtureCalendarEvents } = await import('./api/_fixtures/calendarEvents.js')
        state.calendarEvents = fixtureCalendarEvents()
      }
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'GET') {
        res.end(JSON.stringify({ events: state.calendarEvents }))
        return
      }
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw || '{}')
      if (req.method === 'POST') {
        const event = { id: `stub-event-${randomUUID()}`, ...body }
        state.calendarEvents.push(event)
        res.statusCode = 201
        res.end(JSON.stringify({ event }))
        return
      }
      if (req.method === 'PATCH') {
        const index = state.calendarEvents.findIndex((event) => event.id === body.id)
        if (index === -1) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Event not found' }))
          return
        }
        state.calendarEvents[index] = { ...state.calendarEvents[index], ...body }
        res.end(JSON.stringify({ event: state.calendarEvents[index] }))
        return
      }
      if (req.method === 'DELETE') {
        const before = state.calendarEvents.length
        state.calendarEvents = state.calendarEvents.filter((event) => event.id !== body.id)
        if (state.calendarEvents.length === before) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Event not found' }))
          return
        }
        res.end(JSON.stringify({ ok: true }))
        return
      }
      res.statusCode = 405
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }
    const { default: handler } = await import('./api/calendar-events.js')
    await handler(req, res)
  }
  const handleCalendars = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      const state = fixtureMailboxState(req, res)
      if (!state.calendars) {
        const { fixtureCalendars } = await import('./api/_fixtures/calendars.js')
        state.calendars = fixtureCalendars()
      }
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'GET') {
        res.end(JSON.stringify({ calendars: state.calendars }))
        return
      }
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw || '{}')
      if (req.method === 'POST') {
        if (state.calendars.some((calendar) => calendar.name === body.name)) {
          res.statusCode = 409
          res.end(JSON.stringify({ error: 'A calendar with that name already exists' }))
          return
        }
        const calendar = { id: `stub-calendar-${randomUUID()}`, name: body.name, color: body.color }
        state.calendars.push(calendar)
        res.statusCode = 201
        res.end(JSON.stringify({ calendar }))
        return
      }
      if (req.method === 'PATCH') {
        const index = state.calendars.findIndex((calendar) => calendar.id === body.id)
        if (index === -1) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Calendar not found' }))
          return
        }
        if (state.calendars.some((calendar) => calendar.id !== body.id && calendar.name === body.name)) {
          res.statusCode = 409
          res.end(JSON.stringify({ error: 'A calendar with that name already exists' }))
          return
        }
        state.calendars[index] = { ...state.calendars[index], name: body.name }
        res.end(JSON.stringify({ calendar: state.calendars[index] }))
        return
      }
      if (req.method === 'DELETE') {
        if (!state.calendarEvents) {
          const { fixtureCalendarEvents } = await import('./api/_fixtures/calendarEvents.js')
          state.calendarEvents = fixtureCalendarEvents()
        }
        const eventCount = state.calendarEvents.filter((event) => event.calendar === body.id).length
        if (eventCount > 0) {
          res.statusCode = 409
          res.end(
            JSON.stringify({
              error: `This calendar has ${eventCount} event${eventCount === 1 ? '' : 's'}. Delete or move them first.`,
            }),
          )
          return
        }
        const before = state.calendars.length
        state.calendars = state.calendars.filter((calendar) => calendar.id !== body.id)
        if (state.calendars.length === before) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Calendar not found' }))
          return
        }
        res.end(JSON.stringify({ ok: true }))
        return
      }
      res.statusCode = 405
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }
    const { default: handler } = await import('./api/calendars.js')
    await handler(req, res)
  }
  const mount = (server) => {
    server.middlewares.use('/api/read-receipts', handleReadReceipts)
    server.middlewares.use('/api/tasks', handleTasks)
    server.middlewares.use('/api/calendar-events', handleCalendarEvents)
    server.middlewares.use('/api/calendars', handleCalendars)
    server.middlewares.use('/api/emails', handleEmails)
    server.middlewares.use('/api/send', handleSend)
    server.middlewares.use('/api/messages', handleMessages)
    server.middlewares.use('/api/search', handleSearch)
    server.middlewares.use('/api/ask', handleAsk)
    server.middlewares.use('/api/compose', handleCompose)
    server.middlewares.use('/api/summarize', handleSummarize)
    server.middlewares.use('/api/labels', handleLabels)
  }
  return {
    name: 'local-api',
    configureServer: mount,
    configurePreviewServer: mount,
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Expose .env values (DATABASE_URL) to the local API middleware.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))

  return {
    plugins: [
      vue(),
      vueDevTools(),
      localApiPlugin(mode),
    ],
    server: {
      port: 5180
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})
