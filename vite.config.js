import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'

// Serves /api/emails locally, where Vercel's serverless functions don't run.
// E2E mode (and dev without DATABASE_URL) answers from fixtures; otherwise the
// real Vercel handler runs against Postgres.
function localApiPlugin(mode) {
  // Fixture mutations are scoped by a same-origin cookie so separate browser
  // contexts (including parallel Playwright projects) never leak schedules.
  const stubSchedules = new Map()
  const fixtureSchedules = (req, res) => {
    const match = /(?:^|;\s*)cookie_fixture_session=([^;]+)/.exec(req.headers.cookie || '')
    const sessionId = match?.[1] || randomUUID()
    if (!match) {
      res.setHeader('Set-Cookie', `cookie_fixture_session=${sessionId}; Path=/; SameSite=Lax`)
    }
    if (!stubSchedules.has(sessionId)) stubSchedules.set(sessionId, new Map())
    return stubSchedules.get(sessionId)
  }

  const handleEmails = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      const { fixtureEmails, fixtureSentEmails } = await import('./api/_fixtures/emails.js')
      const folder = new URL(req.url, 'http://localhost').searchParams.get('folder') || 'inbox'
      const schedules = fixtureSchedules(req, res)
      const now = Date.now()
      const inbox = fixtureEmails().map((email) => ({
        ...email,
        scheduled_for: schedules.get(email.id) ?? null,
      }))
      const emails =
        folder === 'sent'
          ? fixtureSentEmails()
          : folder === 'spam'
            ? []
            : folder === 'snoozed'
              ? inbox.filter((email) => Date.parse(email.scheduled_for) > now)
              : inbox.filter(
                  (email) => !email.scheduled_for || Date.parse(email.scheduled_for) <= now,
                )
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          emails,
          nextCursor: null,
          unreadCount: emails.filter((e) => e.is_unread).length,
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
        res.end(JSON.stringify(fixtureMessageBody(id)))
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
      }
      if (req.method === 'PATCH') {
        let raw = ''
        for await (const chunk of req) raw += chunk
        const body = JSON.parse(raw || '{}')
        if (Object.hasOwn(body, 'scheduled_for')) {
          const schedules = fixtureSchedules(req, res)
          if (body.scheduled_for === null) schedules.delete(body.id)
          else schedules.set(body.id, body.scheduled_for)
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
      const emails = fixtureEmails().filter((email) =>
        [email.subject, email.body_text, email.from_name, email.from_address]
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
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
      res.setHeader('Content-Type', 'application/json')
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
        if (label) label.auto_apply = body.auto_apply
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
      vueJsx(),
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
