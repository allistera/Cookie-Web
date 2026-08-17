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
  const handleMessages = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      res.setHeader('Content-Type', 'application/json')
      const url = new URL(req.url, 'http://localhost')
      if (url.searchParams.get('resource') === 'contacts') {
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
        res.end(JSON.stringify({ contacts: [...contacts.values()] }))
        return
      }
      if (req.method === 'GET' && url.searchParams.get('resource') === 'attachment') {
        const id = url.searchParams.get('id')
        if (id !== 'fixture-1-attachment-1') {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Attachment is not available' }))
          return
        }
        res.end(
          JSON.stringify({
            url: 'data:application/pdf;base64,JVBERi0xLjQKJSBDb29raWUgZml4dHVyZQo=',
            filename: 'Revised-Floor-Plan.pdf',
            contentType: 'application/pdf',
          }),
        )
        return
      }
      if (req.method === 'GET' && url.searchParams.get('resource') === 'thread-body') {
        const { fixtureMessageBody } = await import('./api/_fixtures/messages.js')
        const id = url.searchParams.get('id')
        const primary = fixtureMessageBody(id)
        const earlier = fixtureMessageBody('fixture-1').thread.find((message) => message.id === id)
        res.end(JSON.stringify({ body_text: earlier?.body_text ?? primary.body_text ?? '' }))
        return
      }
      if (req.method === 'GET') {
        const { fixtureMessageBody } = await import('./api/_fixtures/messages.js')
        const id = url.searchParams.get('id')
        const { summaries } = fixtureMailboxState(req, res)
        const body = fixtureMessageBody(id)
        const thread = body.thread.map(({ body_text: _bodyText, ...message }) => message)
        res.end(JSON.stringify({ ...body, thread, summary: summaries.get(id) ?? null }))
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
  // Seeded from the tags the fixture mail already carries, then kept in session
  // state so create/rename/delete are visible within a session without leaking
  // into other browser contexts.
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
  // /api/labels?resource=rules — mirrors api/_lib/label-rules.js's wire shape
  // (rules carry conditions inline; mark_done rules carry no label) so the
  // settings Rules manager works against fixtures.
  const handleLabelRules = async (req, res) => {
    const state = fixtureMailboxState(req, res)
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'GET') {
      res.end(JSON.stringify({ rules: state.rules }))
      return
    }
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw || '{}')
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
      res.statusCode = 201
      res.end(JSON.stringify({ rule }))
      return
    }
    const index = state.rules.findIndex((rule) => rule.id === body.id)
    if (index === -1) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Rule not found' }))
      return
    }
    if (req.method === 'DELETE') {
      state.rules.splice(index, 1)
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (req.method === 'PATCH') {
      // body.id repeats the rule's own id, so spreading it changes nothing.
      const rule = { ...state.rules[index], ...body }
      // Matches the real handler: mark_done drops any label the rule carried,
      // and conditions are renumbered whenever they are replaced.
      if (rule.action === 'mark_done') rule.label_id = null
      rule.conditions = rule.conditions.map((condition, i) => ({ ...condition, position: i }))
      state.rules[index] = rule
      res.end(JSON.stringify({ rule }))
      return
    }
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
  }
  const handleLabels = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      if (new URL(req.url, 'http://localhost').searchParams.get('resource') === 'rules') {
        await handleLabelRules(req, res)
        return
      }
      const state = fixtureMailboxState(req, res)
      const labels = await ensureStubLabels(state)
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
        state.labels = labels.filter((l) => l.id !== body.id)
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
  // /api/tasks?resource=documents — mirrors api/_lib/documents.js's wire shape
  // (folders + documents lists without blocks; single fetch carries blocks) so
  // the Documents workspace works against per-session fixture state.
  const handleTaskDocuments = async (req, res, state) => {
    if (!state.documents) {
      const { fixtureDocumentFolders, fixtureDocuments, fixtureDocumentTemplates } = await import(
        './api/_fixtures/documents.js'
      )
      state.docFolders = fixtureDocumentFolders()
      state.documents = fixtureDocuments()
      state.docTemplates = fixtureDocumentTemplates()
    }
    const url = new URL(req.url, 'http://localhost')
    const stripBlocks = ({ blocks: _blocks, ...doc }) => doc
    if (req.method === 'GET') {
      const rawQuery = url.searchParams.get('q')
      if (rawQuery && rawQuery.trim()) {
        // A simplified stand-in for the real hybrid (keyword+semantic) search
        // in api/_lib/documents.js — full-text substring matching over
        // title+blocks rather than tsvector/pgvector, same fidelity level as
        // handleSearch's email fixture below. Good enough for local dev/e2e,
        // not a ranking model.
        const { parseDocumentSearchQuery } = await import('./api/_lib/query-parse.js')
        const { text, filters } = parseDocumentSearchQuery(rawQuery.trim())
        const terms = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []
        const documents = state.documents
          .filter((doc) => {
            const haystack = `${doc.title} ${JSON.stringify(doc.blocks)}`.toLowerCase()
            if (!terms.every((term) => haystack.includes(term))) return false
            if (filters.tag && !doc.tags?.some((tag) => tag.toLowerCase() === filters.tag.toLowerCase())) {
              return false
            }
            if (filters.starred && !doc.starred) return false
            return true
          })
          .map(stripBlocks)
        res.end(JSON.stringify({ documents }))
        return
      }
      const templateId = url.searchParams.get('templateId')
      if (templateId) {
        const template = state.docTemplates.find((item) => item.id === templateId)
        if (!template) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Template not found' }))
          return
        }
        res.end(JSON.stringify({ template }))
        return
      }
      if (url.searchParams.has('templates')) {
        res.end(JSON.stringify({ templates: state.docTemplates.map(stripBlocks) }))
        return
      }
      const id = url.searchParams.get('id')
      if (id) {
        const document = state.documents.find((doc) => doc.id === id)
        if (!document) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Document not found' }))
          return
        }
        res.end(JSON.stringify({ document }))
        return
      }
      res.end(
        JSON.stringify({
          folders: state.docFolders,
          documents: state.documents.map(stripBlocks),
        }),
      )
      return
    }
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw || '{}')
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
        res.statusCode = 201
        res.end(JSON.stringify({ folder }))
        return
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
        res.statusCode = 201
        res.end(JSON.stringify({ template }))
        return
      }
      const template = body.templateId
        ? state.docTemplates.find((item) => item.id === body.templateId)
        : null
      if (body.templateId && !template) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'Template not found' }))
        return
      }
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
      res.statusCode = 201
      res.end(JSON.stringify({ document }))
      return
    }
    if (req.method === 'PATCH') {
      if (body.kind === 'folder') {
        const folder = state.docFolders.find((item) => item.id === body.id)
        if (!folder) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Folder not found' }))
          return
        }
        folder.title = body.title
        res.end(JSON.stringify({ folder }))
        return
      }
      if (body.kind === 'template') {
        const template = state.docTemplates.find((item) => item.id === body.id)
        if (!template) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Template not found' }))
          return
        }
        template.title = body.title
        template.blocks = structuredClone(body.blocks)
        template.updated_at = now()
        res.end(JSON.stringify({ template }))
        return
      }
      const document = state.documents.find((item) => item.id === body.id)
      if (!document) {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'Document not found' }))
        return
      }
      if (Object.hasOwn(body, 'title')) document.title = body.title
      if (Object.hasOwn(body, 'emoji')) document.emoji = body.emoji
      if (Object.hasOwn(body, 'starred')) document.starred = body.starred
      if (Object.hasOwn(body, 'folderId')) document.folder_id = body.folderId
      if (Object.hasOwn(body, 'blocks')) document.blocks = body.blocks
      if (Object.hasOwn(body, 'tags')) document.tags = [...new Set(body.tags)]
      document.updated_at = now()
      res.end(JSON.stringify({ document: stripBlocks(document) }))
      return
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
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Folder not found' }))
          return
        }
        state.docFolders = state.docFolders.filter((folder) => !doomed.has(folder.id))
        for (const doc of state.documents) {
          if (doomed.has(doc.folder_id)) doc.folder_id = null
        }
        res.end(JSON.stringify({ ok: true }))
        return
      }
      if (body.kind === 'template') {
        const before = state.docTemplates.length
        state.docTemplates = state.docTemplates.filter((template) => template.id !== body.id)
        if (state.docTemplates.length === before) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Template not found' }))
          return
        }
        res.end(JSON.stringify({ ok: true }))
        return
      }
      const before = state.documents.length
      state.documents = state.documents.filter((doc) => doc.id !== body.id)
      if (state.documents.length === before) {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'Document not found' }))
        return
      }
      res.end(JSON.stringify({ ok: true }))
      return
    }
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
  }
  const handleTasks = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      res.setHeader('Content-Type', 'application/json')
      const resource = new URL(req.url, 'http://localhost').searchParams.get('resource')
      if (resource === 'documents') {
        await handleTaskDocuments(req, res, fixtureMailboxState(req, res))
        return
      }
      if (resource === 'interests') {
        const state = fixtureMailboxState(req, res)
        state.interests ??= ['Cloudflare Workers', 'Vue', 'self-hosting']
        if (req.method === 'PUT') {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
          state.interests = Array.isArray(body.interests) ? body.interests : []
        }
        res.end(JSON.stringify({ interests: state.interests }))
        return
      }
      if (resource === 'daily-note-seed') {
        const state = fixtureMailboxState(req, res)
        state.dailyNoteSeed ??= []
        if (req.method === 'PUT') {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
          state.dailyNoteSeed = Array.isArray(body.blocks) ? body.blocks : []
        }
        res.end(JSON.stringify({ blocks: state.dailyNoteSeed }))
        return
      }
      if (resource === 'refresh') {
        // No enricher Worker locally: pretend the digest rebuild succeeded so
        // the refresh control still exercises its real path.
        res.end(JSON.stringify({ ok: true }))
        return
      }
      if (req.method === 'POST') {
        // Completing a task: pretend the Todoist close + row delete succeeded.
        res.end(JSON.stringify({ ok: true, closedInTodoist: true }))
        return
      }
      // Held three hours back so AI Today's staleness line is deterministic.
      const gatheredAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
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
        }),
      )
      return
    }
    const { default: handler } = await import('./api/tasks.js')
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
          JSON.stringify({ ok: true, subscriptionSyncedAt: calendar.subscriptionSyncedAt, subscriptionError: null }),
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
    server.middlewares.use('/api/tasks', handleTasks)
    server.middlewares.use('/api/calendar-events', handleCalendarEvents)
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
    plugins: [
      vue(),
      vueDevTools(),
      localApiPlugin(mode),
      entryChunkBudgetPlugin(),
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
