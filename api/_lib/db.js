import process from 'node:process'

import postgres from 'postgres'

let sql

// Lazily-created singleton so the pool is reused across handler invocations
// within the same runtime, but not created at module-eval time (before
// DATABASE_URL is necessarily set). prepare: false is required for
// transaction-mode poolers (Supavisor, PgBouncer) — safe no-op against a
// direct connection too.
export function getSql() {
  if (!sql) {
    sql = postgres(process.env.DATABASE_URL, {
      ssl: 'require',
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    })
  }
  return sql
}
