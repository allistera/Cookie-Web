# Task Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn task labels from free-text strings into managed, coloured labels with a sidebar section, a filter view, cross-task rename and delete, and a chip picker.

**Architecture:** A new `task_labels` table keyed by (user, name) sits beside the existing `task_items.labels text[]`, which stays as the link. The `cookie-web-tasks` Worker gains `/task-labels` CRUD (rename and delete rewrite task arrays in one transaction), registers unknown names on task writes, and accepts `project=label:<name>` on the paged list. Cookie-Web gains a `taskLabels` store, a `TaskLabelPicker`, a Labels section in the Tasks sidebar, and coloured chips.

**Tech Stack:** Postgres (Supabase) migrations in Cookie-Web `migrations/`; Cloudflare Worker with postgres.js and vitest (`Cookie-Worker/workers/cookie-web-tasks`); Vue 3 + Pinia + vue-router with vitest and @vue/test-utils (`Cookie-Web`).

**Spec:** `docs/superpowers/specs/2026-09-20-task-labels-design.md`

## Global Constraints

- Label name rule (worker `normalizeTaskLabels`, mirrored in web and SQL): trimmed, leading `@` stripped, lowercased, 1–40 characters, no whitespace, `@` or `#`; at most 20 per task.
- Colour is a lowercase hex string `#rrggbb`; default `#64748b`; the picker palette is the eight colours `#e5484d #e58f1a #2f9e44 #1a73e8 #7048e8 #d6409f #0ca678 #64748b`.
- Route value for a label view is exactly `label:<name>` in `?project=`.
- Worker responses follow the `/projects` shape: `{ labels }`, `{ label }`, `{ ok: true }`, `{ error }`.
- Two repos: worker tasks run in `Cookie-Worker` (`npm test`, `npm run lint`, `npm run format:check`, `npm run typecheck`); web and migration tasks run in `Cookie-Web` (`npx vitest run`, `npm run lint`, `npm run format:check`). Commit in whichever repo the task touches; both push to `main` directly.
- Rollout order: migration (Cookie-Web push) → deploy `cookie-web-tasks` (`gh workflow run Deploy` in Cookie-Worker) → Cookie-Web push.
- Inline colour assertions in web tests: jsdom serialises a hex colour set through `el.style` as `rgb(r, g, b)`; if a `toContain('rgb(...)')` assertion fails only on that, assert the hex form (`'color: #1a73e8'`) instead. Never weaken the assertion further.

---

## File map

Cookie-Web:

- Create `migrations/0079_task_labels.sql` — table, seed, GIN index.
- Modify `migrations/README.md` — Task labels section.
- Create `src/lib/labelPalette.js` — `LABEL_PALETTE`, `DEFAULT_LABEL_COLOR`.
- Create `src/lib/taskLabels.js` — `normalizeLabelName`, `labelChipStyle`.
- Modify `src/components/CategorySettings.vue:7-16` — import the palette.
- Create `src/stores/taskLabels.js` — labels store.
- Modify `src/stores/taskItems.js:185-197` — `label:` rule in `belongsToLoadedList`.
- Create `src/components/TaskLabelPicker.vue` — chips + suggestions.
- Modify `src/components/AddTaskDialog.vue` — use the picker.
- Modify `src/components/TaskDetailPanel.vue` — use the picker.
- Modify `src/components/TasksSidebar.vue` — Labels section.
- Modify `src/views/TasksView.vue` — label rule, coloured chips and headers.
- Tests under `src/lib/__tests__`, `src/stores/__tests__`, `src/components/__tests__`, `src/views/__tests__`.

Cookie-Worker (`workers/cookie-web-tasks`):

- Create `src/taskLabels.js` — `/task-labels` handlers.
- Modify `src/worker.js` — route `/task-labels`.
- Modify `src/taskItems.js` — `registerTaskLabels` on create/update.
- Modify `src/taskPages.js` — `label:` filter.
- Tests `test/taskLabels.test.js`, `test/taskPages.test.js`, edits to `test/taskItems.test.js`, `test/worker.test.js`.

Cookie-Docs: `docs/03-data-model.mdx` table row; `docs/02-components/01-cookie-web.mdx` Tasks paragraph.

---

### Task 1: Migration `0079_task_labels.sql`

**Files:**

- Create: `Cookie-Web/migrations/0079_task_labels.sql`
- Modify: `Cookie-Web/migrations/README.md` (append after the "Natural-language task metadata" section)

**Interfaces:**

- Produces: table `public.task_labels (id uuid, user_id uuid, name text, color text, created_at timestamptz)` with `UNIQUE (user_id, name)`; index `task_items_labels_idx`.

- [ ] **Step 1: Write the migration**

```sql
-- 0079_task_labels.sql
-- Managed task labels. task_items.labels (0067) keeps holding label names;
-- this table gives each name a row of its own so it can carry a colour and
-- be listed, renamed and deleted across every task that uses it. Keyed by
-- (user_id, name) rather than referenced by id, so nothing that reads or
-- writes task_items.labels has to change.

BEGIN;

CREATE TABLE public.task_labels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text NOT NULL DEFAULT '#64748b',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name),
  -- Mirrors the Worker's normalizeTaskLabels: lowercase, 1-40 characters,
  -- no whitespace, @ or #.
  CONSTRAINT task_labels_name_check
    CHECK (name ~ '^[^[:space:]@#]{1,40}$' AND name = lower(name)),
  CONSTRAINT task_labels_color_check CHECK (color ~ '^#[0-9a-f]{6}$')
);

ALTER TABLE public.task_labels ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.task_labels FROM anon, authenticated;

-- The label view filters with labels @> ARRAY[name].
CREATE INDEX task_items_labels_idx ON public.task_items USING gin (labels);

-- Every name already on a task gets a row, so the sidebar is populated on
-- first load and a rename never meets a name it does not know.
INSERT INTO public.task_labels (user_id, name)
SELECT DISTINCT t.user_id, l.name
FROM public.task_items t, unnest(t.labels) AS l(name)
ON CONFLICT (user_id, name) DO NOTHING;

COMMIT;
```

- [ ] **Step 2: Document it in `migrations/README.md`**

Append after the "Natural-language task metadata" section:

```markdown
## Task labels

`0079_task_labels.sql` adds `task_labels`, one row per user-defined label
with a colour, keyed by `(user_id, name)`. `task_items.labels` keeps holding
names; this table is what the Tasks sidebar lists and what a rename or
delete rewrites across tasks. It seeds a row for every name already on a
task and adds a GIN index on `task_items.labels` for the label view's
containment filter. Apply it before deploying the `cookie-web-tasks` Worker
that serves `/task-labels`, then deploy Cookie-Web.
```

- [ ] **Step 3: Check formatting and commit**

Run: `cd Cookie-Web && npx prettier --check migrations/README.md`
Expected: "All matched files use Prettier code style!" (run `--write` if not).

```bash
cd Cookie-Web
git add migrations/0079_task_labels.sql migrations/README.md
git commit -m "Migration 0079: managed task labels with colours"
```

---

### Task 2: Worker — `GET` and `POST /task-labels`

**Files:**

- Create: `Cookie-Worker/workers/cookie-web-tasks/src/taskLabels.js`
- Test: `Cookie-Worker/workers/cookie-web-tasks/test/taskLabels.test.js`

**Interfaces:**

- Consumes: `normalizeTaskLabels(value: any[]): string[]` from `src/taskMetadata.js` (throws `Error` with a user-facing message on a bad name).
- Produces: `getTaskLabels(sql, userId) → Response`, `createTaskLabel(sql, userId, body) → Response`, `DEFAULT_LABEL_COLOR = '#64748b'`, `cleanLabelName(value) → string | null`, `cleanColor(value) → string | null`.

- [ ] **Step 1: Write the failing tests**

```js
// test/taskLabels.test.js
import { describe, expect, it } from 'vitest'
import { createTaskLabel, getTaskLabels } from '../src/taskLabels.js'
import { createMockSql } from './helpers.js'

const USER_ID = '99999999-9999-9999-9999-999999999999'
const LABEL_ID = '11111111-1111-4111-8111-111111111111'
const LABEL = { id: LABEL_ID, name: 'home', color: '#1a73e8', taskCount: 2, createdAt: 't0' }

describe('GET /task-labels', () => {
  it('returns the caller labels with a task count each', async () => {
    const sql = createMockSql([[LABEL]])

    const response = await getTaskLabels(sql, USER_ID)

    expect(response.status).toBe(200)
    expect((await response.json()).labels).toEqual([LABEL])
    expect(sql.calls[0].text).toContain('FROM task_labels')
    expect(sql.calls[0].text).toContain('"taskCount"')
    expect(sql.calls[0].values).toContain(USER_ID)
  })
})

describe('POST /task-labels', () => {
  it('creates a label with the default colour', async () => {
    const sql = createMockSql([[{ ...LABEL, color: '#64748b', taskCount: 0 }]])

    const response = await createTaskLabel(sql, USER_ID, { name: '@Home' })

    expect(response.status).toBe(201)
    expect((await response.json()).label.name).toBe('home')
    expect(sql.calls[0].text).toContain('INSERT INTO task_labels')
    expect(sql.calls[0].values).toEqual(expect.arrayContaining([USER_ID, 'home', '#64748b']))
  })

  it('stores a chosen colour', async () => {
    const sql = createMockSql([[{ ...LABEL, taskCount: 0 }]])

    const response = await createTaskLabel(sql, USER_ID, { name: 'home', color: '#1A73E8' })

    expect(response.status).toBe(201)
    expect(sql.calls[0].values).toContain('#1a73e8')
  })

  it('rejects a bad name', async () => {
    const sql = createMockSql([])
    const response = await createTaskLabel(sql, USER_ID, { name: 'two words' })
    expect(response.status).toBe(400)
    expect(sql.calls).toHaveLength(0)
  })

  it('rejects a colour that is not a hex triplet', async () => {
    const sql = createMockSql([])
    const response = await createTaskLabel(sql, USER_ID, { name: 'home', color: 'blue' })
    expect(response.status).toBe(400)
  })

  // ON CONFLICT DO NOTHING returns no row when the name is taken.
  it('409s a name the caller already uses', async () => {
    const sql = createMockSql([[]])
    const response = await createTaskLabel(sql, USER_ID, { name: 'home' })
    expect(response.status).toBe(409)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd Cookie-Worker && npx vitest run workers/cookie-web-tasks/test/taskLabels.test.js`
Expected: FAIL — cannot resolve `../src/taskLabels.js`.

- [ ] **Step 3: Write the handlers**

