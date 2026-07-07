import { neon } from '@neondatabase/serverless'

import { parseEmail } from './parse.js'
import { storeEmail } from './store.js'

// Mail delivery is the priority: the store step gets this long, then the
// message is forwarded regardless of what storage did.
const STORE_BUDGET_MS = 5000

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`store step exceeded ${ms}ms budget`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export default {
  async email(message, env) {
    let record = null
    try {
      record = await parseEmail(message)
      const sql = neon(env.DATABASE_URL)
      const outcome = await withTimeout(storeEmail(sql, record, env.OWNER_EMAIL), STORE_BUDGET_MS)
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
          error: err instanceof Error ? err.message : String(err),
          message_id: record?.messageId ?? null,
          raw_size: message.rawSize,
        }),
      )
    }

    // Let forward() errors propagate: the sending MTA sees a temporary
    // failure and retries, and the stored row's ON CONFLICT keeps the retry
    // idempotent.
    await message.forward(env.FORWARD_TO)
  },
}
