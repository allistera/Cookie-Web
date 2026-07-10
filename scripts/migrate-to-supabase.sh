#!/usr/bin/env bash
# One-shot data migration from Neon to Supabase (schema + data via pg_dump).
#
# Usage:
#   NEON_DATABASE_URL=postgres://...  \
#   SUPABASE_DATABASE_URL=postgres://... \
#   ./scripts/migrate-to-supabase.sh
#
# SUPABASE_DATABASE_URL must be the DIRECT connection (db.<ref>.supabase.co:5432),
# not the Supavisor pooler — pg_restore needs full session semantics.
# See migrations/supabase-cutover.md for the full cutover order.
set -euo pipefail

: "${NEON_DATABASE_URL:?source (Neon) connection string required}"
: "${SUPABASE_DATABASE_URL:?target (Supabase) DIRECT 5432 connection string required}"

for cmd in pg_dump pg_restore psql; do
  command -v "$cmd" >/dev/null || { echo "$cmd not found on PATH"; exit 1; }
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="/tmp/cookie-web-${STAMP}.dump"

echo "== 1/4 prepare target: enable extensions"
psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -c 'CREATE EXTENSION IF NOT EXISTS vector;'

echo "== 2/4 dump source -> ${DUMP}"
pg_dump "$NEON_DATABASE_URL" --format=custom --no-owner --no-privileges \
  --file "$DUMP"

echo "== 3/4 restore into target"
# No --exit-on-error: a small number of benign errors are expected on Supabase
# (e.g. COMMENT ON EXTENSION as a non-superuser). Review the summary line and
# rely on the row-count verification below for correctness.
pg_restore --dbname "$SUPABASE_DATABASE_URL" --no-owner --no-privileges \
  "$DUMP" || echo "pg_restore finished with warnings (see above)"

echo "== 4/4 verify row counts"
fail=0
for t in users threads messages attachments labels message_labels schema_migrations; do
  src="$(psql "$NEON_DATABASE_URL" -tA -c "SELECT count(*) FROM $t")"
  dst="$(psql "$SUPABASE_DATABASE_URL" -tA -c "SELECT count(*) FROM $t")"
  if [ "$src" = "$dst" ]; then
    echo "ok     $t: $src"
  else
    echo "MISMATCH $t: source=$src target=$dst"
    fail=1
  fi
done

psql "$SUPABASE_DATABASE_URL" -q -c 'ANALYZE;'

if [ "$fail" -ne 0 ]; then
  echo "row counts differ — do NOT cut over; investigate before retrying"
  exit 1
fi
echo "done: dump kept at ${DUMP}"
