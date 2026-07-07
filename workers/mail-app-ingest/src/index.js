import { neon } from '@neondatabase/serverless'

import { parseEmail } from './parse.js'
import { storeEmail } from './store.js'

// Mail delivery is the priority: the store step gets this long, then the
// message is forwarded regardless of what storage did.
const STORE_BUDGET_MS = 5000

// postal-mime buffers and decodes the whole message before forward() is ever
// reached; near the platform's message-size limit that risks an isolate OOM
// no try/catch can save. Past this size, skip storage entirely and forward.
const MAX_PARSE_BYTES = 10 * 1024 * 1024

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`store step exceeded ${ms}ms budget`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// neon()'s own errors can embed the full connection string; never let the
// secret reach a log line.
function connect(databaseUrl) {
  try {
    return neon(databaseUrl)
  } catch {
    throw new Error('DATABASE_URL is not a valid connection string')
  }
}

function redact(err, secret) {
  const text = err instanceof Error ? err.message : String(err)
  return secret ? text.split(secret).join('[redacted]') : text
}

export default {
  async email(message, env, ctx) {
    let record = null
    let storePromise = null

    if (message.rawSize > MAX_PARSE_BYTES) {
      console.error(JSON.stringify({ event: 'store_skipped_oversize', raw_size: message.rawSize }))
      await message.forward(env.FORWARD_TO)
      return
    }

    try {
      record = await parseEmail(message)
      const sql = connect(env.DATABASE_URL)
      storePromise = storeEmail(sql, record, env.OWNER_EMAIL)
      const outcome = await withTimeout(storePromise, STORE_BUDGET_MS)
      console.log(
        JSON.stringify({
          event: 'stored',
          outcome,
          message_id: record.messageId,
          raw_size: record.rawSize,
          attachments: record.attachments.length,
          truncated: record.truncated,
        }),
      )
    } catch (err) {
      // Storage/parsing must never block delivery: log (ids and sizes only,
      // never bodies or connection strings) and fall through to forward.
      // setReject() is deliberately never called for storage failures.
      console.error(
        JSON.stringify({
          event: 'store_failed',
          error: redact(err, env.DATABASE_URL),
          message_id: record?.messageId ?? null,
          raw_size: message.rawSize,
        }),
      )
      // A store that merely outran the budget may still succeed — let it
      // finish in the background instead of cancelling it with the handler.
      if (storePromise) {
        ctx?.waitUntil?.(
          storePromise.then(
            (outcome) =>
              console.log(
                JSON.stringify({ event: 'stored_late', outcome, message_id: record?.messageId ?? null }),
              ),
            () => {},
          ),
        )
      }
    }

    // Let forward() errors propagate: the sending MTA sees a temporary
    // failure and retries, and the stored row's ON CONFLICT keeps the retry
    // idempotent.
    await message.forward(env.FORWARD_TO)
  },
}