```js
// src/taskLabels.js
// Managed labels for the Tasks app. task_items.labels keeps holding names
// (migration 0067); this table gives each name a row with a colour so it
// can be listed, renamed and deleted across every task. Shaped after
// projects.js: the same id validation, user-scoped statements and body
// shapes.

import { normalizeTaskLabels } from './taskMetadata.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLOR_RE = /^#[0-9a-f]{6}$/
export const DEFAULT_LABEL_COLOR = '#64748b'

/** @param {any} value */
function isUuid(value) {
  return value === String(value ?? '') && UUID_RE.test(value)
}

/**
 * One label name, normalised the way task writes normalise them, or null
 * when it cannot be a label.
 *
 * @param {any} value
 */
export function cleanLabelName(value) {
  if (typeof value !== 'string') return null
  try {
    return normalizeTaskLabels([value])[0] ?? null
  } catch {
    return null
  }
}

/** @param {any} value */
export function cleanColor(value) {
  if (typeof value !== 'string') return null
  const color = value.trim().toLowerCase()
  return COLOR_RE.test(color) ? color : null
}

const BAD_NAME = 'Labels must be 1–40 characters without spaces, @, or #'
const BAD_COLOR = 'color must be a hex colour such as #1a73e8'

/**
 * GET /task-labels — every label the caller owns, by name, each with how
 * many of the caller's tasks carry it (the sidebar's delete confirmation
 * reads that count).
 *
 * @param {import('postgres').Sql} sql
 * @param {string} userId
 */
export async function getTaskLabels(sql, userId) {
  const labels = await sql`
    SELECT l.id, l.name, l.color, l.created_at AS "createdAt",
           (SELECT count(*)::int FROM task_items t
             WHERE t.user_id = l.user_id AND t.labels @> ARRAY[l.name]) AS "taskCount"
    FROM task_labels l
    WHERE l.user_id = ${userId}
    ORDER BY l.name ASC
  `
  return Response.json({ labels })
}

/**
 * POST /task-labels — { name, color? }.
 *
 * @param {import('postgres').Sql} sql
 * @param {string} userId
 * @param {any} body
 */
export async function createTaskLabel(sql, userId, body) {
  const name = cleanLabelName(body?.name)
  if (!name) return Response.json({ error: BAD_NAME }, { status: 400 })
  const hasColor = body?.color !== undefined && body?.color !== null
  const color = hasColor ? cleanColor(body.color) : DEFAULT_LABEL_COLOR
  if (!color) return Response.json({ error: BAD_COLOR }, { status: 400 })

  const [label] = await sql`
    INSERT INTO task_labels (user_id, name, color)
    VALUES (${userId}, ${name}, ${color})
    ON CONFLICT (user_id, name) DO NOTHING
    RETURNING id, name, color, created_at AS "createdAt", 0 AS "taskCount"
  `
  if (!label) {
    return Response.json({ error: 'A label with that name already exists' }, { status: 409 })
  }
  return Response.json({ label }, { status: 201 })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd Cookie-Worker && npx vitest run workers/cookie-web-tasks/test/taskLabels.test.js`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
cd Cookie-Worker
git add workers/cookie-web-tasks/src/taskLabels.js workers/cookie-web-tasks/test/taskLabels.test.js
git commit -m "cookie-web-tasks: list and create task labels"
```

---

### Task 3: Worker — `PATCH` and `DELETE /task-labels`

**Files:**

- Modify: `Cookie-Worker/workers/cookie-web-tasks/src/taskLabels.js`
- Test: `Cookie-Worker/workers/cookie-web-tasks/test/taskLabels.test.js`

**Interfaces:**

- Consumes: `cleanLabelName`, `cleanColor`, `isUuid` from Task 2.
- Produces: `updateTaskLabel(sql, userId, body) → Response`, `deleteTaskLabel(sql, userId, body) → Response`. Both run inside `sql.begin`; the mock's `begin` runs the callback with the same queue.

- [ ] **Step 1: Write the failing tests** (append to `test/taskLabels.test.js`; extend the import to include `deleteTaskLabel, updateTaskLabel`)

```js
describe('PATCH /task-labels', () => {
  it('renames a label and rewrites it on every task that carries it', async () => {
    const sql = createMockSql([
      [{ id: LABEL_ID, name: 'home' }], // the owned row
      [], // no other label has the new name
      [{ id: LABEL_ID, name: 'house', color: '#1a73e8', createdAt: 't0' }],
      [], // task rewrite
    ])

    const response = await updateTaskLabel(sql, USER_ID, { id: LABEL_ID, name: '@House' })

    expect(response.status).toBe(200)
    expect((await response.json()).label.name).toBe('house')
    expect(sql.begin).toHaveBeenCalledTimes(1)
    const rewrite = sql.calls.find((call) => call.text.includes('array_replace'))
    expect(rewrite.text).toContain('UPDATE task_items')
    expect(rewrite.values).toEqual(expect.arrayContaining(['home', 'house', USER_ID]))
  })

  it('recolours without touching tasks', async () => {
    const sql = createMockSql([
      [{ id: LABEL_ID, name: 'home' }],
      [{ id: LABEL_ID, name: 'home', color: '#2f9e44', createdAt: 't0' }],
    ])

    const response = await updateTaskLabel(sql, USER_ID, { id: LABEL_ID, color: '#2F9E44' })

    expect(response.status).toBe(200)
    expect((await response.json()).label.color).toBe('#2f9e44')
    expect(sql.calls.some((call) => call.text.includes('array_replace'))).toBe(false)
  })

  it('409s a rename onto a name already in use', async () => {
    const sql = createMockSql([[{ id: LABEL_ID, name: 'home' }], [{ id: 'other' }]])
    const response = await updateTaskLabel(sql, USER_ID, { id: LABEL_ID, name: 'work' })
    expect(response.status).toBe(409)
  })

  it('404s an id the caller does not own', async () => {
    const sql = createMockSql([[]])
    const response = await updateTaskLabel(sql, USER_ID, { id: LABEL_ID, name: 'x' })
    expect(response.status).toBe(404)
  })

  it('rejects an empty change and bad values', async () => {
    expect((await updateTaskLabel(createMockSql([]), USER_ID, { id: LABEL_ID })).status).toBe(400)
    expect(
      (await updateTaskLabel(createMockSql([]), USER_ID, { id: LABEL_ID, name: 'a b' })).status,
    ).toBe(400)
    expect(
      (await updateTaskLabel(createMockSql([]), USER_ID, { id: LABEL_ID, color: 'red' })).status,
    ).toBe(400)
    expect(
      (await updateTaskLabel(createMockSql([]), USER_ID, { id: 'nope', name: 'x' })).status,
    ).toBe(400)
  })
})

