#!/usr/bin/env bash
# Applies pending SQL migrations, in filename order, against $DATABASE_URL.
# Applied filenames are tracked in the schema_migrations table so re-runs
# are no-ops.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"

MIGRATIONS_DIR="$(cd "$(dirname "$0")" && pwd)"

PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -c "CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);"

applied=0
skipped=0
for file in "$MIGRATIONS_DIR"/[0-9]*.sql; do
  [ -e "$file" ] || continue
  name="$(basename "$file")"
  already="$("${PSQL[@]}" -tA -c "SELECT 1 FROM schema_migrations WHERE filename = '$name';")"
  if [ "$already" = "1" ]; then
    echo "skip   $name (already applied)"
    skipped=$((skipped + 1))
    continue
  fi
  echo "apply  $name"
  "${PSQL[@]}" -f "$file"
  "${PSQL[@]}" -c "INSERT INTO schema_migrations (filename) VALUES ('$name');"
  applied=$((applied + 1))
done

echo "done: $applied applied, $skipped skipped"
