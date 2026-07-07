import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

export function readFixture(name) {
  return readFileSync(join(fixturesDir, name), 'utf-8')
}

// Minimal stand-in for ForwardableEmailMessage: postal-mime accepts a string
// for `raw`, so tests never need a ReadableStream.
export function fakeMessage(raw, { from = 'sender@example.com', to = 'inbox@example.org' } = {}) {
  return {
    from,
    to,
    raw,
    rawSize: new TextEncoder().encode(raw).length,
    forward: () => Promise.resolve(),
    setReject: () => {},
  }
}

// Mimics the neon() tagged-template client: sql`...` records the query and
// resolves lookup rows; sql.transaction() records the batch.
export function createMockSql({ lookupRows }) {
  const executed = []
  const transactions = []
  const sql = (strings, ...values) => {
    const query = { text: strings.join('¶'), values }
    executed.push(query)
    return Object.assign(Promise.resolve(query.text.includes('FROM users') ? lookupRows : []), query)
  }
  sql.transaction = (queries) => {
    transactions.push(queries)
    return Promise.resolve(queries.map(() => []))
  }
  return { sql, executed, transactions }
}
