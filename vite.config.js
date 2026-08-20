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
        messageLabels: new Map(),
        calendarEvents: null,
        calendars: null,
        labels: null,
        rules: [],
        scheduledSends: [],
      })
    }
    return stubMailboxState.get(sessionId)
  }

  const handleEmails = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      const { fixtureEmails, fixtureSentEmails } = await import('./api/_fixtures/emails.js')
      const url = new URL(req.url, 'http://localhost')
      const folder = url.searchParams.get('folder') || 'inbox'
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
      if (url.searchParams.get('resource') === 'state') {
        res.end(
          JSON.stringify({
            unreadCount: inbox.filter((email) => email.is_unread).length,
            userId: '11111111-1111-4111-8111-111111111111',
          }),
        )
        return
      }
      const list = emails.map(({ body_text: _bodyText, ...email }) => email)
      res.end(
        JSON.stringify({
          emails: list,
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
  // Mirrors api/send.js's three concerns: an immediate send (default),
  // resource=scheduled (list/cancel a "Send Later" queue), and resource=flush
  // (what the Cookie-Worker cron calls) — all against the per-session
  // fixture state instead of Postgres/Resend.
  const handleSend = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      const resource = new URL(req.url, 'http://localhost').searchParams.get('resource')
      const state = fixtureMailboxState(req, res)
      res.setHeader('Content-Type', 'application/json')

      if (resource === 'scheduled') {
        if (req.method === 'GET') {
          res.end(
            JSON.stringify({
              scheduledSends: state.scheduledSends.filter((item) => item.status === 'pending'),
            }),
          )
          return
        }
        if (req.method === 'DELETE') {
          let raw = ''
          for await (const chunk of req) raw += chunk
          const body = JSON.parse(raw || '{}')
          const index = state.scheduledSends.findIndex(
            (item) => item.id === body.id && item.status === 'pending',
          )
          if (index === -1) {
            res.statusCode = 404
            res.end(JSON.stringify({ error: 'Scheduled send not found or already sent' }))
            return
          }
          const [scheduledSend] = state.scheduledSends.splice(index, 1)
          res.end(JSON.stringify({ scheduledSend }))
          return
        }
        res.statusCode = 405
        res.end(JSON.stringify({ error: 'Method not allowed' }))
        return
      }

      if (resource === 'flush') {
        const now = Date.now()
        let sent = 0
        for (const item of state.scheduledSends) {
          if (item.status === 'pending' && Date.parse(item.scheduledFor) <= now) {
            item.status = 'sent'
            sent += 1
          }
        }
        res.end(JSON.stringify({ claimed: sent, sent, retried: 0, failed: 0 }))
        return
      }

      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw || '{}')
      if (body.sendAt) {
        const scheduledSend = {
          id: `stub-scheduled-${randomUUID()}`,
          toAddresses: body.to,
          subject: body.subject,
          text: body.text,
          html: body.html ?? null,
          replyToMessageId: body.replyToMessageId ?? null,
          scheduledFor: body.sendAt,
          status: 'pending',
        }
        state.scheduledSends.push(scheduledSend)
        res.statusCode = 201
        res.end(JSON.stringify({ scheduledSend }))
        return
      }

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
  const handleSearch = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      const { fixtureEmails, fixtureSentEmails } = await import('./api/_fixtures/emails.js')
      const { parseSearchQuery } = await import('./api/_lib/query-parse.js')
      const rawQuery = new URL(req.url, 'http://localhost').searchParams.get('q') || ''
      const { text, filters } = parseSearchQuery(rawQuery)
      const terms = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []
      const { summaries, archived, schedules } = fixtureMailboxState(req, res)
      const now = Date.now()
      // Mirrors api/_lib/retrieval.js: `in:` scopes results to one folder, and
      // without it a search covers everything except Done (sent copies
      // included). No fixture mail is classified as spam.
      const inFolder = (email) => {
        const scheduledFor = schedules.get(email.id)
        const snoozed = Boolean(scheduledFor) && Date.parse(scheduledFor) > now
        if (filters.in === 'all') return true
        if (filters.in === 'done') return archived.has(email.id)
        if (filters.in === 'sent') return Boolean(email.is_sent)
        if (filters.in === 'spam') return false
        if (filters.in === 'snoozed') return !archived.has(email.id) && snoozed
        if (filters.in === 'inbox') {
          return !archived.has(email.id) && !email.is_sent && !snoozed
        }
        return !archived.has(email.id)
      }
      const emails = [...fixtureEmails(), ...fixtureSentEmails()]
        .filter((email) => {
          if (!inFolder(email)) return false
          const sender = [email.from_name, email.from_address].join(' ').toLowerCase()
          const haystack = [sender, email.subject, email.body_text].join(' ').toLowerCase()
          if (!terms.every((term) => haystack.includes(term))) return false
          if (filters.from && !sender.includes(filters.from.toLowerCase())) return false
          if (
            filters.to &&
            !JSON.stringify(email.recipients || {})
              .toLowerCase()
              .includes(filters.to.toLowerCase())
          ) {
            return false
          }
          if (
            filters.tag &&
            !email.labels.some((label) =>
              label.name.toLowerCase().includes(filters.tag.toLowerCase()),
            )
          ) {
            return false
          }
          if (filters.hasAttachment && !email.has_attachments) return false
          if (filters.before && email.sent_at >= `${filters.before}T00:00:00.000Z`) return false
          if (filters.after && email.sent_at < `${filters.after}T00:00:00.000Z`) return false
          return true
        })
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
  const ensureCalendarEvents = async (state) => {
    if (!state.calendarEvents) {
      const { fixtureCalendarEvents } = await import('./api/_fixtures/calendarEvents.js')
      state.calendarEvents = fixtureCalendarEvents()
    }
    return state
  }
  // Subscription sync makes a real outbound ICS fetch in production; the
  // fixture stubs it out with one fake synced event, replacing whatever that
  // calendar already held, so the UI can be exercised offline and
  // deterministically.
  const stubSubscriptionSync = async (state, calendar) => {
    const { fixtureSubscribedEvent } = await import('./api/_fixtures/calendarEvents.js')
    await ensureCalendarEvents(state)
    state.calendarEvents = [
      ...state.calendarEvents.filter((event) => event.calendar !== calendar.id),
      fixtureSubscribedEvent(calendar.id),
    ]
    calendar.subscriptionSyncedAt = new Date().toISOString()
    calendar.subscriptionError = null
  }
  const handleCalendarEvents = async (req, res) => {
    const resource = new URL(req.url, 'http://localhost').searchParams.get('resource')
    if (resource === 'calendars') {
      await handleCalendars(req, res)
      return
    }
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      const { expandEvents, buildRecurrenceRule } = await import('./api/calendar-events.js')
      const state = await ensureCalendarEvents(fixtureMailboxState(req, res))
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'GET') {
        res.end(JSON.stringify({ events: expandEvents(state.calendarEvents) }))
        return
      }
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw || '{}')
      // Mirrors api/calendar-events.js: the wire format sends
      // repeat/repeatUntil/repeatDays, the stored/expanded shape uses recurrenceRule.
      const { repeat, repeatUntil, repeatDays, ...rest } = body
      if (req.method === 'POST') {
        const event = {
          id: `stub-event-${randomUUID()}`,
          ...rest,
          recurrenceRule: buildRecurrenceRule(repeat ?? 'none', repeatUntil, repeatDays),
        }
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
        state.calendarEvents[index] = {
          ...state.calendarEvents[index],
          ...rest,
          recurrenceRule: buildRecurrenceRule(repeat ?? 'none', repeatUntil, repeatDays),
        }
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
      if (req.method === 'POST' && body.action === 'sync') {
        const calendar = state.calendars.find((item) => item.id === body.id)
        if (!calendar?.subscriptionUrl) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Subscribed calendar not found' }))
          return
        }
        await stubSubscriptionSync(state, calendar)
        res.end(
          JSON.stringify({
            ok: true,
            subscriptionSyncedAt: calendar.subscriptionSyncedAt,
            subscriptionError: null,
          }),
        )
        return
      }
      if (req.method === 'POST') {
        if (state.calendars.some((calendar) => calendar.name === body.name)) {
          res.statusCode = 409
          res.end(JSON.stringify({ error: 'A calendar with that name already exists' }))
          return
        }
        const calendar = { id: `stub-calendar-${randomUUID()}`, name: body.name, color: body.color }
        if (body.subscriptionUrl) {
          calendar.subscriptionUrl = body.subscriptionUrl
          await stubSubscriptionSync(state, calendar)
        }
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
        if (
          state.calendars.some((calendar) => calendar.id !== body.id && calendar.name === body.name)
        ) {
          res.statusCode = 409
          res.end(JSON.stringify({ error: 'A calendar with that name already exists' }))
          return
        }
        state.calendars[index] = { ...state.calendars[index], name: body.name }
        res.end(JSON.stringify({ calendar: state.calendars[index] }))
        return
      }
      if (req.method === 'DELETE') {
        const target = state.calendars.find((calendar) => calendar.id === body.id)
        if (!target) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Calendar not found' }))
          return
        }
        await ensureCalendarEvents(state)
        const eventCount = state.calendarEvents.filter((event) => event.calendar === body.id).length
        if (eventCount > 0 && !target.subscriptionUrl) {
          res.statusCode = 409
          res.end(
            JSON.stringify({
              error: `This calendar has ${eventCount} event${eventCount === 1 ? '' : 's'}. Delete or move them first.`,
            }),
          )
          return
        }
        state.calendarEvents = state.calendarEvents.filter((event) => event.calendar !== body.id)
        state.calendars = state.calendars.filter((calendar) => calendar.id !== body.id)
        res.end(JSON.stringify({ ok: true }))
        return
      }
      res.statusCode = 405
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }
    const { default: handler } = await import('./api/_lib/calendars.js')
    await handler(req, res)
  }
  const mount = (server) => {
    server.middlewares.use('/api/read-receipts', handleReadReceipts)
    server.middlewares.use('/api/calendar-events', handleCalendarEvents)
    server.middlewares.use('/api/emails', handleEmails)
    server.middlewares.use('/api/send', handleSend)
    server.middlewares.use('/api/search', handleSearch)
    server.middlewares.use('/api/ask', handleAsk)
    server.middlewares.use('/api/compose', handleCompose)
    server.middlewares.use('/api/summarize', handleSummarize)
  }
  return {
    name: 'local-api',
    configureServer: mount,
    configurePreviewServer: mount,
  }
}

