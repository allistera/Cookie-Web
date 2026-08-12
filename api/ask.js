import process from 'node:process'

import { getSql } from './_lib/db.js'
import { verifyAccessToken } from './_lib/auth.js'
import { captureApiError } from './_lib/sentry.js'
import { readJsonBody } from './_lib/body.js'
import { embedTextCached } from './_lib/embeddings.js'
import { fuseRankings } from './_lib/rank-fusion.js'
import { allowRequest } from './_lib/rate-limit.js'
import { keywordLeg, vectorLeg } from './_lib/retrieval.js'

const CHAT_MODEL = process.env.OPENAI_ASK_MODEL || 'gpt-4o-mini'
const MAX_QUESTION_CHARS = 500
const CANDIDATES = 20 // per retrieval leg
const CONTEXT_MESSAGES = 6
const CONTEXT_BODY_CHARS = 1500
const MAX_ANSWER_TOKENS = 400
const RATE_LIMIT = { limit: 10, windowMs: 60_000 } // per user; each ask is 2 OpenAI calls

const SYSTEM_PROMPT =
  'You are the assistant inside a personal mail app. Answer the question using ' +
  'ONLY the emails provided as context. Be concise. Use **bold** for email ' +
  'senders or key terms and numbered lines for multiple items. If the emails ' +
  "don't contain the answer, say so plainly — never invent email content."

function contextBlock(rows) {
  return rows
    .map((m, i) => {
      const body = (m.body_text || '').slice(0, CONTEXT_BODY_CHARS)
      return `[${i + 1}] From: ${m.from_name || m.from_address} | Subject: ${m.subject || '(none)'} | Date: ${m.sent_at}\n${body}`
    })
    .join('\n\n---\n\n')
}

async function chatCompletion(question, rows, apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      max_tokens: MAX_ANSWER_TOKENS,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Emails:\n\n${contextBlock(rows)}\n\nQuestion: ${question}`,
        },
      ],
    }),
  })
  if (!response.ok) {
    throw new Error(`OpenAI chat API responded ${response.status}`)
  }
  const { choices } = await response.json()
  return choices?.[0]?.message?.content?.trim() || "I couldn't produce an answer."
}

// POST /api/ask {question} — RAG over the user's mail: hybrid-retrieve the
// most relevant messages, answer from them, and return the sources used.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  let email
  try {
    ;({ email } = await verifyAccessToken(req))
  } catch {
    res.statusCode = 401
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  if (!process.env.OPENAI_API_KEY) {
    res.statusCode = 503
    res.end(JSON.stringify({ error: 'Assistant is not configured' }))
    return
  }

  if (!allowRequest(`ask:${email}`, RATE_LIMIT)) {
    res.statusCode = 429
    res.end(JSON.stringify({ error: 'Too many questions, slow down' }))
    return
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }

  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (!question || question.length > MAX_QUESTION_CHARS) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'question is required (max 500 chars)' }))
    return
  }

  try {
    const sql = getSql()

    // A natural-language question is matched as plain free text: no prefix
    // (the last word is complete) and no structured operators.
    const spec = { text: question, prefixQuery: null, filters: {} }

    const semanticIds = async () => {
      try {
        const vector = JSON.stringify(
          await embedTextCached(question, process.env.OPENAI_API_KEY),
        )
        return await vectorLeg(sql, email, vector, spec.filters, CANDIDATES)
      } catch (err) {
        console.error('POST /api/ask vector leg failed:', err.message)
        return []
      }
    }

    const [keywordRows, vectorRows] = await Promise.all([
      keywordLeg(sql, email, spec, CANDIDATES),
      semanticIds(),
    ])
    const ids = fuseRankings([
      keywordRows.map((r) => r.id),
      vectorRows.map((r) => r.id),
    ]).slice(0, CONTEXT_MESSAGES)

    if (ids.length === 0) {
      res.statusCode = 200
      res.end(
        JSON.stringify({
          answer: "I couldn't find any emails related to that. Try rephrasing your question.",
          sources: [],
        }),
      )
      return
    }

    const rows = await sql`
      SELECT m.id, m.from_name, m.from_address, m.subject,
             LEFT(m.body_text, ${CONTEXT_BODY_CHARS}) AS body_text, m.sent_at
      FROM messages m
      JOIN users u ON u.id = m.user_id
      WHERE lower(u.email) = ${email} AND m.id = ANY(${ids}::uuid[])
    `
    const byId = new Map(rows.map((row) => [row.id, row]))
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean)

    const answer = await chatCompletion(question, ordered, process.env.OPENAI_API_KEY)

    res.statusCode = 200
    res.end(
      JSON.stringify({
        answer,
        sources: ordered.map((m) => ({
          id: m.id,
          subject: m.subject,
          from_name: m.from_name || m.from_address,
        })),
      }),
    )
  } catch (err) {
    console.error('POST /api/ask failed:', err)
    await captureApiError(err, { route: 'POST /api/ask' })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Ask failed' }))
  }
}
