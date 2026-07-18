import process from 'node:process'
import { randomUUID } from 'node:crypto'
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
  const mount = (server) => {
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