// Guards the main entry chunk against silently absorbing a heavy dependency.
// Every genuinely heavy dependency here (Excalidraw+React, Editor.js,
// mermaid) already lives behind a dynamic import() route/component boundary,
// so the entry chunk should stay small; Vite's default chunkSizeWarningLimit
// doesn't single that chunk out, and would just as happily warn on the
// (legitimate, already-deferred) multi-hundred-KB Excalidraw chunks.
const ENTRY_CHUNK_BUDGET_BYTES = 150_000

function entryChunkBudgetPlugin() {
  return {
    name: 'entry-chunk-budget',
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.isEntry) continue
        const size = Buffer.byteLength(chunk.code)
        if (size > ENTRY_CHUNK_BUDGET_BYTES) {
          this.error(
            `Entry chunk ${chunk.fileName} is ${size} bytes, over the ${ENTRY_CHUNK_BUDGET_BYTES}-byte budget. ` +
              'A new static import likely pulled a heavy dependency into the main bundle — ' +
              'import it behind a route or component boundary instead.',
          )
        }
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Expose .env values (DATABASE_URL) to the local API middleware.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))

  return {
    plugins: [vue(), vueDevTools(), localApiPlugin(mode), entryChunkBudgetPlugin()],
    server: {
      port: 5180,
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})