describe('DELETE /task-labels', () => {
  it('deletes the label and strips it from every task', async () => {
    const sql = createMockSql([[{ name: 'home' }], []])

    const response = await deleteTaskLabel(sql, USER_ID, { id: LABEL_ID })

    expect(response.status).toBe(200)
    expect(sql.begin).toHaveBeenCalledTimes(1)
    const strip = sql.calls.find((call) => call.text.includes('array_remove'))
    expect(strip.text).toContain('UPDATE task_items')
    expect(strip.values).toEqual(expect.arrayContaining(['home', USER_ID]))
  })

  it('404s an id the caller does not own', async () => {
    const sql = createMockSql([[]])
    const response = await deleteTaskLabel(sql, USER_ID, { id: LABEL_ID })
    expect(response.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd Cookie-Worker && npx vitest run workers/cookie-web-tasks/test/taskLabels.test.js`
Expected: FAIL — `updateTaskLabel is not a function`.

- [ ] **Step 3: Append the handlers to `src/taskLabels.js`**

```js
/**
 * PATCH /task-labels — { id, name?, color? }. A rename rewrites the name
 * inside every task's labels array in the same transaction, so a task
 * never carries a name that no longer has a row. The explicit "name in
 * use" check is what keeps array_replace from ever producing a duplicate
 * inside one array.
 *
 * @param {import('postgres').Sql} sql
 * @param {string} userId
 * @param {any} body
 */
export async function updateTaskLabel(sql, userId, body) {
  const id = isUuid(body?.id) ? String(body.id) : null
  if (!id) return Response.json({ error: 'A valid label id is required' }, { status: 400 })
  const hasName = Object.hasOwn(body, 'name')
  const hasColor = Object.hasOwn(body, 'color')
  if (!hasName && !hasColor) {
    return Response.json({ error: 'At least one change is required' }, { status: 400 })
  }
  const name = hasName ? cleanLabelName(body.name) : null
  if (hasName && !name) return Response.json({ error: BAD_NAME }, { status: 400 })
  const color = hasColor ? cleanColor(body.color) : null
  if (hasColor && !color) return Response.json({ error: BAD_COLOR }, { status: 400 })

  return sql.begin(async (tx) => {
    const [existing] = await tx`
      SELECT id, name FROM task_labels WHERE id = ${id} AND user_id = ${userId} FOR UPDATE
    `
    if (!existing) return Response.json({ error: 'Label not found' }, { status: 404 })

    const renames = hasName && name !== existing.name
    if (renames) {
      const taken = await tx`
        SELECT id FROM task_labels WHERE user_id = ${userId} AND name = ${name}
      `
      if (taken.length) {
        return Response.json({ error: 'A label with that name already exists' }, { status: 409 })
      }
    }

    const [label] = await tx`
      UPDATE task_labels SET
        name  = CASE WHEN ${renames}::boolean THEN ${name} ELSE name END,
        color = CASE WHEN ${hasColor}::boolean THEN ${color} ELSE color END
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, name, color, created_at AS "createdAt"
    `
    if (renames) {
      await tx`
        UPDATE task_items
        SET labels = array_replace(labels, ${existing.name}, ${name}), updated_at = now()
        WHERE user_id = ${userId} AND labels @> ARRAY[${existing.name}]::text[]
      `
    }
    return Response.json({ label })
  })
}

/**
 * DELETE /task-labels — { id }. The name leaves every task that carried it
 * in the same transaction.
 *
 * @param {import('postgres').Sql} sql
 * @param {string} userId
 * @param {any} body
 */
export async function deleteTaskLabel(sql, userId, body) {
  const id = isUuid(body?.id) ? String(body.id) : null
  if (!id) return Response.json({ error: 'A valid label id is required' }, { status: 400 })

  return sql.begin(async (tx) => {
    const deleted = await tx`
      DELETE FROM task_labels WHERE id = ${id} AND user_id = ${userId} RETURNING name
    `
    if (!deleted.length) return Response.json({ error: 'Label not found' }, { status: 404 })
    await tx`
      UPDATE task_items
      SET labels = array_remove(labels, ${deleted[0].name}), updated_at = now()
      WHERE user_id = ${userId} AND labels @> ARRAY[${deleted[0].name}]::text[]
    `
    return Response.json({ ok: true })
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd Cookie-Worker && npx vitest run workers/cookie-web-tasks/test/taskLabels.test.js`
Expected: 13 passed.

- [ ] **Step 5: Commit**

```bash
cd Cookie-Worker
git add workers/cookie-web-tasks/src/taskLabels.js workers/cookie-web-tasks/test/taskLabels.test.js
git commit -m "cookie-web-tasks: rename, recolour and delete task labels across tasks"
```

---

### Task 4: Worker — route `/task-labels`

**Files:**

- Modify: `Cookie-Worker/workers/cookie-web-tasks/src/worker.js` (imports at top; add a block after the `/projects` block in `route`, and mention it in the `route` doc comment)
- Test: `Cookie-Worker/workers/cookie-web-tasks/test/worker.test.js`

**Interfaces:**

- Consumes: the four handlers from Tasks 2 and 3.

- [ ] **Step 1: Write the failing tests** (append to `test/worker.test.js`, after the `routing — /documents` describe; the file's `request()` helper and `mockQuery` are already in scope)

```js
describe('routing — /task-labels', () => {
  test('GET lists the caller labels', async () => {
    mockQuery.mockResolvedValueOnce([{ id: '1', name: 'home', color: '#64748b', taskCount: 0 }])

    const response = await worker.fetch(request('/task-labels'), env, ctx)

    expect(response.status).toBe(200)
    expect((await response.json()).labels).toHaveLength(1)
    const [strings] = mockQuery.mock.calls.find(
      ([s]) => Array.isArray(s) && s.join('').includes('FROM task_labels'),
    )
    expect(strings.join('')).toContain('task_labels')
  })

  test('POST creates a label from a JSON body', async () => {
    mockQuery.mockResolvedValueOnce([{ id: '1', name: 'home', color: '#64748b', taskCount: 0 }])

    const response = await worker.fetch(
      request('/task-labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'home' }),
      }),
      env,
      ctx,
    )

    expect(response.status).toBe(201)
  })

  test('refuses PUT with the allowed methods', async () => {
    const response = await worker.fetch(request('/task-labels', { method: 'PUT' }), env, ctx)
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET, POST, PATCH, DELETE')
  })

  test('has no sub-paths', async () => {
    const response = await worker.fetch(request('/task-labels/abc'), env, ctx)
    expect(response.status).toBe(404)
  })
})
```

If `mockQuery.mock.calls.find(...)` proves awkward against the file's existing assertion style, mirror the assertion used in the `routing — /documents` describe instead; the point is that the `task_labels` query ran.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd Cookie-Worker && npx vitest run workers/cookie-web-tasks/test/worker.test.js -t "task-labels"`
Expected: FAIL — GET returns 404.

- [ ] **Step 3: Route it in `src/worker.js`**

Add the import beside the projects import:

```js
import { createTaskLabel, deleteTaskLabel, getTaskLabels, updateTaskLabel } from './taskLabels.js'
```

Add `GET/POST/PATCH/DELETE /task-labels` to the `route` doc comment's list, then insert after the `if (segments[0] === 'projects') { ... }` block:

```js
if (segments[0] === 'task-labels') {
  if (segments.length > 1) return Response.json({ error: 'Not Found' }, { status: 404 })
  if (request.method === 'GET') return getTaskLabels(sql, userId)
  if (request.method !== 'POST' && request.method !== 'PATCH' && request.method !== 'DELETE') {
    return Response.json(
      { error: 'Method not allowed' },
      { status: 405, headers: { Allow: 'GET, POST, PATCH, DELETE' } },
    )
  }
  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    const errorResponse = bodyErrorResponse(error)
    if (errorResponse) return errorResponse
    throw error
  }
  if (request.method === 'POST') return createTaskLabel(sql, userId, body)
  if (request.method === 'PATCH') return updateTaskLabel(sql, userId, body)
  return deleteTaskLabel(sql, userId, body)
}
```

- [ ] **Step 4: Run the worker tests to verify they pass**

Run: `cd Cookie-Worker && npx vitest run workers/cookie-web-tasks/test/worker.test.js`
Expected: all pass, including the four new ones.

- [ ] **Step 5: Commit**

```bash
cd Cookie-Worker
git add workers/cookie-web-tasks/src/worker.js workers/cookie-web-tasks/test/worker.test.js
git commit -m "cookie-web-tasks: route /task-labels"
```

---

### Task 5: Worker — register label names on task writes

**Files:**

- Modify: `Cookie-Worker/workers/cookie-web-tasks/src/taskItems.js` (add `registerTaskLabels` near `fetchOwnedProject`; call it in `createTaskItemUnlocked` just before `INSERT INTO task_items`, and in `updateTaskItemUnlocked` just before `UPDATE task_items t SET`)
- Test: `Cookie-Worker/workers/cookie-web-tasks/test/taskItems.test.js`

**Interfaces:**

- Produces: `registerTaskLabels(sql, userId, names: string[]) → Promise<void>` (exported, no-op for an empty list).

- [ ] **Step 1: Update the two existing label tests and add two new ones**

In `'stores a local due time, its time zone, and normalized labels'`, the register insert now runs first, so queue one empty result ahead of the row and find the task insert by text:

```js
it('stores a local due time, its time zone, and normalized labels', async () => {
  const sql = createMockSql([
    [], // label registration
    [
      {
        id: ITEM_ID,
        content: 'Call plumber',
        dueDate: '2026-09-11',
        dueTime: '15:00',
        timeZone: 'Europe/London',
        labels: ['home'],
      },
    ],
  ])

  const response = await createTaskItem(sql, USER_ID, {
    content: 'Call plumber',
    dueDate: '2026-09-11',
    dueTime: '15:00',
    timeZone: 'Europe/London',
    labels: ['@Home', 'home'],
  })

  expect(response.status).toBe(201)
  const register = sql.calls.find((call) => call.text.includes('INSERT INTO task_labels'))
  expect(register.text).toContain('ON CONFLICT (user_id, name) DO NOTHING')
  expect(register.values).toEqual(expect.arrayContaining([USER_ID, ['home']]))
  const insert = sql.calls.find((call) => call.text.includes('INSERT INTO task_items'))
  expect(insert.text).toContain('due_time, time_zone, labels')
  expect(insert.values).toEqual(expect.arrayContaining(['15:00', 'Europe/London', ['home']]))
})

it('registers no labels when a task is created without any', async () => {
  const sql = createMockSql([[{ id: ITEM_ID, projectId: null, content: 'Ship it' }]])

  await createTaskItem(sql, USER_ID, { content: 'Ship it' })

  expect(sql.calls.some((call) => call.text.includes('INSERT INTO task_labels'))).toBe(false)
})
```

In `'updates due time and labels together'`, queue an empty result between the existing row and the updated row, and assert the registration:

```js
const sql = createMockSql([
  [existing],
  [], // label registration
  [[{ ...existing, dueTime: '15:00', timeZone: 'Europe/London', labels: ['home'] }]].flat(),
])
// ... unchanged request and assertions, then:
const register = sql.calls.find((call) => call.text.includes('INSERT INTO task_labels'))
expect(register.values).toEqual(expect.arrayContaining([USER_ID, ['home']]))
```

Add beside it:

```js
it('does not register labels on an update that leaves them alone', async () => {
  const existing = {
    id: ITEM_ID,
    projectId: null,
    parentId: null,
    kind: 'task',
    dueDate: null,
    dueTime: null,
    timeZone: null,
    labels: ['home'],
    recurrence: null,
    completedAt: null,
  }
  const sql = createMockSql([[existing], [{ ...existing, content: 'Renamed' }]])

  const response = await updateTaskItem(sql, USER_ID, { id: ITEM_ID, content: 'Renamed' })

  expect(response.status).toBe(200)
  expect(sql.calls.some((call) => call.text.includes('INSERT INTO task_labels'))).toBe(false)
})
```

- [ ] **Step 2: Run the file to verify the updated tests fail**

Run: `cd Cookie-Worker && npx vitest run workers/cookie-web-tasks/test/taskItems.test.js`
Expected: the two label tests fail (`register` is undefined); the two "no registration" tests pass already.

- [ ] **Step 3: Implement**

In `src/taskItems.js`, after `fetchOwnedProject`:

```js
/**
 * Give every label name on a task write a task_labels row (migration 0079)
 * so a label typed as @name in the add dialog shows up in the sidebar
 * with the default colour. Runs inside the task write's transaction, after
 * validation, so a refused write registers nothing.
 *
 * @param {import('postgres').Sql} sql
 * @param {string} userId
 * @param {string[]} names
 */
export async function registerTaskLabels(sql, userId, names) {
  if (!names.length) return
  await sql`
    INSERT INTO task_labels (user_id, name)
    SELECT ${userId}, unnest(${names}::text[])
    ON CONFLICT (user_id, name) DO NOTHING
  `
}
```

In `createTaskItemUnlocked`, immediately before `const [item] = await sql\`INSERT INTO task_items ...`:

```js
await registerTaskLabels(sql, userId, metadata.labels)
```

In `updateTaskItemUnlocked`, immediately before `const [item] = await sql\`UPDATE task_items t SET ...`:

```js
if (hasLabels) await registerTaskLabels(sql, userId, metadata.labels)
```

- [ ] **Step 4: Run the whole worker suite**

Run: `cd Cookie-Worker && npm test`
Expected: all pass. If another test in `taskItems.test.js` or `taskAi.test.js` creates a task with a non-empty `labels` body, it now needs one extra `[]` queued before the task row; fix each by adding the empty result and finding the task query by text rather than by index.

- [ ] **Step 5: Commit**

```bash
cd Cookie-Worker
git add workers/cookie-web-tasks/src/taskItems.js workers/cookie-web-tasks/test/taskItems.test.js
git commit -m "cookie-web-tasks: register label names on task writes"
```

---

### Task 6: Worker — `project=label:<name>` on the paged list

**Files:**

- Modify: `Cookie-Worker/workers/cookie-web-tasks/src/taskPages.js:13-19,47-55`
- Create: `Cookie-Worker/workers/cookie-web-tasks/test/taskPages.test.js`

**Interfaces:**

- Consumes: `cleanLabelName` from `src/taskLabels.js` (Task 2).
- Produces: `GET /task-items?project=label:<name>&view=page` filtered by containment.

`getTaskPage` composes nested `sql` fragments, which `createMockSql` would consume from its FIFO queue, so this test uses its own tiny mock: fragments return plain objects, and only the final query (the one whose text contains `LIMIT 101`) resolves rows.

- [ ] **Step 1: Write the failing tests**

```js
// test/taskPages.test.js
import { describe, expect, it } from 'vitest'
import { getTaskPage } from '../src/taskPages.js'

const USER_ID = '99999999-9999-9999-9999-999999999999'

/** @param {unknown[]} rows */
function createFragmentSql(rows) {
  /** @type {{text: string, values: unknown[]}[]} */
  const calls = []
  const sql = (/** @type {TemplateStringsArray} */ strings, /** @type {unknown[]} */ ...values) => {
    const text = strings.join('?')
    calls.push({ text, values })
    return text.includes('LIMIT 101') ? Promise.resolve(rows) : { text, values }
  }
  sql.calls = calls
  return /** @type {any} */ (sql)
}

function pageUrl(project) {
  return new URL(
    `https://tasks.example/task-items?view=page&project=${encodeURIComponent(project)}`,
  )
}

describe('GET /task-items?view=page with a label', () => {
  it('filters by label containment and orders like a project list', async () => {
    const sql = createFragmentSql([{ id: 't1', labels: ['home'], position: 1, cursor_time: 'x' }])

    const response = await getTaskPage(sql, USER_ID, pageUrl('label:Home'))

    expect(response.status).toBe(200)
    expect((await response.json()).items).toHaveLength(1)
    const filter = sql.calls.find((call) => call.text.includes('labels @> ARRAY[?]::text[]'))
    expect(filter.values).toEqual(['home'])
    expect(sql.calls.some((call) => call.text.includes('project_id'))).toBe(false)
  })

  it('rejects a label name that could never exist', async () => {
    const sql = createFragmentSql([])
    const response = await getTaskPage(sql, USER_ID, pageUrl('label:two words'))
    expect(response.status).toBe(400)
    expect(sql.calls).toHaveLength(0)
  })

  it('still refuses an unknown project value', async () => {
    const response = await getTaskPage(createFragmentSql([]), USER_ID, pageUrl('nonsense'))
    expect(response.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd Cookie-Worker && npx vitest run workers/cookie-web-tasks/test/taskPages.test.js`
Expected: first test FAILS with status 400 (label value refused as an invalid project).

- [ ] **Step 3: Implement the branch in `src/taskPages.js`**

Add the import:

```js
import { cleanLabelName } from './taskLabels.js'
```

Replace the start of `getTaskPage` up to the cursor parsing with:

```js
export async function getTaskPage(sql, userId, url) {
  const project = url.searchParams.get('project') ?? 'inbox';
  const today = project === 'today';
  // A label view: `label:<name>` filters across every project, ordered the
  // way a project list is.
  const isLabel = project.startsWith('label:');
  const label = isLabel ? cleanLabelName(project.slice('label:'.length)) : null;
  if (isLabel && !label) return Response.json({ error: 'Invalid label' }, { status: 400 });
  const date = url.searchParams.get('date');
  if (!['today', 'inbox'].includes(project) && !isLabel && !validId(project))
    return Response.json({ error: 'Invalid project' }, { status: 400 });
```

and change the filter fragment in the query to:

```js
      ${
        today
          ? sql`AND t.due_date <= ${date}::date`
          : label
            ? sql`AND t.labels @> ARRAY[${label}]::text[]`
            : project === 'inbox'
              ? sql`AND t.project_id IS NULL`
              : sql`AND t.project_id = ${project}::uuid`
      }
```

Everything else in the function (cursor, ordering, `LIMIT 101`, `nextCursor`) is unchanged; a label view uses the non-today ordering.

- [ ] **Step 4: Run the tests and the full worker checks**

Run: `cd Cookie-Worker && npx vitest run workers/cookie-web-tasks/test/taskPages.test.js && npm test && npm run lint && npm run format:check && npm run typecheck`
Expected: all pass. Fix any formatting with `npm run format`.

- [ ] **Step 5: Commit**

```bash
cd Cookie-Worker
git add workers/cookie-web-tasks/src/taskPages.js workers/cookie-web-tasks/test/taskPages.test.js
git commit -m "cookie-web-tasks: list tasks by label"
```

---

### Task 7: Web — shared palette and label name helpers

**Files:**

- Create: `Cookie-Web/src/lib/labelPalette.js`
- Create: `Cookie-Web/src/lib/taskLabels.js`
- Modify: `Cookie-Web/src/components/CategorySettings.vue:7-16` (replace the local `CATEGORY_PALETTE` array with an import)
- Test: `Cookie-Web/src/lib/__tests__/taskLabels.spec.js`

**Interfaces:**

- Produces: `LABEL_PALETTE: string[]`, `DEFAULT_LABEL_COLOR = '#64748b'`, `normalizeLabelName(value) → string` (empty string when invalid), `labelChipStyle(color) → { color, backgroundColor }`.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/__tests__/taskLabels.spec.js
import { describe, expect, it } from 'vitest'

import { DEFAULT_LABEL_COLOR, LABEL_PALETTE } from '../labelPalette'
import { labelChipStyle, normalizeLabelName } from '../taskLabels'

describe('normalizeLabelName', () => {
  it('lowercases, trims and drops a leading @', () => {
    expect(normalizeLabelName('  @Home ')).toBe('home')
  })

  it('returns an empty string for anything the server would refuse', () => {
    expect(normalizeLabelName('two words')).toBe('')
    expect(normalizeLabelName('#tag')).toBe('')
    expect(normalizeLabelName('a@b')).toBe('')
    expect(normalizeLabelName('')).toBe('')
    expect(normalizeLabelName(null)).toBe('')
    expect(normalizeLabelName('x'.repeat(41))).toBe('')
  })
})

describe('labelChipStyle', () => {
  it('tints the background from the text colour', () => {
    expect(labelChipStyle('#1a73e8')).toEqual({ color: '#1a73e8', backgroundColor: '#1a73e81f' })
  })

  it('falls back to the default colour', () => {
    expect(labelChipStyle(undefined).color).toBe(DEFAULT_LABEL_COLOR)
  })
})

describe('LABEL_PALETTE', () => {
  it('ends with the default colour so a new label always has a swatch', () => {
    expect(LABEL_PALETTE.at(-1)).toBe(DEFAULT_LABEL_COLOR)
    expect(LABEL_PALETTE).toHaveLength(8)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd Cookie-Web && npx vitest run src/lib/__tests__/taskLabels.spec.js`
Expected: FAIL — cannot resolve `../labelPalette`.

- [ ] **Step 3: Write the modules**

```js
// src/lib/labelPalette.js
// The eight colours a label or email category can take. Shared so a task
// label and a category pill read as the same family.
export const LABEL_PALETTE = [
  '#e5484d',
  '#e58f1a',
  '#2f9e44',
  '#1a73e8',
  '#7048e8',
  '#d6409f',
  '#0ca678',
  '#64748b',
]

// What a label gets when it is typed onto a task rather than created in
// the sidebar. Last in the palette so it always has a swatch.
export const DEFAULT_LABEL_COLOR = LABEL_PALETTE[7]
```

```js
// src/lib/taskLabels.js
import { DEFAULT_LABEL_COLOR } from './labelPalette'

// Mirrors the Worker's normalizeTaskLabels (taskMetadata.js): lowercase,
// trimmed, leading @ dropped, 1–40 characters, no whitespace, @ or #.
// Returns '' for anything the server would refuse, so callers never send
// a name that comes back as a 400.
const NAME_RE = /^[^\s@#]{1,40}$/

export function normalizeLabelName(value) {
  const name = String(value ?? '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase()
  return NAME_RE.test(name) ? name : ''
}

// Text in the label's colour on a 12% tint of it — the treatment category
// pills already use.
export function labelChipStyle(color) {
  const resolved = color || DEFAULT_LABEL_COLOR
  return { color: resolved, backgroundColor: `${resolved}1f` }
}
```

In `CategorySettings.vue`, delete the `CATEGORY_PALETTE` array and add:

```js
import { LABEL_PALETTE as CATEGORY_PALETTE } from '../lib/labelPalette'
```

- [ ] **Step 4: Run the tests**

Run: `cd Cookie-Web && npx vitest run src/lib/__tests__/taskLabels.spec.js src/components/__tests__/CategorySettings.spec.js`
Expected: pass (if no CategorySettings spec exists, run the lib spec alone).

- [ ] **Step 5: Commit**

```bash
cd Cookie-Web
git add src/lib/labelPalette.js src/lib/taskLabels.js src/lib/__tests__/taskLabels.spec.js src/components/CategorySettings.vue
git commit -m "Tasks: shared label palette and name normaliser"
```

---

### Task 8: Web — `taskLabels` store

**Files:**

- Create: `Cookie-Web/src/stores/taskLabels.js`
- Test: `Cookie-Web/src/stores/__tests__/taskLabels.spec.js`

**Interfaces:**

- Consumes: `TASKS_API_URL` (`src/lib/apiWorkers.js`), `jsonRequest` (`src/lib/jsonRequest.js`), `authHeaders` (`src/lib/authHeaders.js`), `useInboxStore().notify`, `useTaskItemsStore().items`.
- Produces: `useTaskLabelsStore` with state `labels: [{ id, name, color, taskCount, createdAt }]`, `isLoaded`, `isLoading`; getter `byName: Map<string, label>`; actions `loadLabels({ force })`, `createLabel({ name, color })`, `renameLabel(id, name)`, `recolourLabel(id, color)`, `deleteLabel(id) → boolean`.

- [ ] **Step 1: Write the failing tests**

```js
// src/stores/__tests__/taskLabels.spec.js
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTaskLabelsStore } from '../taskLabels'
import { useTaskItemsStore } from '../taskItems'
import { useInboxStore } from '../inbox'

const LABEL = { id: 'l1', name: 'home', color: '#1a73e8', taskCount: 2, createdAt: 't0' }

let store

beforeEach(() => {
  setActivePinia(createPinia())
  store = useTaskLabelsStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
})

function stubFetch(handler) {
  vi.stubGlobal('fetch', vi.fn(handler))
}

describe('task labels store', () => {
  it('loads once and refetches only when forced', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ labels: [LABEL] }) }))

    await store.loadLabels()
    await store.loadLabels()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('https://tasks-api.infinitywave.online/task-labels')
    expect(store.byName.get('home')).toEqual(LABEL)

    await store.loadLabels({ force: true })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('adds a created label in name order', async () => {
    store.labels = [{ ...LABEL, name: 'work' }]
    stubFetch(async () => ({ ok: true, json: async () => ({ label: LABEL }) }))

    const created = await store.createLabel({ name: 'home' })

    expect(created.id).toBe('l1')
    expect(store.labels.map((label) => label.name)).toEqual(['home', 'work'])
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ name: 'home', color: undefined })
  })

  it('renames a label and rewrites it on loaded tasks', async () => {
    store.labels = [{ ...LABEL }]
    const items = useTaskItemsStore()
    items.items = [
      { id: 't1', labels: ['home', 'calls'] },
      { id: 't2', labels: ['work'] },
    ]
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ label: { ...LABEL, name: 'house' } }),
    }))

    await store.renameLabel('l1', 'house')

    expect(store.labels[0].name).toBe('house')
    expect(store.labels[0].taskCount).toBe(2)
    expect(items.items[0].labels).toEqual(['house', 'calls'])
    expect(items.items[1].labels).toEqual(['work'])
  })

  it('rolls a failed rename back and notifies', async () => {
    store.labels = [{ ...LABEL }]
    const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})
    stubFetch(async () => ({ ok: false, status: 409, json: async () => ({ error: 'taken' }) }))

    const result = await store.renameLabel('l1', 'work')

    expect(result).toBeNull()
    expect(store.labels[0].name).toBe('home')
    expect(notify).toHaveBeenCalledWith('taken', 'error')
  })

  it('recolours optimistically', async () => {
    store.labels = [{ ...LABEL }]
    let resolve
    stubFetch(() => new Promise((r) => (resolve = r)))

    const pending = store.recolourLabel('l1', '#2f9e44')
    expect(store.labels[0].color).toBe('#2f9e44')
    resolve({ ok: true, json: async () => ({ label: { ...LABEL, color: '#2f9e44' } }) })
    await pending

    expect(store.labels[0].color).toBe('#2f9e44')
  })

  it('deletes a label and strips it from loaded tasks', async () => {
    store.labels = [{ ...LABEL }]
    const items = useTaskItemsStore()
    items.items = [{ id: 't1', labels: ['home', 'calls'] }]
    stubFetch(async () => ({ ok: true, json: async () => ({ ok: true }) }))

    expect(await store.deleteLabel('l1')).toBe(true)
    expect(store.labels).toEqual([])
    expect(items.items[0].labels).toEqual(['calls'])
  })

  it('restores a label whose delete failed', async () => {
    store.labels = [{ ...LABEL }]
    stubFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }))

    expect(await store.deleteLabel('l1')).toBe(false)
    expect(store.labels).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd Cookie-Web && npx vitest run src/stores/__tests__/taskLabels.spec.js`
Expected: FAIL — cannot resolve `../taskLabels`.

- [ ] **Step 3: Write the store**

```js
// src/stores/taskLabels.js
import { toRaw } from 'vue'
import { defineStore } from 'pinia'
import { jsonRequest } from '../lib/jsonRequest'

import { authHeaders as buildAuthHeaders } from '../lib/authHeaders'
import { TASKS_API_URL } from '../lib/apiWorkers'
import { useInboxStore } from './inbox'
import { useTaskItemsStore } from './taskItems'

const labelLoads = new WeakMap()

function byNameOrder(a, b) {
  return a.name.localeCompare(b.name)
}

// Managed task labels (task_labels, migration 0079). Shaped after
// stores/projects.js: the same auth headers and request helper, local state
// updated optimistically with a rollback when the server refuses. A task
// carries label names, not ids, so a rename or delete here also rewrites
// the labels on whatever tasks are loaded, matching what the server did.
export const useTaskLabelsStore = defineStore('taskLabels', {
  state: () => ({
    labels: [],
    isLoaded: false,
    isLoading: false,
  }),

  getters: {
    byName: (state) => new Map(state.labels.map((label) => [label.name, label])),
  },

  actions: {
    authHeaders(extra = {}) {
      return buildAuthHeaders(extra)
    },

    notify(message, kind = 'info') {
      useInboxStore().notify(message, kind)
    },

    async request(method, body) {
      const headers = await this.authHeaders(
        body !== undefined ? { 'Content-Type': 'application/json' } : {},
      )
      return jsonRequest(`${TASKS_API_URL}/task-labels`, { method, headers, body })
    },

    async loadLabels({ force = false } = {}) {
      if (this.isLoaded && !force) return
      const inFlight = labelLoads.get(toRaw(this))
      if (inFlight) return inFlight
      this.isLoading = true
      const load = (async () => {
        try {
          const { labels } = await this.request('GET')
          this.labels = [...labels].sort(byNameOrder)
          this.isLoaded = true
        } catch (error) {
          console.error('Failed to load labels:', error)
          this.notify('Failed to load labels.', 'error')
        } finally {
          this.isLoading = false
          labelLoads.delete(toRaw(this))
        }
      })()
      labelLoads.set(toRaw(this), load)
      return load
    },

    async createLabel({ name, color }) {
      await labelLoads.get(toRaw(this))
      try {
        const { label } = await this.request('POST', { name, color })
        this.labels = [...this.labels, label].sort(byNameOrder)
        return label
      } catch (error) {
        console.error('Failed to create label:', error)
        this.notify(error.userMessage || 'Failed to create the label.', 'error')
        return null
      }
    },

    async patchLabel(id, changes, failureMessage) {
      await labelLoads.get(toRaw(this))
      const label = this.labels.find((row) => row.id === id)
      if (!label) {
        this.notify(failureMessage, 'error')
        return null
      }
      const previous = { ...label }
      Object.assign(label, changes)
      try {
        const { label: updated } = await this.request('PATCH', { id, ...changes })
        Object.assign(label, updated)
        if (updated.name !== previous.name) {
          this.labels = [...this.labels].sort(byNameOrder)
          rewriteLoadedTasks((labels) =>
            labels.map((name) => (name === previous.name ? updated.name : name)),
          )
        }
        return label
      } catch (error) {
        console.error('Failed to update label:', error)
        Object.assign(label, previous)
        this.notify(error.userMessage || failureMessage, 'error')
        return null
      }
    },

    renameLabel(id, name) {
      return this.patchLabel(id, { name }, 'Failed to rename the label.')
    },

    recolourLabel(id, color) {
      return this.patchLabel(id, { color }, 'Failed to change the label colour.')
    },

    async deleteLabel(id) {
      await labelLoads.get(toRaw(this))
      const doomed = this.labels.find((row) => row.id === id)
      if (!doomed) return false
      const previous = this.labels
      this.labels = this.labels.filter((label) => label.id !== id)
      try {
        await this.request('DELETE', { id })
        rewriteLoadedTasks((labels) => labels.filter((name) => name !== doomed.name))
        return true
      } catch (error) {
        console.error('Failed to delete label:', error)
        this.labels = previous
        this.notify(error.userMessage || 'Failed to delete the label.', 'error')
        return false
      }
    },
  },
})

// Apply a label-array transform to every loaded task that has labels.
function rewriteLoadedTasks(transform) {
  const items = useTaskItemsStore()
  for (const item of items.items) {
    if (item.labels?.length) item.labels = transform(item.labels)
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd Cookie-Web && npx vitest run src/stores/__tests__/taskLabels.spec.js`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
cd Cookie-Web
git add src/stores/taskLabels.js src/stores/__tests__/taskLabels.spec.js
git commit -m "Tasks: label store with rename and delete propagation"
```

---

### Task 9: Web — the `label:` rule in the task items store

**Files:**

- Modify: `Cookie-Web/src/stores/taskItems.js:185-197` (`belongsToLoadedList`)
- Test: `Cookie-Web/src/stores/__tests__/taskItems.spec.js` (append a describe)

**Interfaces:**

- Produces: `belongsToLoadedList(item)` returns true for a `label:<name>` list when `item.labels` includes `name`.

- [ ] **Step 1: Write the failing test** (append)

```js
describe('a label list', () => {
  it('holds exactly the tasks that carry the label', () => {
    store.loadedProject = 'label:home'
    expect(store.belongsToLoadedList({ ...ITEM, labels: ['home', 'calls'] })).toBe(true)
    expect(store.belongsToLoadedList({ ...ITEM, labels: ['calls'] })).toBe(false)
    expect(store.belongsToLoadedList({ ...ITEM, labels: undefined })).toBe(false)
  })

  it('requests the label list with the value intact', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ items: [] }) }))

    await store.loadItems('label:home')

    expect(fetch.mock.calls[0][0]).toContain('project=label%3Ahome')
    expect(store.loadedProject).toBe('label:home')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd Cookie-Web && npx vitest run src/stores/__tests__/taskItems.spec.js -t "a label list"`
Expected: the first test FAILS (a `label:` list currently compares `projectId` against the string).

- [ ] **Step 3: Implement**

In `belongsToLoadedList`, after the `today` branch:

```js
// A label list spans every project: membership is the label itself.
if (this.loadedProject.startsWith('label:'))
  return Boolean(item.labels?.includes(this.loadedProject.slice('label:'.length)))
```

- [ ] **Step 4: Run the store tests**

Run: `cd Cookie-Web && npx vitest run src/stores/__tests__/taskItems.spec.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd Cookie-Web
git add src/stores/taskItems.js src/stores/__tests__/taskItems.spec.js
git commit -m "Tasks: a label list holds the tasks that carry the label"
```

---

### Task 10: Web — `TaskLabelPicker` component

**Files:**

- Create: `Cookie-Web/src/components/TaskLabelPicker.vue`
- Test: `Cookie-Web/src/components/__tests__/TaskLabelPicker.spec.js`

**Interfaces:**

- Consumes: `useTaskLabelsStore` (Task 8), `normalizeLabelName`, `labelChipStyle` (Task 7).
- Produces: `<TaskLabelPicker v-model="names" :disabled="bool" />` emitting `update:modelValue` with a new string array. DOM hooks: `.task-label-picker`, `.task-label-chip` (with `.task-label-chip-remove` button, aria-label `Remove <name>`), `.task-label-picker-input` (aria-label `Add label`), `.task-label-suggestions` listbox of `.task-label-suggestion` buttons.

- [ ] **Step 1: Write the failing tests**

```js
// src/components/__tests__/TaskLabelPicker.spec.js
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import TaskLabelPicker from '../TaskLabelPicker.vue'
import { useTaskLabelsStore } from '../../stores/taskLabels'

function mountPicker(modelValue = [], props = {}) {
  return mount(TaskLabelPicker, { props: { modelValue, ...props } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  const labels = useTaskLabelsStore()
  labels.labels = [
    { id: 'l1', name: 'calls', color: '#e5484d', taskCount: 1 },
    { id: 'l2', name: 'home', color: '#1a73e8', taskCount: 2 },
    { id: 'l3', name: 'house', color: '#2f9e44', taskCount: 0 },
  ]
  labels.isLoaded = true
})

describe('TaskLabelPicker', () => {
  it('renders the selected labels as coloured chips', () => {
    const wrapper = mountPicker(['home', 'unknown'])

    const chips = wrapper.findAll('.task-label-chip')
    expect(chips.map((chip) => chip.text())).toEqual(['@home', '@unknown'])
    expect(chips[0].attributes('style')).toContain('color: rgb(26, 115, 232)')
    // A name with no row falls back to the default grey.
    expect(chips[1].attributes('style')).toContain('color: rgb(100, 116, 139)')
  })

  it('suggests unselected labels matching the typed prefix', async () => {
    const wrapper = mountPicker(['home'])

    const input = wrapper.get('.task-label-picker-input')
    await input.trigger('focus')
    await input.setValue('ho')

    expect(wrapper.findAll('.task-label-suggestion').map((s) => s.text())).toEqual(['@house'])
  })

  it('adds a suggestion on click and clears the input', async () => {
    const wrapper = mountPicker(['home'])
    const input = wrapper.get('.task-label-picker-input')
    await input.trigger('focus')
    await input.setValue('c')

    await wrapper.get('.task-label-suggestion').trigger('mousedown')
    await wrapper.get('.task-label-suggestion').trigger('click')

    expect(wrapper.emitted('update:modelValue')[0]).toEqual([['home', 'calls']])
    expect(input.element.value).toBe('')
  })

  it('adds a normalised new name on Enter', async () => {
    const wrapper = mountPicker([])
    const input = wrapper.get('.task-label-picker-input')
    await input.setValue('@Errands')
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('update:modelValue')[0]).toEqual([['errands']])
  })

  it('ignores Enter on a name the server would refuse or that is already selected', async () => {
    const wrapper = mountPicker(['home'])
    const input = wrapper.get('.task-label-picker-input')
    await input.setValue('two words')
    await input.trigger('keydown', { key: 'Enter' })
    await input.setValue('home')
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('removes the last chip on Backspace in an empty input, and any chip by its button', async () => {
    const wrapper = mountPicker(['home', 'calls'])
    await wrapper.get('.task-label-picker-input').trigger('keydown', { key: 'Backspace' })
    expect(wrapper.emitted('update:modelValue')[0]).toEqual([['home']])

    await wrapper.get('[aria-label="Remove home"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')[1]).toEqual([['calls']])
  })

  it('disables the input and remove buttons when disabled', () => {
    const wrapper = mountPicker(['home'], { disabled: true })
    expect(wrapper.get('.task-label-picker-input').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.task-label-chip-remove').attributes('disabled')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd Cookie-Web && npx vitest run src/components/__tests__/TaskLabelPicker.spec.js`
Expected: FAIL — cannot resolve `../TaskLabelPicker.vue`.

- [ ] **Step 3: Write the component**

```vue
<script setup>
import { computed, onMounted, ref } from 'vue'

import { labelChipStyle, normalizeLabelName } from '../lib/taskLabels'
import { useTaskLabelsStore } from '../stores/taskLabels'

// Chips for the labels on a task, and an input that suggests the person's
// other labels as they type. Enter on a name no label has yet still adds
// it: the task write registers it server-side with the default colour.
const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const labels = useTaskLabelsStore()
onMounted(() => labels.loadLabels())

const query = ref('')
const focused = ref(false)

const suggestions = computed(() => {
  const prefix = query.value.trim().replace(/^@/, '').toLowerCase()
  return labels.labels
    .filter((label) => !props.modelValue.includes(label.name) && label.name.startsWith(prefix))
    .slice(0, 8)
})
const showSuggestions = computed(() => focused.value && suggestions.value.length > 0)

function chipStyle(name) {
  return labelChipStyle(labels.byName.get(name)?.color)
}

function add(value) {
  const name = normalizeLabelName(value)
  if (!name || props.modelValue.includes(name)) return
  emit('update:modelValue', [...props.modelValue, name])
  query.value = ''
}

function remove(name) {
  emit(
    'update:modelValue',
    props.modelValue.filter((label) => label !== name),
  )
}

function onKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault()
    if (query.value.trim()) add(query.value)
    else query.value = ''
  } else if (event.key === 'Backspace' && !query.value && props.modelValue.length) {
    remove(props.modelValue.at(-1))
  } else if (event.key === 'Escape') {
    focused.value = false
  }
}

// Picking a suggestion must not blur the input first, or the list closes
// before the click lands.
function pick(name) {
  add(name)
}
</script>

<template>
  <div class="task-label-picker">
    <span v-for="name in modelValue" :key="name" class="task-label-chip" :style="chipStyle(name)">
      @{{ name }}
      <button
        type="button"
        class="task-label-chip-remove"
        :aria-label="`Remove ${name}`"
        :disabled="disabled"
        @click="remove(name)"
      >
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </span>
    <input
      v-model="query"
      class="task-label-picker-input"
      aria-label="Add label"
      :placeholder="modelValue.length ? '' : 'Add label'"
      :disabled="disabled"
      autocomplete="off"
      @focus="focused = true"
      @blur="focused = false"
      @keydown="onKeydown"
    />
    <ul v-if="showSuggestions" class="task-label-suggestions" role="listbox" aria-label="Labels">
      <li v-for="label in suggestions" :key="label.id" role="option">
        <button
          type="button"
          class="task-label-suggestion"
          :style="labelChipStyle(label.color)"
          @mousedown.prevent
          @click="pick(label.name)"
        >
          @{{ label.name }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.task-label-picker {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  min-height: 32px;
  padding: 3px 6px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
}

.task-label-picker:focus-within {
  border-color: var(--text-secondary);
}

.task-label-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 4px 1px 7px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 18px;
}

.task-label-chip-remove {
  display: inline-flex;
  align-items: center;
  border: none;
  background: none;
  padding: 0;
  color: inherit;
  cursor: pointer;
  opacity: 0.7;
}

.task-label-chip-remove:hover {
  opacity: 1;
}

.task-label-chip-remove .material-symbols-outlined {
  font-size: 14px;
}

.task-label-picker-input {
  flex: 1;
  min-width: 90px;
  border: none;
  background: transparent;
  font: inherit;
  color: inherit;
  outline: none;
}

.task-label-suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 5;
  margin: 4px 0 0;
  padding: 4px;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 160px;
  max-width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  box-shadow: 0 6px 18px rgb(0 0 0 / 12%);
}

.task-label-suggestion {
  border: none;
  padding: 2px 8px;
  border-radius: 999px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
</style>
```

- [ ] **Step 4: Run the tests**

Run: `cd Cookie-Web && npx vitest run src/components/__tests__/TaskLabelPicker.spec.js`
Expected: 7 passed. If the colour assertion fails because jsdom keeps hex in the style attribute, change the two `toContain` checks to `'color: #1a73e8'` and `'color: #64748b'`.

- [ ] **Step 5: Commit**

```bash
cd Cookie-Web
git add src/components/TaskLabelPicker.vue src/components/__tests__/TaskLabelPicker.spec.js
git commit -m "Tasks: label picker with coloured chips and suggestions"
```

---

### Task 11: Web — the picker in the add dialog and detail panel

**Files:**

- Modify: `Cookie-Web/src/components/AddTaskDialog.vue` (script: remove `labelsText`; template: replace the Labels `<label>` block)
- Modify: `Cookie-Web/src/components/TaskDetailPanel.vue:149-170,505-516`
- Test: `Cookie-Web/src/components/__tests__/AddTaskDialog.spec.js`, `Cookie-Web/src/components/__tests__/TaskDetailPanel.spec.js`

**Interfaces:**

- Consumes: `TaskLabelPicker` (Task 10), `useTaskLabelsStore` (Task 8), `items.setLabels(id, labels)`.

- [ ] **Step 1: Update the tests**

In both spec files' `beforeEach`, mark the labels store loaded so the picker's mount-time load never hits `fetch`:

```js
import { useTaskLabelsStore } from '../../stores/taskLabels'
// inside beforeEach, after setActivePinia:
useTaskLabelsStore().isLoaded = true
```

In `TaskDetailPanel.spec.js`, replace `'shows and saves labels from the detail panel'`:

```js
it('shows the labels as chips and saves a change at once', async () => {
  seed([{ ...ITEMS[1], labels: ['home', 'errands'] }])
  const setLabels = vi.spyOn(items, 'setLabels').mockResolvedValue({})
  const wrapper = mountPanel()
  await flushPromises()

  expect(wrapper.findAll('.task-label-chip').map((chip) => chip.text())).toEqual([
    '@home',
    '@errands',
  ])
  const input = wrapper.get('.task-label-picker-input')
  await input.setValue('@Calls')
  await input.trigger('keydown', { key: 'Enter' })
  await flushPromises()

  expect(setLabels).toHaveBeenCalledWith('b', ['home', 'errands', 'calls'])
})
```

In `AddTaskDialog.spec.js`, add one test to the Advanced-form describe (the existing `parsedTask()` helper carries `labels: ['home']`):

```js
it('shows parsed labels as chips in the full form and sends any added one', async () => {
  vi.spyOn(items, 'interpretItem').mockResolvedValue(parsedTask())
  const create = vi.spyOn(items, 'createItem').mockResolvedValue({ id: 't1' })
  const wrapper = mountDialog()
  await wrapper.get('[aria-label="Describe your task"]').setValue('Call plumber @home')
  await wrapper.get('button.add-task-advanced').trigger('click')
  await flushPromises()

  expect(wrapper.findAll('.task-label-chip').map((chip) => chip.text())).toEqual(['@home'])
  const input = wrapper.get('.task-label-picker-input')
  await input.setValue('calls')
  await input.trigger('keydown', { key: 'Enter' })
  await wrapper.get('form').trigger('submit')
  await flushPromises()

  expect(create.mock.calls[0][0].labels).toEqual(['home', 'calls'])
  wrapper.unmount()
})
```

`mountDialog()` (attached to `document.body`), `[aria-label="Describe your task"]` and `button.add-task-advanced` are the helpers and selectors the spec already uses.

- [ ] **Step 2: Run both spec files to verify the new tests fail**

Run: `cd Cookie-Web && npx vitest run src/components/__tests__/AddTaskDialog.spec.js src/components/__tests__/TaskDetailPanel.spec.js`
Expected: the two new/replaced tests FAIL (no `.task-label-chip`).

- [ ] **Step 3: Wire the picker into `AddTaskDialog.vue`**

Script: import the picker, delete `const labelsText = ref('')`, delete the `labelsText.value = ...` line in `interpret()`, and in `submit()` replace the `labelsText` block with:

```js
if (draft.value.labels?.length) task.labels = draft.value.labels
```

Template: replace

```html
<label
  >Labels<input
    v-model="labelsText"
    aria-label="Labels"
    placeholder="@home @errands"
    :disabled="isSaving"
/></label>
```

with

```html
<div class="add-task-labels">
  <span class="add-task-labels-title">Labels</span>
  <TaskLabelPicker v-model="draft.labels" :disabled="isSaving" />
</div>
```

and add to the scoped style, beside `.add-task-fields label`:

```css
.add-task-labels {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.add-task-labels-title {
  font-size: 12px;
  color: var(--text-secondary);
}
```

Keep the helper text "Use p1–p4, #Project and @label" as is.

- [ ] **Step 4: Wire the picker into `TaskDetailPanel.vue`**

Replace the `labelsDraft` / `saveLabels` script block (lines 149–170) with:

```js
// Labels save on every change: chips have no blur to wait for, and each
// change is one small PATCH the store serialises per task.
const savingLabels = ref(false)
async function onLabelsChange(labels) {
  if (savingLabels.value) return
  savingLabels.value = true
  try {
    await items.setLabels(props.taskId, labels)
  } finally {
    savingLabels.value = false
  }
}
```

Import `TaskLabelPicker` and replace the Labels field's `<input ... class="task-panel-labels-input" ...>` with:

```html
<TaskLabelPicker
  :model-value="item?.labels ?? []"
  :disabled="savingLabels"
  @update:model-value="onLabelsChange"
/>
```

Remove the now-unused `.task-panel-labels-input` style rule.

- [ ] **Step 5: Run the tests and lint**

Run: `cd Cookie-Web && npx vitest run src/components/__tests__/AddTaskDialog.spec.js src/components/__tests__/TaskDetailPanel.spec.js && npm run lint`
Expected: all pass, lint clean (an unused `watch` import in the panel must be removed if lint flags it).

- [ ] **Step 6: Commit**

```bash
cd Cookie-Web
git add src/components/AddTaskDialog.vue src/components/TaskDetailPanel.vue src/components/__tests__/AddTaskDialog.spec.js src/components/__tests__/TaskDetailPanel.spec.js
git commit -m "Tasks: pick labels from chips in the add dialog and detail panel"
```

---

### Task 12: Web — Labels section in the Tasks sidebar

**Files:**

- Modify: `Cookie-Web/src/components/TasksSidebar.vue` (script additions; template block after the projects `<nav>`; styles)
- Test: `Cookie-Web/src/components/__tests__/TasksSidebar.spec.js`

**Interfaces:**

- Consumes: `useTaskLabelsStore` (Task 8), `LABEL_PALETTE` (Task 7), `normalizeLabelName` (Task 7).
- Produces DOM: `.tasks-labels-nav` with `.nav-item.label-item` rows (href `/tasks?project=label:<name>`), `.label-dot` button (aria-label `Change colour of <name>`), `.label-swatches` group of `.label-color-swatch` buttons, `.new-label-btn` (aria-label `New label`), `.new-label-row` form with input aria-label `New label name`, delete button aria-label `Delete label <name>`.

- [ ] **Step 1: Write the failing tests** (append a describe; also change the file's `beforeEach` fetch stub to return `{ projects: [], labels: [] }`)

```js
import { useTaskLabelsStore } from '../../stores/taskLabels'

describe('the Labels section', () => {
  function seedLabels(labels) {
    const store = useTaskLabelsStore()
    store.labels = labels
    store.isLoaded = true
    return store
  }

  it('lists labels with their colour, linking to the label view', async () => {
    seedLabels([
      { id: 'l1', name: 'home', color: '#1a73e8', taskCount: 2 },
      { id: 'l2', name: 'work', color: '#e5484d', taskCount: 0 },
    ])
    const wrapper = mountSidebar()
    await flushPromises()

    const rows = wrapper.findAll('.tasks-labels-nav .label-item')
    expect(rows.map((row) => row.text())).toEqual(['home', 'work'])
    expect(rows[0].attributes('href')).toBe('/tasks?project=label%3Ahome')
    expect(rows[0].get('.label-dot').attributes('style')).toContain('rgb(26, 115, 232)')
  })

  it('marks the viewed label active', async () => {
    seedLabels([{ id: 'l1', name: 'home', color: '#1a73e8', taskCount: 0 }])
    await router.push('/tasks?project=label:home')
    const wrapper = mountSidebar()
    await flushPromises()

    expect(wrapper.get('.label-item').classes()).toContain('active')
    expect(wrapper.get('.tasks-views-nav .nav-item').classes()).not.toContain('active')
  })

  it('creates a label from the inline row, once, with the name normalised', async () => {
    const store = seedLabels([])
    const create = vi.spyOn(store, 'createLabel').mockResolvedValue({ id: 'l1', name: 'home' })
    const wrapper = mountSidebar()
    await flushPromises()

    await wrapper.get('[aria-label="New label"]').trigger('click')
    const input = wrapper.get('[aria-label="New label name"]')
    await input.setValue('@Home')
    await input.trigger('keydown', { key: 'Enter' })
    await input.trigger('blur')

    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({ name: 'home' })
  })

  it('renames on double-click', async () => {
    const store = seedLabels([{ id: 'l1', name: 'home', color: '#1a73e8', taskCount: 0 }])
    const rename = vi.spyOn(store, 'renameLabel').mockResolvedValue({})
    const wrapper = mountSidebar()
    await flushPromises()

    await wrapper.get('.label-item').trigger('dblclick')
    const input = wrapper.get('[aria-label="Rename home"]')
    await input.setValue('House')
    await input.trigger('keydown', { key: 'Enter' })

    expect(rename).toHaveBeenCalledWith('l1', 'house')
  })

  it('recolours from the swatches behind the dot', async () => {
    const store = seedLabels([{ id: 'l1', name: 'home', color: '#1a73e8', taskCount: 0 }])
    const recolour = vi.spyOn(store, 'recolourLabel').mockResolvedValue({})
    const wrapper = mountSidebar()
    await flushPromises()

    expect(wrapper.find('.label-swatches').exists()).toBe(false)
    await wrapper.get('.label-dot').trigger('click')
    const swatches = wrapper.findAll('.label-swatches .label-color-swatch')
    expect(swatches).toHaveLength(8)
    await swatches[2].trigger('click')

    expect(recolour).toHaveBeenCalledWith('l1', '#2f9e44')
    expect(wrapper.find('.label-swatches').exists()).toBe(false)
  })

  it('confirms before deleting a label that tasks carry, naming the count', async () => {
    const store = seedLabels([{ id: 'l1', name: 'home', color: '#1a73e8', taskCount: 3 }])
    const remove = vi.spyOn(store, 'deleteLabel').mockResolvedValue(true)
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    const wrapper = mountSidebar()
    await flushPromises()

    await wrapper.get('[aria-label="Delete label home"]').trigger('click')

    expect(confirm).toHaveBeenCalledWith('Remove @home from 3 tasks and delete it?')
    expect(remove).not.toHaveBeenCalled()
  })

  it('deletes an unused label without asking and routes away from its view', async () => {
    const store = seedLabels([{ id: 'l1', name: 'home', color: '#1a73e8', taskCount: 0 }])
    vi.spyOn(store, 'deleteLabel').mockResolvedValue(true)
    const confirm = vi.fn()
    vi.stubGlobal('confirm', confirm)
    await router.push('/tasks?project=label:home')
    const wrapper = mountSidebar()
    await flushPromises()

    await wrapper.get('[aria-label="Delete label home"]').trigger('click')
    await flushPromises()

    expect(confirm).not.toHaveBeenCalled()
    expect(router.currentRoute.value.query.project).toBe('inbox')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd Cookie-Web && npx vitest run src/components/__tests__/TasksSidebar.spec.js -t "Labels section"`
Expected: all seven FAIL (no `.tasks-labels-nav`).

- [ ] **Step 3: Script additions in `TasksSidebar.vue`**

Imports:

```js
import { LABEL_PALETTE } from '../lib/labelPalette'
import { normalizeLabelName } from '../lib/taskLabels'
import { useTaskLabelsStore } from '../stores/taskLabels'
```

After `const taskItems = useTaskItemsStore()`:

```js
const labelsStore = useTaskLabelsStore()
```

Change `onMounted(() => store.loadProjects())` to:

```js
onMounted(() => {
  store.loadProjects()
  labelsStore.loadLabels()
})
```

After `removeProject`, add:

```js
// --- Labels ---
// Same shape as the projects section: an inline create row, double-click
// to rename, hover to delete. Names are normalised here so the server is
// never asked to store one it would refuse.
const newLabelOpen = ref(false)
const newLabelName = ref('')
const newLabelInput = ref(null)

async function showNewLabel() {
  newLabelOpen.value = true
  newLabelName.value = ''
  await nextTick()
  newLabelInput.value?.focus()
}

async function submitNewLabel() {
  // Enter submits and unmounts the input, which fires blur; the second call
  // must be a no-op or every Enter would create the label twice.
  if (!newLabelOpen.value) return
  const name = normalizeLabelName(newLabelName.value)
  newLabelOpen.value = false
  if (!name) return
  await labelsStore.createLabel({ name })
}

const renamingLabelId = ref(null)
const renameLabelName = ref('')
const renameLabelInput = ref(null)

async function startRenameLabel(label) {
  renamingLabelId.value = label.id
  renameLabelName.value = label.name
  await nextTick()
  renameLabelInput.value?.[0]?.focus?.()
  renameLabelInput.value?.[0]?.select?.()
}

async function submitRenameLabel(label) {
  if (renamingLabelId.value !== label.id) return
  const name = normalizeLabelName(renameLabelName.value)
  renamingLabelId.value = null
  if (name && name !== label.name) await labelsStore.renameLabel(label.id, name)
}

// The dot opens a row of swatches under the label; picking one closes it.
const recolouringId = ref(null)

function toggleSwatches(label) {
  recolouringId.value = recolouringId.value === label.id ? null : label.id
}

async function pickLabelColour(label, color) {
  recolouringId.value = null
  if (color !== label.color) await labelsStore.recolourLabel(label.id, color)
}

// Deleting strips the label from every task that carries it, so the count
// is named first. A label on no task just goes.
async function removeLabel(label) {
  if (label.taskCount) {
    const plural = label.taskCount === 1 ? 'task' : 'tasks'
    if (!confirm(`Remove @${label.name} from ${label.taskCount} ${plural} and delete it?`)) return
  }
  const viewing = selectedProject.value === `label:${label.name}`
  const deleted = await labelsStore.deleteLabel(label.id)
  if (deleted && viewing) router.push('/tasks?project=inbox')
}
```

- [ ] **Step 4: Template block** (insert after the projects `</nav>`, before `</aside>`)

```html
<div class="sb-section-label tasks-projects-label">
  <span>Labels</span>
  <button
    class="new-project-btn new-label-btn"
    type="button"
    title="New label"
    aria-label="New label"
    @click.stop="showNewLabel"
  >
    <span class="material-symbols-outlined" aria-hidden="true">add</span>
  </button>
</div>
<nav class="sidebar-nav tasks-labels-nav" aria-label="Labels">
  <template v-for="label in labelsStore.labels" :key="label.id">
    <router-link
      :to="{ path: '/tasks', query: { project: `label:${label.name}` } }"
      class="nav-item project-item label-item"
      :class="{ active: selectedProject === `label:${label.name}` }"
      @dblclick.prevent="startRenameLabel(label)"
    >
      <button
        type="button"
        class="label-dot"
        :style="{ backgroundColor: label.color }"
        :aria-label="`Change colour of ${label.name}`"
        :aria-expanded="recolouringId === label.id"
        @click.prevent.stop="toggleSwatches(label)"
      ></button>
      <input
        v-if="renamingLabelId === label.id"
        ref="renameLabelInput"
        v-model="renameLabelName"
        class="project-rename-input"
        :aria-label="`Rename ${label.name}`"
        @click.prevent.stop
        @keydown.enter.prevent="submitRenameLabel(label)"
        @keydown.escape="renamingLabelId = null"
        @blur="submitRenameLabel(label)"
      />
      <span v-else class="nav-text">{{ label.name }}</span>
      <span class="row-actions" @click.prevent.stop>
        <button
          class="row-action-btn"
          data-action="delete"
          :title="`Delete ${label.name}`"
          :aria-label="`Delete label ${label.name}`"
          @click="removeLabel(label)"
        >
          <span class="material-symbols-outlined" aria-hidden="true">delete</span>
        </button>
      </span>
    </router-link>
    <div
      v-if="recolouringId === label.id"
      class="label-swatches"
      role="group"
      :aria-label="`Colour for ${label.name}`"
    >
      <button
        v-for="color in LABEL_PALETTE"
        :key="color"
        type="button"
        class="label-color-swatch"
        :class="{ selected: label.color === color }"
        :style="{ backgroundColor: color }"
        :title="color"
        :aria-label="`Use ${color}`"
        @click="pickLabelColour(label, color)"
      ></button>
    </div>
  </template>
  <form v-if="newLabelOpen" class="new-project-row new-label-row" @submit.prevent="submitNewLabel">
    <input
      ref="newLabelInput"
      v-model="newLabelName"
      class="project-rename-input"
      placeholder="Label name"
      aria-label="New label name"
      @keydown.enter.prevent="submitNewLabel"
      @keydown.escape="newLabelOpen = false"
      @blur="submitNewLabel"
    />
  </form>
  <p v-if="!labelsStore.labels.length && !newLabelOpen" class="tasks-projects-empty">
    No labels yet
  </p>
</nav>
```

The row reuses `project-item` so the existing hover `row-actions` styling applies; `label-item` rows are not draggable and have no `project-arrow`.

- [ ] **Step 5: Styles** (append to the scoped style)

```css
.tasks-labels-nav {
  margin-top: 2px;
}

.label-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  margin: 0 4px;
  border: none;
  border-radius: 50%;
  padding: 0;
  cursor: pointer;
}

.label-dot:focus-visible {
  outline: 2px solid var(--text-secondary);
  outline-offset: 2px;
}

.label-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 10px 8px 28px;
}

.label-color-swatch {
  width: 18px;
  height: 18px;
  border: 2px solid transparent;
  border-radius: 50%;
  padding: 0;
  cursor: pointer;
}

.label-color-swatch.selected {
  border-color: var(--text-primary);
}
```

- [ ] **Step 6: Run the sidebar tests and lint**

Run: `cd Cookie-Web && npx vitest run src/components/__tests__/TasksSidebar.spec.js && npm run lint`
Expected: all pass (the earlier tests still pass with the `{ projects: [], labels: [] }` stub).

- [ ] **Step 7: Commit**

```bash
cd Cookie-Web
git add src/components/TasksSidebar.vue src/components/__tests__/TasksSidebar.spec.js
git commit -m "Tasks sidebar: Labels section with create, rename, recolour and delete"
```

---

### Task 13: Web — the label view and coloured chips in `TasksView`

**Files:**

- Modify: `Cookie-Web/src/views/TasksView.vue` (script rules at ~35–50 and `canAddDividers`; template header/title/description; chips at ~493 and group headers; styles)
- Test: `Cookie-Web/src/views/__tests__/TasksView.spec.js`

**Interfaces:**

- Consumes: `useTaskLabelsStore` (Task 8), `labelChipStyle` (Task 7), `belongsToLoadedList` label rule (Task 9).
- Produces DOM: `.tasks-title-label` chip for a label view; `.task-label` chips carry an inline `color`; `.task-column-dot` in group headers.

- [ ] **Step 1: Write the failing tests** (append; change the file's fetch stub to return `{ items: [], projects: [], labels: [] }`)

```js
import { useTaskLabelsStore } from '../../stores/taskLabels'

describe('a label view', () => {
  beforeEach(() => {
    const labels = useTaskLabelsStore()
    labels.labels = [{ id: 'l1', name: 'home', color: '#1a73e8', taskCount: 1 }]
    labels.isLoaded = true
  })

  it('loads the label list and titles the view with the label', async () => {
    const items = useTaskItemsStore()
    const load = vi.spyOn(items, 'loadItems').mockResolvedValue()
    await router.push('/tasks?project=label:home')
    const wrapper = mountView()
    await flushPromises()

    expect(load).toHaveBeenCalledWith('label:home')
    const title = wrapper.get('.tasks-title-label')
    expect(title.text()).toBe('@home')
    expect(title.attributes('style')).toContain('rgb(26, 115, 232)')
    expect(wrapper.get('.tasks-breadcrumb').text()).toContain('Labels')
    expect(wrapper.find('.tasks-description').exists()).toBe(false)
  })

  it('offers no divider plus in a label list', async () => {
    await router.push('/tasks?project=label:home')
    const wrapper = mountView()
    await flushPromises()
    const items = useTaskItemsStore()
    items.items = [
      { id: 'a', content: 'One', labels: ['home'] },
      { id: 'b', content: 'Two', labels: ['home'] },
    ]
    await flushPromises()

    expect(wrapper.find('.task-insert').exists()).toBe(false)
  })
})

describe('label colours', () => {
  it('colours chips and group headers from the label store', async () => {
    const labels = useTaskLabelsStore()
    labels.labels = [{ id: 'l1', name: 'home', color: '#1a73e8', taskCount: 1 }]
    labels.isLoaded = true
    const wrapper = mountView()
    await flushPromises()
    const items = useTaskItemsStore()
    items.items = [{ id: 'a', content: 'One', priority: 4, labels: ['home', 'calls'] }]
    await flushPromises()

    const chips = wrapper.findAll('.task-label')
    expect(chips[0].attributes('style')).toContain('rgb(26, 115, 232)')
    // A name with no row keeps the default grey.
    expect(chips[1].attributes('style')).toContain('rgb(100, 116, 139)')

    await wrapper.get('.display-layouts button:last-child').trigger('click')
    await wrapper.get('[aria-label="Group tasks by"]').setValue('labels')
    await flushPromises()
    const dot = wrapper.get('.task-column-title .task-column-dot')
    expect(dot.attributes('style')).toContain('rgb(26, 115, 232)')
  })
})
```

`.task-insert` is the `<li>` that `offersDividerAfter(index)` renders between rows; it is absent whenever `canAddDividers` is false.

- [ ] **Step 2: Run to verify failure**

Run: `cd Cookie-Web && npx vitest run src/views/__tests__/TasksView.spec.js -t "label"`
Expected: the three new tests FAIL.

- [ ] **Step 3: Script changes**

Imports:

```js
import { labelChipStyle } from '../lib/taskLabels'
import { useTaskLabelsStore } from '../stores/taskLabels'
```

After `const isToday = ...`:

```js
// A label view is a rule too: it lists every task carrying the label,
// across projects, so there is nothing to rename or describe and no single
// project a divider could belong to.
const isLabel = computed(() => project.value.startsWith('label:'))
const labelName = computed(() => (isLabel.value ? project.value.slice('label:'.length) : ''))
const labels = useTaskLabelsStore()
const labelStyle = computed(() => labelChipStyle(labels.byName.get(labelName.value)?.color))
```

Change `isRule` to:

```js
const isRule = computed(() => isInbox.value || isToday.value || isLabel.value)
```

Change `title` to:

```js
const title = computed(() => {
  if (isToday.value) return 'Today'
  if (isLabel.value) return `@${labelName.value}`
  return isInbox.value ? 'Inbox' : (current.value?.name ?? '')
})
```

Change `canAddDividers` to:

```js
const canAddDividers = computed(
  () => taskLayout.value === 'list' && !isToday.value && !isLabel.value,
)
```

Add a helper beside `labelOf`:

```js
function labelStyleOf(name) {
  return labelChipStyle(labels.byName.get(name)?.color)
}
```

In `taskGroups`, give each label group its colour:

```js
    ...labels.map((label) => ({
      id: `label:${label}`,
      name: label,
      style: labelStyleOf(label),
      items: tasks.filter((item) => item.labels?.includes(label)),
    })),
```

(Rename the local `labels` array inside `taskGroups` to `labelNames` first, since `labels` is now the store.)

- [ ] **Step 4: Template changes**

Breadcrumb: replace `<span>My Projects</span>` with `<span>{{ isLabel ? 'Labels' : 'My Projects' }}</span>`.

Title: replace the `<h1 v-else ...>` line with:

```html
<h1 v-else-if="isLabel" class="tasks-title">
  <span class="tasks-title-label" :style="labelStyle">{{ title }}</span>
</h1>
<h1 v-else class="tasks-title" @click="titleEdit.start">{{ title }}</h1>
```

Chips: replace the inner `<span v-for="label in item.labels" ... class="task-label">` with:

```html
<span v-for="label in item.labels" :key="label" class="task-label" :style="labelStyleOf(label)">
  @{{ label }}
</span>
```

Group header: inside `<h2 v-if="taskLayout === 'board'" class="task-column-title">`, before the group name, add:

```html
<span
  v-if="group.style"
  class="task-column-dot"
  :style="{ backgroundColor: group.style.color }"
  aria-hidden="true"
></span>
```

Styles: in `.task-label`, remove the fixed `background` and `color` declarations (the inline style now sets both), and add:

```css
.tasks-title-label {
  display: inline-block;
  padding: 2px 12px;
  border-radius: 999px;
  font-size: 0.85em;
}

.task-column-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 6px;
  border-radius: 50%;
  vertical-align: middle;
}
```

- [ ] **Step 5: Run the view tests and the whole web suite**

Run: `cd Cookie-Web && npx vitest run src/views/__tests__/TasksView.spec.js && npx vitest run && npm run lint && npm run format:check`
Expected: all pass. The existing `'shows a due time and labels on the task row'` test still sees `['@home', '@calls']`.

- [ ] **Step 6: Commit**

```bash
cd Cookie-Web
git add src/views/TasksView.vue src/views/__tests__/TasksView.spec.js
git commit -m "Tasks: label view and coloured label chips"
```

---

### Task 14: Docs, verification and rollout

**Files:**

- Modify: `Cookie-Docs/docs/03-data-model.mdx` (schema areas table)
- Modify: `Cookie-Docs/docs/02-components/01-cookie-web.mdx` (Tasks paragraph)
- Modify: `Cookie-Web/docs/superpowers/specs/2026-09-20-task-labels-design.md` (status line)

- [ ] **Step 1: Cookie-Docs**

In the schema areas table, after the "User-authored tasks" row, add:

```markdown
| Task labels | `0079` | `task_labels`: one row per user-defined label with a colour, keyed by `(user_id, name)`; `task_items.labels` keeps the names, and a rename or delete rewrites them across tasks in one transaction |
```

In the Tasks paragraph of `01-cookie-web.mdx`, after "subtasks through the task panel." add:

```markdown
Labels are managed from a Labels section in the Tasks sidebar: each has a colour, click one to list its tasks across projects, and rename or delete it everywhere at once. Tasks take labels from a chip picker that suggests existing ones; a new name typed as `@name` is registered with the default colour.
```

Run whatever lint/format Cookie-Docs' `package.json` defines (check `scripts`), then commit in Cookie-Docs:

```bash
cd Cookie-Docs && git add docs && git commit -m "Docs: managed task labels"
```

- [ ] **Step 2: Spec status**

Change the spec's status line to `Status: implemented (Cookie-Worker + Cookie-Web, September 2026).` and commit it with the final web commit.

- [ ] **Step 3: Full verification, both repos**

Run in Cookie-Worker: `npm test && npm run lint && npm run format:check && npm run typecheck`
Run in Cookie-Web: `npx vitest run && npm run lint && npm run format:check && npm run build`
Expected: everything green. Report the exact counts.

- [ ] **Step 4: Rollout in order**

1. `cd Cookie-Web && git push origin main` — the Migrate Database workflow applies `0079`; watch it with `gh run list --workflow "Migrate Database" -L 1` and `gh run watch`.
2. `cd Cookie-Worker && git push origin main`, then `gh workflow run Deploy` and watch it. Confirm with `curl -s -o /dev/null -w "%{http_code}" https://tasks-api.infinitywave.online/task-labels` (expect 401, not 404).
3. Cookie-Web deploys from the push in step 1. Load the Tasks app, confirm the Labels section lists the seeded labels, create one, recolour it, tag a task from the detail panel, open the label view, rename and delete.

```

```
