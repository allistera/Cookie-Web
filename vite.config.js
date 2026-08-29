import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// Mirrors the validation in cookie-web-tasks/src/taskItems.js so the /task-items
// fixture rejects what the real Worker handler rejects. See cleanText/isUuid there.
const TASK_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TASK_MAX_CONTENT_LENGTH = 500

function isTaskUuid(value) {
  return value === String(value ?? '') && TASK_UUID_RE.test(value)
}

// Mirrors isCalendarDate in cookie-web-tasks/src/taskItems.js, so the fixture
// refuses the dates the real Worker refuses.
function isTaskCalendarDate(value) {
  const text = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
}

function cleanTaskText(value, max) {
  if (!(value?.trim instanceof Function)) return null
  const text = value.trim().slice(0, max)
  return text || null
}

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
        stars: new Map(),
        messageLabels: new Map(),
        calendarEvents: null,
        calendars: null,
        labels: null,
        rules: [],
        scheduledSends: [],
        followUps: new Map(),
        projects: [],
        taskItems: [],
      })
    }
    return stubMailboxState.get(sessionId)
  }

  // cookie-web-emails: /emails (folder listing) and /emails/state (unread
  // badge + Realtime identity bootstrap). Fixture-only, like the other
  // migrated Workers — the real handler lives in Cookie-Worker now.
  const handleWorkerEmailsApi = async (req, res) => {
    const { fixtureEmails, fixtureSentEmails } = await import('./api/_fixtures/emails.js')
    const url = new URL(req.url, 'http://localhost')
    const segments = url.pathname.split('/').filter(Boolean)
    const isState = segments.length === 2 && segments[1] === 'state'
    if (segments[0] !== 'emails' || (segments.length > 1 && !isState)) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Not Found' }))
      return
    }
    const folder = url.searchParams.get('folder') || 'inbox'
    const labelName = (url.searchParams.get('label') || '').trim()
    const state = fixtureMailboxState(req, res)
    const { schedules, archived, summaries, stars, messageLabels, followUps } = state
    const now = Date.now()
    // Stars and labels changed through the messages Worker fixture override
    // the static row, so a list reflects what the test just did to it.
    const withState = (email) => ({
      ...email,
      is_starred: stars.get(email.id) ?? email.is_starred,
      labels: messageLabels.get(email.id) ?? email.labels,
      has_ai_summary: email.has_ai_summary || summaries.has(email.id),
      follow_up_at: followUps.get(email.id) ?? email.follow_up_at ?? null,
    })
    const inbox = fixtureEmails().map((email) => ({
      ...withState(email),
      scheduled_for: schedules.get(email.id) ?? null,
    }))
    const sent = fixtureSentEmails().map(withState)
    const byNewest = (rows) =>
      [...rows].sort((a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at))
    // Mirrors api/emails.js's folderPredicate. Starred and label became
    // folders of their own, and both span every non-deleted message —
    // archived and sent rows included — rather than filtering the inbox.
    const selectFolder = () => {
      if (folder === 'sent') return sent
      if (folder === 'done') return inbox.filter((email) => archived.has(email.id))
      if (folder === 'spam') return []
      if (folder === 'starred') {
        return byNewest([...inbox, ...sent].filter((email) => email.is_starred))
      }
      if (folder === 'label') {
        return byNewest(
          [...inbox, ...sent].filter((email) =>
            (email.labels || []).some((label) => label.name === labelName),
          ),
        )
      }
      if (folder === 'snoozed') {
        return inbox.filter(
          (email) => !archived.has(email.id) && Date.parse(email.scheduled_for) > now,
        )
      }
      const dueFollowUps = sent
        .filter((email) => email.follow_up_at && Date.parse(email.follow_up_at) <= now)
        .sort((a, b) => Date.parse(b.follow_up_at) - Date.parse(a.follow_up_at))
      return [
        ...dueFollowUps,
        ...inbox.filter(
          (email) =>
            !archived.has(email.id) &&
            (!email.scheduled_for || Date.parse(email.scheduled_for) <= now),
        ),
      ]
    }
    const emails = selectFolder()
    res.setHeader('Content-Type', 'application/json')
    if (isState) {
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
  }
  // Same-origin adapter for the legacy /api/emails[?resource=state] shape
  // (not-yet-refreshed SPA bundles) — production traffic goes straight to the
  // emails Worker.
  const handleEmails = (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const resource = url.searchParams.get('resource')
    url.searchParams.delete('resource')
    req.url = `/emails${resource === 'state' ? '/state' : ''}${url.search}`
    return handleWorkerEmailsApi(req, res)
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
      if (resource === 'follow-up') {
        if (req.method !== 'PATCH') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }
        const exists = (await import('./api/_fixtures/emails.js'))
          .fixtureSentEmails()
          .some((email) => email.id === body.messageId)
        if (!exists) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Sent message not found' }))
          return
        }
        if (body.followUpAt === null) state.followUps.delete(body.messageId)
        else state.followUps.set(body.messageId, body.followUpAt)
        res.end(
          JSON.stringify({
            message: { id: body.messageId, followUpAt: body.followUpAt },
          }),
        )
        return
      }
      if (body.sendAt) {
        const scheduledSend = {
          id: `stub-scheduled-${randomUUID()}`,
          toAddresses: body.to,
          subject: body.subject,
          text: body.text,
          html: body.html ?? null,
          replyToMessageId: body.replyToMessageId ?? null,
          scheduledFor: body.sendAt,
          followUpAt: body.followUpAt ?? null,
          status: 'pending',
        }
        state.scheduledSends.push(scheduledSend)
        res.statusCode = 201
        res.end(JSON.stringify({ scheduledSend }))
        return
      }

      res.end(
        JSON.stringify({
          id: 'e2e-fixture',
          messageId: `stub-sent-${randomUUID()}`,
          followUpScheduled: body.followUpAt ? true : undefined,
        }),
      )
      return
    }
    const { default: handler } = await import('./api/send.js')
    await handler(req, res)
  }
  // cookie-web-receipts: /read-receipts (?token= pixel | ?messageIds= status).
  // Fixture-only, like the other migrated Workers — the real handler lives in
  // Cookie-Worker now.
  const handleWorkerReceiptsApi = (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname !== '/read-receipts') {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Not Found' }))
      return
    }
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
  }
  // Same-origin adapter for the legacy /api/read-receipts shape (dev-sent
  // pixels and not-yet-refreshed SPA bundles) — production forwards this path
  // to the receipts Worker with a vercel.json redirect instead.
  const handleReadReceipts = (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    req.url = `/read-receipts${url.search}`
    return handleWorkerReceiptsApi(req, res)
  }
  // cookie-web-search fixtures: the real /search and /ask handlers live in
  // Cookie-Worker now; these answer from the shared per-session fixture state.
  const handleSearch = async (req, res) => {
    const { fixtureEmails, fixtureSentEmails } = await import('./api/_fixtures/emails.js')
    const { parseSearchQuery } = await import('./api/_lib/query-parse.js')
    const rawQuery = new URL(req.url, 'http://localhost').searchParams.get('q') || ''
    const { text, filters } = parseSearchQuery(rawQuery)
    const terms = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []
    const { summaries, archived, schedules, followUps } = fixtureMailboxState(req, res)
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
        follow_up_at: followUps.get(email.id) ?? email.follow_up_at ?? null,
      }))
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ emails }))
  }
  const handleAsk = async (req, res) => {
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
  }
  // Worker-origin dispatcher for cookie-web-search (e2e/workerFixtures.js
  // routes search-api.infinitywave.online back here).
  const handleWorkerSearchApi = (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/search') return handleSearch(req, res)
    if (url.pathname === '/ask') return handleAsk(req, res)
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Not Found' }))
  }
  // cookie-web-ai: /compose and /summarize. Fixture-only, like the other
  // migrated Workers — the real handlers live in Cookie-Worker now.
  const handleWorkerAiApi = async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw || '{}')
    res.setHeader('Content-Type', 'application/json')
    if (url.pathname === '/compose') {
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
    if (url.pathname === '/summarize') {
      const summary =
        'City Construction shared a revised kitchen floor plan designed to bring in more natural light.\n\n• Review the updated room dimensions and full plan.\n• Reply if any layout changes are needed.'
      const { summaries } = fixtureMailboxState(req, res)
      summaries.set(body.id, summary)
      res.end(
        JSON.stringify({
          summary,
          messageCount: 1,
          model: 'fixture',
        }),
      )
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Not Found' }))
  }
  // Same-origin adapters for the legacy /api/compose and /api/summarize
  // shapes (not-yet-refreshed SPA bundles) — production traffic goes straight
  // to the AI Worker.
  const handleCompose = (req, res) => {
    req.url = `/compose${new URL(req.url, 'http://localhost').search}`
    return handleWorkerAiApi(req, res)
  }
  const handleSummarize = (req, res) => {
    req.url = `/summarize${new URL(req.url, 'http://localhost').search}`
    return handleWorkerAiApi(req, res)
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
  // cookie-web-calendar fixtures: the real /calendar-events and /calendars
  // handlers live in Cookie-Worker now; these answer from the shared
  // per-session fixture state, expanding recurrence via api/_lib/recurrence.js
  // (the kept copy of the Worker's expansion logic).
  const handleCalendarEvents = async (req, res) => {
    const resource = new URL(req.url, 'http://localhost').searchParams.get('resource')
    if (resource === 'calendars') {
      await handleCalendars(req, res)
      return
    }
    {
      const { expandEvents, buildRecurrenceRule } = await import('./api/_lib/recurrence.js')
      const state = await ensureCalendarEvents(fixtureMailboxState(req, res))
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'GET') {
        res.end(JSON.stringify({ events: expandEvents(state.calendarEvents) }))
        return
      }
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw || '{}')
      if (req.method === 'POST' && body.action === 'interpret') {
        res.end(
          JSON.stringify({
            draft: {
              title: 'Dinner with Sam',
              description: null,
              location: null,
              date: '2026-07-25',
              start: '19:00',
              duration: 120,
              repeat: 'none',
              repeatUntil: null,
              repeatDays: null,
            },
            model: 'fixture',
          }),
        )
        return
      }
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
    }
  }
  const handleCalendars = async (req, res) => {
    {
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
    }
  }
  // Worker-origin dispatcher for cookie-web-calendar (e2e/workerFixtures.js
  // routes calendar-api.infinitywave.online back here).
  const handleWorkerCalendarApi = (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/calendar-events') return handleCalendarEvents(req, res)
    if (url.pathname === '/calendars') return handleCalendars(req, res)
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Not Found' }))
  }
  // --- Cloudflare Worker fixtures (e2e only) -------------------------------
  //
  // The frontend calls cookie-web-tasks/labels/messages/receipts at absolute
  // cross-origin URLs (src/lib/apiWorkers.js), so no same-origin middleware can
  // intercept them and e2e mode has no bearer token to offer — every such
  // request used to reach the real Worker and 401. e2e/workerFixtures.js routes
  // those three origins back here instead, preserving method, path, query and
  // body, so the handlers below can answer from the same per-session
  // fixture state /api/emails and /api/search already share (schedules,
  // archived, summaries, messageLabels). Keeping one state bucket is the point:
  // a label added through the messages Worker has to show up in the next
  // /api/emails list, and a schedule set here has to hide the mail there.
  //
  // Paths mirror each Worker's own router (Cookie-Worker/workers/*/src/worker.js)
  // rather than the old `?resource=` shapes those routers replaced.
  const readBody = async (req) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    return JSON.parse(raw || '{}')
  }
  const json = (res, payload, status = 200) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(payload))
  }

  const ensureStubLabels = async (state) => {
    if (!state.labels) {
      const { fixtureEmails } = await import('./api/_fixtures/emails.js')
      const byName = new Map()
      for (const email of fixtureEmails()) {
        for (const label of email.labels || []) byName.set(label.name, label)
      }
      state.labels = [...byName.values()]
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
    return state.labels
  }

  // GET/POST/PATCH/DELETE /documents — mirrors the wire shape of
  // cookie-web-tasks's documents.js (folders + documents lists without blocks;
  // a single fetch by id carries blocks).
  const handleWorkerDocuments = async (req, res, state, url) => {
    if (!state.documents) {
      const { fixtureDocumentFolders, fixtureDocuments, fixtureDocumentTemplates } =
        await import('./api/_fixtures/documents.js')
      state.docFolders = fixtureDocumentFolders()
      state.documents = fixtureDocuments()
      state.docTemplates = fixtureDocumentTemplates()
    }
    const stripBlocks = ({ blocks: _blocks, ...doc }) => doc
    if (req.method === 'GET') {
      const rawQuery = url.searchParams.get('q')
      if (rawQuery && rawQuery.trim()) {
        // A simplified stand-in for the Worker's hybrid (keyword+semantic)
        // search — full-text substring matching over title+blocks rather than
        // tsvector/pgvector, the same fidelity level as handleSearch's email
        // fixture. Good enough for e2e, not a ranking model.
        const { parseDocumentSearchQuery } = await import('./api/_lib/query-parse.js')
        const { text, filters } = parseDocumentSearchQuery(rawQuery.trim())
        const terms = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []
        const documents = state.documents
          .filter((doc) => {
            const haystack = `${doc.title} ${JSON.stringify(doc.blocks)}`.toLowerCase()
            if (!terms.every((term) => haystack.includes(term))) return false
            if (
              filters.tag &&
              !doc.tags?.some((tag) => tag.toLowerCase() === filters.tag.toLowerCase())
            ) {
              return false
            }
            if (filters.starred && !doc.starred) return false
            return true
          })
          .map(stripBlocks)
        json(res, { documents })
        return
      }
      const templateId = url.searchParams.get('templateId')
      if (templateId) {
        const template = state.docTemplates.find((item) => item.id === templateId)
        if (!template) return json(res, { error: 'Template not found' }, 404)
        return json(res, { template })
      }
      if (url.searchParams.has('templates')) {
        return json(res, { templates: state.docTemplates.map(stripBlocks) })
      }
      const id = url.searchParams.get('id')
      if (id) {
        const document = state.documents.find((doc) => doc.id === id)
        if (!document) return json(res, { error: 'Document not found' }, 404)
        return json(res, { document })
      }
      return json(res, {
        folders: state.docFolders,
        documents: state.documents.map(stripBlocks),
      })
    }
    const body = await readBody(req)
    const now = () => new Date().toISOString()
    if (req.method === 'POST') {
      if (body.kind === 'folder') {
        const folder = {
          id: `stub-folder-${randomUUID()}`,
          parent_id: body.parentId ?? null,
          title: body.title,
          emoji: body.emoji || '📁',
          created_at: now(),
        }
        state.docFolders.push(folder)
        return json(res, { folder }, 201)
      }
      if (body.kind === 'template') {
        const template = {
          id: `stub-template-${randomUUID()}`,
          title: body.title,
          emoji: body.emoji || '📄',
          blocks: structuredClone(body.blocks || []),
          created_at: now(),
          updated_at: now(),
        }
        state.docTemplates.unshift(template)
        return json(res, { template }, 201)
      }
      const template = body.templateId
        ? state.docTemplates.find((item) => item.id === body.templateId)
        : null
      if (body.templateId && !template) return json(res, { error: 'Template not found' }, 400)
      const document = {
        id: `stub-doc-${randomUUID()}`,
        folder_id: body.folderId ?? null,
        title: Object.hasOwn(body, 'title') ? body.title : (template?.title ?? ''),
        emoji: template?.emoji ?? '🔹',
        starred: false,
        tags: [],
        blocks: structuredClone(template?.blocks ?? []),
        created_at: now(),
        updated_at: now(),
      }
      state.documents.unshift(document)
      return json(res, { document }, 201)
    }
    if (req.method === 'PATCH') {
      if (body.kind === 'folder') {
        const folder = state.docFolders.find((item) => item.id === body.id)
        if (!folder) return json(res, { error: 'Folder not found' }, 404)
        folder.title = body.title
        return json(res, { folder })
      }
      if (body.kind === 'template') {
        const template = state.docTemplates.find((item) => item.id === body.id)
        if (!template) return json(res, { error: 'Template not found' }, 404)
        template.title = body.title
        template.blocks = structuredClone(body.blocks)
        template.updated_at = now()
        return json(res, { template })
      }
      const document = state.documents.find((item) => item.id === body.id)
      if (!document) return json(res, { error: 'Document not found' }, 404)
      if (Object.hasOwn(body, 'title')) document.title = body.title
      if (Object.hasOwn(body, 'emoji')) document.emoji = body.emoji
      if (Object.hasOwn(body, 'starred')) document.starred = body.starred
      if (Object.hasOwn(body, 'folderId')) document.folder_id = body.folderId
      if (Object.hasOwn(body, 'blocks')) document.blocks = body.blocks
      if (Object.hasOwn(body, 'tags')) document.tags = [...new Set(body.tags)]
      document.updated_at = now()
      return json(res, { document: stripBlocks(document) })
    }
    if (req.method === 'DELETE') {
      if (body.kind === 'folder') {
        // Mirrors the schema: sub-folders cascade, their documents fall back
        // to the root.
        const doomed = new Set([body.id])
        let grew = true
        while (grew) {
          grew = false
          for (const folder of state.docFolders) {
            if (folder.parent_id && doomed.has(folder.parent_id) && !doomed.has(folder.id)) {
              doomed.add(folder.id)
              grew = true
            }
          }
        }
        if (!state.docFolders.some((folder) => folder.id === body.id)) {
          return json(res, { error: 'Folder not found' }, 404)
        }
        state.docFolders = state.docFolders.filter((folder) => !doomed.has(folder.id))
        for (const doc of state.documents) {
          if (doomed.has(doc.folder_id)) doc.folder_id = null
        }
        return json(res, { ok: true })
      }
      if (body.kind === 'template') {
        const before = state.docTemplates.length
        state.docTemplates = state.docTemplates.filter((template) => template.id !== body.id)
        if (state.docTemplates.length === before) {
          return json(res, { error: 'Template not found' }, 404)
        }
        return json(res, { ok: true })
      }
      const before = state.documents.length
      state.documents = state.documents.filter((doc) => doc.id !== body.id)
      if (state.documents.length === before) return json(res, { error: 'Document not found' }, 404)
      return json(res, { ok: true })
    }
    return json(res, { error: 'Method not allowed' }, 405)
  }

  // Held three hours back so AI Today's staleness line is deterministic.
  const fixtureTasksPayload = () => {
    const gatheredAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    return {
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
          gathered_at: gatheredAt,
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
          gathered_at: gatheredAt,
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
          gathered_at: gatheredAt,
        },
      ],
      digest: {
        overview: 'Two messages need action and one is worth reviewing.',
        created_at: gatheredAt,
        topics: [
          {
            emoji: '↩️',
            title: 'Reply Needed',
            items: [
              {
                message_id: 'fixture-1',
                headline: 'Contractor needs the floor-plan choice',
                note: 'The bay-window option needs a decision. Suggested: confirm the revised plan.',
                unread: true,
              },
              {
                message_id: 'fixture-3',
                headline: 'Marketplace buyer is waiting',
                note: 'The coat bundle sold. Suggested: contact the buyer within three days.',
                unread: true,
              },
            ],
          },
          {
            emoji: '👀',
            title: 'Review',
            items: [
              {
                message_id: 'fixture-2',
                headline: 'Insurance claim was processed',
                note: 'The carrier expects to send the outcome within a week.',
                unread: false,
              },
            ],
          },
        ],
        noise: {
          count: 4,
          categories: [
            { category: 'marketing', count: 3 },
            { category: 'automated', count: 1 },
          ],
        },
      },
      news: {
        created_at: gatheredAt,
        sections: [
          {
            emoji: '💻',
            title: 'GitHub',
            items: [
              {
                title: 'acme/rocket',
                url: 'https://github.com/acme/rocket',
                description: 'A tiny edge runtime.',
                note: 'Matches your interest in Cloudflare Workers.',
                meta: 'Rust · ★ 1200',
              },
            ],
          },
          {
            emoji: '🚀',
            title: 'Product Hunt',
            items: [
              {
                title: 'Hearth',
                url: 'https://www.producthunt.com/posts/hearth',
                description: 'Self-hosted dashboards without the yak-shaving.',
                note: 'You follow self-hosting.',
                meta: '▲ 340',
              },
            ],
          },
          {
            emoji: '📰',
            title: 'UK headlines',
            items: [
              {
                title: 'Rail strike talks resume',
                url: 'https://www.bbc.co.uk/news/uk-00000001',
                description: 'Unions and operators return to the table.',
                note: '',
                meta: '08:12',
              },
            ],
          },
        ],
      },
    }
  }

  // cookie-web-tasks: /documents and /tasks[/refresh|interests|daily-note-seed|image-upload]
  const handleWorkerTasksApi = async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const segments = url.pathname.split('/').filter(Boolean)
    const state = fixtureMailboxState(req, res)
    if (segments[0] === 'documents') {
      await handleWorkerDocuments(req, res, state, url)
      return
    }
    if (segments[0] === 'projects') {
      if (req.method === 'GET') {
        return json(res, {
          projects: [...state.projects].sort((a, b) => a.name.localeCompare(b.name)),
        })
      }
      const body = await readBody(req)
      if (req.method === 'POST') {
        const project = {
          id: randomUUID(),
          parentId: body.parentId ?? null,
          name: String(body.name || '').slice(0, 120),
          description: body.description ?? null,
          createdAt: new Date().toISOString(),
        }
        state.projects.push(project)
        return json(res, { project }, 201)
      }
      if (req.method === 'PATCH') {
        const project = state.projects.find((row) => row.id === body.id)
        if (!project) return json(res, { error: 'Project not found' }, 404)
        if (body.name !== undefined) project.name = body.name
        if (Object.hasOwn(body, 'parentId')) project.parentId = body.parentId
        if (Object.hasOwn(body, 'description')) project.description = body.description
        return json(res, { project })
      }
      if (req.method === 'DELETE') {
        const doomed = new Set([body.id])
        let grew = true
        while (grew) {
          grew = false
          for (const project of state.projects) {
            if (!doomed.has(project.id) && doomed.has(project.parentId)) {
              doomed.add(project.id)
              grew = true
            }
          }
        }
        state.projects = state.projects.filter((project) => !doomed.has(project.id))
        // Mirrors the schema's project_id ... ON DELETE CASCADE: every task
        // in the deleted project or any of its descendants goes with it,
        // not just the project rows.
        state.taskItems = state.taskItems.filter((item) => !doomed.has(item.projectId))
        return json(res, { ok: true })
      }
      return json(res, { error: 'Method not allowed' }, 405)
    }
    if (segments[0] === 'task-items') {
      if (req.method === 'GET') {
        const project = url.searchParams.get('project') ?? 'inbox'
        const today = project === 'today'
        if (project !== 'inbox' && !today && !isTaskUuid(project)) {
          return json(res, { error: 'project must be a project id, "inbox" or "today"' }, 400)
        }
        const date = url.searchParams.get('date')
        if (today && !isTaskCalendarDate(date)) {
          return json(res, { error: 'today requires a date=YYYY-MM-DD' }, 400)
        }
        const includeCompleted = url.searchParams.get('completed') === '1'
        const items = state.taskItems
          .filter((item) => {
            // Today spans every project; the others filter by one.
            if (today) return item.dueDate === date
            return project === 'inbox' ? item.projectId === null : item.projectId === project
          })
          .filter((item) => includeCompleted || item.completedAt === null)
        return json(res, { items })
      }
      const body = await readBody(req)
      if (req.method === 'POST') {
        const content = cleanTaskText(body.content, TASK_MAX_CONTENT_LENGTH)
        if (!content) return json(res, { error: 'Task content is required' }, 400)

        const projectId = body.projectId ?? null
        if (projectId !== null && !state.projects.some((row) => row.id === projectId)) {
          return json(res, { error: 'Project not found' }, 404)
        }

        const hasDue = body.dueDate !== undefined && body.dueDate !== null && body.dueDate !== ''
        if (hasDue && !isTaskCalendarDate(body.dueDate)) {
          return json(res, { error: 'dueDate must be a YYYY-MM-DD date' }, 400)
        }

        const item = {
          id: randomUUID(),
          projectId,
          parentId: null,
          content,
          description: body.description ?? null,
          dueDate: hasDue ? String(body.dueDate) : null,
          completedAt: null,
          createdAt: new Date().toISOString(),
        }
        state.taskItems.push(item)
        return json(res, { item }, 201)
      }
      if (req.method === 'PATCH') {
        const item = state.taskItems.find((row) => row.id === body.id)
        if (!item) return json(res, { error: 'Task not found' }, 404)

        const hasContent = Object.hasOwn(body, 'content')
        const hasDescription = Object.hasOwn(body, 'description')
        const hasProject = Object.hasOwn(body, 'projectId')
        const hasDueDate = Object.hasOwn(body, 'dueDate')
        const hasCompleted = Object.hasOwn(body, 'completed')
        if (!hasContent && !hasDescription && !hasProject && !hasDueDate && !hasCompleted) {
          return json(res, { error: 'At least one change is required' }, 400)
        }

        if (hasContent) {
          const content = cleanTaskText(body.content, TASK_MAX_CONTENT_LENGTH)
          if (!content) return json(res, { error: 'Task content is required' }, 400)
          item.content = content
        }
        if (hasDescription) item.description = body.description ?? null
        if (hasProject) {
          const projectId = body.projectId ?? null
          if (projectId !== null && !state.projects.some((row) => row.id === projectId)) {
            return json(res, { error: 'Project not found' }, 404)
          }
          item.projectId = projectId
        }
        if (hasDueDate) {
          const clears = body.dueDate === null || body.dueDate === ''
          if (!clears && !isTaskCalendarDate(body.dueDate)) {
            return json(res, { error: 'dueDate must be a YYYY-MM-DD date' }, 400)
          }
          item.dueDate = clears ? null : String(body.dueDate)
        }
        // Completion stamps a time; it never deletes, matching the real handler.
        if (hasCompleted) {
          item.completedAt = body.completed ? new Date().toISOString() : null
        }
        return json(res, { item })
      }
      if (req.method === 'DELETE') {
        const item = state.taskItems.find((row) => row.id === body.id)
        if (!item) return json(res, { error: 'Task not found' }, 404)
        state.taskItems = state.taskItems.filter((row) => row.id !== body.id)
        return json(res, { ok: true })
      }
      return json(res, { error: 'Method not allowed' }, 405)
    }
    if (segments[0] !== 'tasks') return json(res, { error: 'Not Found' }, 404)
    const sub = segments[1]
    if (sub === 'refresh') {
      // No enricher Worker locally: pretend the digest rebuild succeeded so
      // the refresh control still exercises its real path.
      return json(res, { ok: true })
    }
    if (sub === 'image-upload') {
      // Inlined as a data: URL — the real Worker writes to blob storage.
      return json(res, { url: 'data:image/png;base64,iVBORw0KGgo=' })
    }
    if (sub === 'interests') {
      state.interests ??= ['Cloudflare Workers', 'Vue', 'self-hosting']
      if (req.method === 'PUT') {
        const body = await readBody(req)
        state.interests = Array.isArray(body.interests) ? body.interests : []
      }
      return json(res, { interests: state.interests })
    }
    if (sub === 'daily-note-seed') {
      state.dailyNoteSeed ??= []
      if (req.method === 'PUT') {
        const body = await readBody(req)
        state.dailyNoteSeed = Array.isArray(body.blocks) ? body.blocks : []
      }
      return json(res, { blocks: state.dailyNoteSeed })
    }
    if (sub) return json(res, { error: 'Not Found' }, 404)
    if (req.method === 'POST') {
      // Completing a task: pretend the Todoist close + row delete succeeded.
      return json(res, { ok: true, closedInTodoist: true })
    }
    return json(res, fixtureTasksPayload())
  }

  // cookie-web-labels: /labels and /labels/rules
  const handleWorkerLabelsApi = async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments[0] !== 'labels') return json(res, { error: 'Not Found' }, 404)
    const state = fixtureMailboxState(req, res)
    if (segments[1] === 'rules') {
      if (req.method === 'GET') return json(res, { rules: state.rules })
      const body = await readBody(req)
      if (req.method === 'POST') {
        const rule = {
          id: `stub-rule-${randomUUID()}`,
          name: body.name ?? null,
          label_id: body.action === 'mark_done' ? null : (body.label_id ?? null),
          action: body.action || 'apply_label',
          match_type: body.match_type || 'all',
          enabled: true,
          conditions: body.conditions.map((condition, i) => ({ ...condition, position: i })),
        }
        state.rules.push(rule)
        return json(res, { rule }, 201)
      }
      const index = state.rules.findIndex((rule) => rule.id === body.id)
      if (index === -1) return json(res, { error: 'Rule not found' }, 404)
      if (req.method === 'DELETE') {
        state.rules.splice(index, 1)
        return json(res, { ok: true })
      }
      if (req.method === 'PATCH') {
        // body.id repeats the rule's own id, so spreading it changes nothing.
        const rule = { ...state.rules[index], ...body }
        // Matches the real handler: mark_done drops any label the rule carried,
        // and conditions are renumbered whenever they are replaced.
        if (rule.action === 'mark_done') rule.label_id = null
        rule.conditions = rule.conditions.map((condition, i) => ({ ...condition, position: i }))
        state.rules[index] = rule
        return json(res, { rule })
      }
      return json(res, { error: 'Method not allowed' }, 405)
    }
    if (segments.length > 1) return json(res, { error: 'Not Found' }, 404)
    const labels = await ensureStubLabels(state)
    if (req.method === 'POST') {
      const body = await readBody(req)
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
      return json(res, { label }, 201)
    }
    if (req.method === 'DELETE') {
      const body = await readBody(req)
      state.labels = labels.filter((l) => l.id !== body.id)
      return json(res, { ok: true })
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req)
      const label = labels.find((item) => item.id === body.id)
      if (label && Object.hasOwn(body, 'name')) label.name = body.name
      if (label && Object.hasOwn(body, 'auto_apply')) label.auto_apply = body.auto_apply
      return json(res, { label })
    }
    return json(res, { labels })
  }

  // cookie-web-messages: /messages[/attachment|thread-body|contacts]
  const handleWorkerMessagesApi = async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments[0] !== 'messages') return json(res, { error: 'Not Found' }, 404)
    const sub = segments[1]
    if (sub === 'contacts') {
      const { fixtureEmails } = await import('./api/_fixtures/emails.js')
      const contacts = new Map()
      for (const email of fixtureEmails()) {
        if (email.from_address) {
          contacts.set(email.from_address, {
            address: email.from_address,
            name: email.from_name || null,
          })
        }
      }
      return json(res, { contacts: [...contacts.values()] })
    }
    if (sub === 'attachment') {
      const id = url.searchParams.get('id')
      if (id !== 'fixture-1-attachment-1') {
        return json(res, { error: 'Attachment is not available' }, 404)
      }
      // A real http URL, not a data: URI — downloadAttachment's scheme check
      // (inbox.js) only lets http(s)/blob URLs reach the synthetic click,
      // exactly like the production Worker's Vercel Blob URLs.
      return json(res, {
        url: `http://${req.headers.host ?? 'localhost'}/__e2e__/messages-api/messages/attachment-file`,
        filename: 'Revised-Floor-Plan.pdf',
        contentType: 'application/pdf',
      })
    }
    if (sub === 'attachment-file') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', 'attachment; filename="Revised-Floor-Plan.pdf"')
      res.end(Buffer.from('JVBERi0xLjQKJSBDb29raWUgZml4dHVyZQo=', 'base64'))
      return
    }
    if (sub === 'thread-body') {
      const { fixtureMessageBody } = await import('./api/_fixtures/messages.js')
      const id = url.searchParams.get('id')
      const primary = fixtureMessageBody(id)
      const earlier = fixtureMessageBody('fixture-1').thread.find((message) => message.id === id)
      return json(res, { body_text: earlier?.body_text ?? primary.body_text ?? '' })
    }
    if (sub) return json(res, { error: 'Not Found' }, 404)
    if (req.method === 'GET') {
      const { fixtureMessageBody } = await import('./api/_fixtures/messages.js')
      const id = url.searchParams.get('id')
      const { summaries } = fixtureMailboxState(req, res)
      const body = fixtureMessageBody(id)
      const thread = body.thread.map(({ body_text: _bodyText, ...message }) => message)
      return json(res, { ...body, thread, summary: summaries.get(id) ?? null })
    }
    if (req.method === 'POST') {
      const body = await readBody(req)
      if (body.action === 'unsubscribe') {
        return json(res, { status: 'unsubscribed', method: 'one-click' })
      }
      if (body.action === 'add_label' || body.action === 'remove_label') {
        const state = fixtureMailboxState(req, res)
        const labels = await ensureStubLabels(state)
        const label = labels.find((l) => l.id === body.label_id)
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
        return json(res, { labels: current })
      }
      return json(res, { ok: true })
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req)
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
      // Starred is a server-side folder now, so a star has to outlive the
      // store's optimistic update — the next ?folder=starred re-reads it here.
      if (Object.hasOwn(body, 'is_starred')) {
        const { stars } = fixtureMailboxState(req, res)
        stars.set(body.id, Boolean(body.is_starred))
      }
      return json(res, { message: body })
    }
    return json(res, { ok: true })
  }

  // Same-origin adapter for the legacy /api/messages?resource=… shape. The
  // service worker (public/sw.js) caches recent mail from this path in
  // e2e/dev — production uses the cross-origin messages Worker — but the
  // original Vercel handler was removed in the Workers migration, so requests
  // fell through to the SPA shell and the offline cache served HTML as JSON.
  const handleLegacyMessagesApi = (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const resource = url.searchParams.get('resource')
    url.searchParams.delete('resource')
    req.url = `/messages${resource ? `/${resource}` : ''}${url.search}`
    return handleWorkerMessagesApi(req, res)
  }

  const mount = (server) => {
    server.middlewares.use('/api/messages', handleLegacyMessagesApi)
    server.middlewares.use('/api/read-receipts', handleReadReceipts)
    server.middlewares.use('/api/calendar-events', handleCalendarEvents)
    server.middlewares.use('/api/emails', handleEmails)
    server.middlewares.use('/api/send', handleSend)
    server.middlewares.use('/api/search', handleSearch)
    server.middlewares.use('/api/ask', handleAsk)
    server.middlewares.use('/api/compose', handleCompose)
    server.middlewares.use('/api/summarize', handleSummarize)
    // Worker origins, reached via e2e/workerFixtures.js's request routing.
    server.middlewares.use('/__e2e__/tasks-api', handleWorkerTasksApi)
    server.middlewares.use('/__e2e__/labels-api', handleWorkerLabelsApi)
    server.middlewares.use('/__e2e__/messages-api', handleWorkerMessagesApi)
    server.middlewares.use('/__e2e__/receipts-api', handleWorkerReceiptsApi)
    server.middlewares.use('/__e2e__/emails-api', handleWorkerEmailsApi)
    server.middlewares.use('/__e2e__/ai-api', handleWorkerAiApi)
    server.middlewares.use('/__e2e__/search-api', handleWorkerSearchApi)
    server.middlewares.use('/__e2e__/calendar-api', handleWorkerCalendarApi)
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
