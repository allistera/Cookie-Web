import process from 'node:process'
import { getSql } from './db.js'
import {
  AI_API_URL,
  CALENDAR_API_URL,
  DRAFTS_API_URL,
  EMAILS_API_URL,
  LABELS_API_URL,
  MESSAGES_API_URL,
  NOTIFICATIONS_API_URL,
  SEARCH_API_URL,
  RECEIPTS_API_URL,
  TASKS_API_URL,
  SEND_API_URL,
  MCP_API_URL,
} from '../../src/lib/apiWorkers.js'

export const HEALTH_TIMEOUT_MS = 3000

// Fixed project endpoints; caller input never selects probe destinations.
const BACKENDS = {
  ai: AI_API_URL,
  calendar: CALENDAR_API_URL,
  drafts: DRAFTS_API_URL,
  emails: EMAILS_API_URL,
  labels: LABELS_API_URL,
  messages: MESSAGES_API_URL,
  notifications: NOTIFICATIONS_API_URL,
  search: SEARCH_API_URL,
  receipts: RECEIPTS_API_URL,
  tasks: TASKS_API_URL,
  send: SEND_API_URL,
  mcp: MCP_API_URL,
}

export function createHealthChecks(overrides = {}) {
  const sendRequest = overrides.fetch ?? globalThis.fetch
  const sqlClient = overrides.getSql ?? getSql
  const env = overrides.env ?? process.env
  const http = (url, expected) => async (signal) => {
    const response = await sendRequest(url, {
      method: 'GET',
      signal,
      redirect: 'error',
      cache: 'no-store',
    })
    if (!response.ok || (await response.json()).status !== expected)
      throw new Error('Unhealthy service')
  }
  return {
    database: async (signal) => {
      if (!env.DATABASE_URL) throw new Error('Database is not configured')
      const query = sqlClient()`SELECT 1`
      const cancel = () => {
        void query.cancel().catch(() => undefined)
      }
      signal.addEventListener('abort', cancel, { once: true })
      try {
        await query
      } finally {
        signal.removeEventListener('abort', cancel)
      }
    },
    meilisearch: http('https://meilisearch.infinitywave.online/health', 'available'),
    ...Object.fromEntries(
      Object.entries(BACKENDS).map(([name, origin]) => [name, http(`${origin}/health`, 'ok')]),
    ),
  }
}

async function probe(check) {
  const controller = new AbortController()
  let timer
  try {
    await Promise.race([
      Promise.resolve().then(() => check(controller.signal)),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error('Health check timed out'))
        }, HEALTH_TIMEOUT_MS)
      }),
    ])
    return { status: 'ok' }
  } catch {
    // Dependency errors may contain credentials, URLs or SQL details.
    return { status: 'error' }
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

export async function runHealthChecks(checks) {
  const results = await Promise.all(
    Object.entries(checks).map(async ([name, check]) => [name, await probe(check)]),
  )
  return {
    status: results.every(([, result]) => result.status === 'ok') ? 'ok' : 'degraded',
    checks: Object.fromEntries(results),
  }
}
