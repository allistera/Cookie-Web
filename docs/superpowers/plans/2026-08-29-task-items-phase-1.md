# Task Items Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Tasks view a working list — create tasks in a project or the Inbox, see them with their descriptions, and complete them.

**Architecture:** A `task_items` table owned entirely by the user, served by `/task-items` on the existing `cookie-web-tasks` Worker, read into a Pinia store, and rendered by `TasksView` as a project header (breadcrumb, editable title and description) above a task list with an inline composer.

**Tech Stack:** Cloudflare Workers + postgres.js (Cookie-Worker), Vue 3 + Pinia + Vite (Cookie-Web), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-29-task-items-design.md`

## Global Constraints

- **Two repos.** Paths starting `workers/` are in `Cookie-Worker`; everything else is in `Cookie-Web`. Siblings under `~/Development/Projects/Cookie/`.
- **Push straight to `main`** in both repos. No PRs.
- **Before any push to Cookie-Web:** `npx vitest run` **and `npm run build`**. The build enforces a 150000-byte entry-chunk budget; tests alone will not catch a violation. **Never raise the budget.**
- **Before any push to Cookie-Worker:** `npm test`, `npm run lint`, `npm run typecheck`.
- **Formatting:** `npx prettier --write` on every file touched. Cookie-Web also runs `npx oxlint .`, whose `anti-slop` rules reject runtime `typeof` narrowing — coerce at the boundary (`String(value ?? '')`).
- **`/task-items`, never `/tasks`.** `/tasks` is AI Today's gathered-items endpoint and keeps that meaning. The two never share a row.
- **`project_id IS NULL` is the Inbox.** No seeded row, no special-casing beyond the filter.
- **Completion never deletes.** `completed: true` stamps `completed_at`; `false` clears it.
- **Out of scope for phase 1** (do not build): the detail panel, sub-task UI, labels, comments, reminders, the Display menu, the project `⋯` menu.
- Commit messages: imperative, sentence case, no `feat:`/`chore:` prefix, ending with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

### Task 1: Migration for `task_items`

**Files:**

- Create: `migrations/0054_task_items.sql`

**Interfaces:**

- Consumes: `task_projects` (migration 0053), `users`.
- Produces: table `public.task_items` and a new `description` column on `public.task_projects`.

- [ ] **Step 1: Write the migration**

Create `migrations/0054_task_items.sql`:

```sql
-- Cookie-owned tasks: the ones a person writes, as opposed to the gathered
-- rows in `tasks` that the overnight enricher rewrites and deletes on
-- completion. The two never share a row.
--
-- project_id IS NULL is the Inbox — the same rule the sidebar already
-- encodes, so there is no row to seed, rename or delete.
--
-- parent_id ships now even though sub-tasks are a later phase: the column
-- costs nothing here and avoids a second migration against a populated table.

BEGIN;

CREATE TABLE public.task_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id   uuid REFERENCES public.task_projects(id) ON DELETE CASCADE,
  parent_id    uuid REFERENCES public.task_items(id) ON DELETE CASCADE,
  content      text NOT NULL,
  description  text,
  due_date     date,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_items_user_project_idx ON public.task_items (user_id, project_id);

ALTER TABLE public.task_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.task_items FROM anon, authenticated;

-- The project view's "Add a description" line.
ALTER TABLE public.task_projects ADD COLUMN description text;

COMMIT;
```

- [ ] **Step 2: Check the number is free**

Run: `ls migrations | tail -4`
Expected: `0053_task_projects.sql` is the highest. If `0054_*` exists, renumber to the next free number and use that number for the rest of this task.

- [ ] **Step 3: Commit**

```bash
git add migrations/0054_task_items.sql
git commit -m "Add the task_items table"
```

---

### Task 2: Share the ancestry guard between projects and task items

**Files:**

- Create: `workers/cookie-web-tasks/src/ancestry.js`
- Create: `workers/cookie-web-tasks/test/ancestry.test.js`
- Modify: `workers/cookie-web-tasks/src/projects.js` (delete its local `isAncestorOf`, import the shared one)
- Modify: `workers/cookie-web-tasks/test/projects.test.js` (its cycle test still passes unchanged)

**Interfaces:**

- Consumes: nothing.
- Produces: `isAncestorOf(sql, { table, userId, id, candidateParentId })` → `Promise<boolean>`. True when `id` sits on the ancestry chain above `candidateParentId`, which is exactly when re-parenting would create a cycle.

- [ ] **Step 1: Write the failing test**

Create `workers/cookie-web-tasks/test/ancestry.test.js`:

```javascript
import { describe, expect, it } from 'vitest'
import { isAncestorOf } from '../src/ancestry.js'
import { createMockSql } from './helpers.js'

const USER_ID = '99999999-9999-9999-9999-999999999999'
const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'

describe('isAncestorOf', () => {
  it('reports a cycle when the walk finds the moving row above the proposed parent', async () => {
    const sql = createMockSql([[{ ok: 1 }]])

    const cycle = await isAncestorOf(sql, {
      table: 'task_projects',
      userId: USER_ID,
      id: ID_A,
      candidateParentId: ID_B,
    })

    expect(cycle).toBe(true)
  })

  it('reports no cycle when the walk reaches the root without finding it', async () => {
    const sql = createMockSql([[]])

    const cycle = await isAncestorOf(sql, {
      table: 'task_items',
      userId: USER_ID,
      id: ID_A,
      candidateParentId: ID_B,
    })

    expect(cycle).toBe(false)
  })

  // The table name reaches SQL as an escaped identifier, never string
  // interpolation, so an attacker-supplied table can never be injected.
  it('passes the table through the driver as an identifier', async () => {
    const sql = createMockSql([[]])

    await isAncestorOf(sql, {
      table: 'task_items',
      userId: USER_ID,
      id: ID_A,
      candidateParentId: ID_B,
    })

    expect(sql.calls.some((call) => call.text.includes('task_items'))).toBe(false)
    expect(sql.calls[0].text).toContain('WITH RECURSIVE ancestry')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd workers/cookie-web-tasks && npx vitest run test/ancestry.test.js`
Expected: FAIL — `Failed to resolve import "../src/ancestry.js"`.

- [ ] **Step 3: Write the implementation**

Create `workers/cookie-web-tasks/src/ancestry.js`:

```javascript
// The cycle guard shared by every self-nesting table in this Worker.
//
// A row may not become its own descendant: re-parenting onto your own child
// severs the subtree from the root, leaving it invisible in the sidebar but
// still in the table. The walk climbs from the PROPOSED PARENT upward, so it
// terminates on the tree's depth rather than its size.
//
// The table arrives as an escaped identifier through postgres.js's sql()
// helper — never string interpolation — so no caller can inject one.

/**
 * @param {import('postgres').Sql} sql
 * @param {{table: string, userId: string, id: string, candidateParentId: string}} target
 * @returns {Promise<boolean>}
 */
export async function isAncestorOf(sql, { table, userId, id, candidateParentId }) {
  const rows = await sql`
    WITH RECURSIVE ancestry AS (
      SELECT t.id, t.parent_id FROM ${sql(table)} t
      WHERE t.id = ${candidateParentId} AND t.user_id = ${userId}
      UNION ALL
      SELECT p.id, p.parent_id FROM ${sql(table)} p
      JOIN ancestry a ON p.id = a.parent_id AND p.user_id = ${userId}
    )
    SELECT 1 FROM ancestry WHERE id = ${id} LIMIT 1
  `
  return rows.length > 0
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd workers/cookie-web-tasks && npx vitest run test/ancestry.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Point projects at the shared helper**

In `workers/cookie-web-tasks/src/projects.js`, delete the local `isAncestorOf` function entirely, add `import { isAncestorOf } from './ancestry.js';` at the top, and change its single call site inside `updateProject` from:

```javascript
    if (await isAncestorOf(sql, userId, id, parentId)) {
```

to:

```javascript
    if (
      await isAncestorOf(sql, {
        table: 'task_projects',
        userId,
        id,
        candidateParentId: parentId,
      })
    ) {
```

If `isAncestorOf` was exported from `projects.js`, remove it from the export list; nothing outside that file imported it.

- [ ] **Step 6: Verify the projects suite still passes unchanged**

Run: `cd workers/cookie-web-tasks && npx vitest run test/projects.test.js`
Expected: PASS. The cycle test in that file must still pass **without being edited** — if it needs editing, the refactor changed behaviour and that is a defect, not a test to update.

- [ ] **Step 7: Run everything and commit**

Run: `cd ../.. && npm test && npm run lint && npm run typecheck`

```bash
git add workers/cookie-web-tasks/src/ancestry.js workers/cookie-web-tasks/test/ancestry.test.js workers/cookie-web-tasks/src/projects.js
git commit -m "Share the ancestry cycle guard across nesting tables"
```

---

### Task 3: `GET` and `POST /task-items`

**Files:**

- Create: `workers/cookie-web-tasks/src/taskItems.js`
- Create: `workers/cookie-web-tasks/test/taskItems.test.js`
- Modify: `workers/cookie-web-tasks/src/worker.js` (import, and a new branch in `route()` before the `projects` branch)

**Interfaces:**

- Consumes: `task_items` (Task 1).
- Produces: `getTaskItems(sql, userId, url)` → `{ items: [...] }`; `createTaskItem(sql, userId, body)` → `{ item }` 201. A row is `{ id, projectId, parentId, content, description, dueDate, completedAt, createdAt }`.

- [ ] **Step 1: Write the failing tests**

Create `workers/cookie-web-tasks/test/taskItems.test.js`:

```javascript
import { describe, expect, it } from 'vitest'
import { createTaskItem, getTaskItems } from '../src/taskItems.js'
import { createMockSql } from './helpers.js'

const USER_ID = '99999999-9999-9999-9999-999999999999'
const ITEM_ID = '11111111-1111-4111-8111-111111111111'
const PROJECT_ID = '22222222-2222-4222-8222-222222222222'

const url = (query) => new URL(`https://example.test/task-items${query}`)

describe('GET /task-items', () => {
  it('lists a project, oldest first, hiding completed tasks', async () => {
    const sql = createMockSql([[{ id: ITEM_ID, projectId: PROJECT_ID, content: 'Ship it' }]])

    const response = await getTaskItems(sql, USER_ID, url(`?project=${PROJECT_ID}`))

    expect(response.status).toBe(200)
    expect((await response.json()).items).toHaveLength(1)
    expect(sql.calls[0].text).toContain('FROM task_items t')
    expect(sql.calls[0].text).toContain('t.completed_at IS NULL')
    expect(sql.calls[0].text).toContain('ORDER BY t.created_at ASC')
    expect(sql.calls[0].values).toContain(USER_ID)
  })

  // Inbox is a rule, not a row: it means "belongs to no project".
  it('treats project=inbox as project_id IS NULL', async () => {
    const sql = createMockSql([[]])
    await getTaskItems(sql, USER_ID, url('?project=inbox'))

    expect(sql.calls[0].text).toContain('t.project_id IS NULL')
    expect(sql.calls[0].values).not.toContain('inbox')
  })

  it('includes completed tasks when asked', async () => {
    const sql = createMockSql([[]])
    await getTaskItems(sql, USER_ID, url('?project=inbox&completed=1'))

    expect(sql.calls[0].text).not.toContain('t.completed_at IS NULL')
  })

  it('400s a project that is neither a uuid nor inbox', async () => {
    const sql = createMockSql([])
    const response = await getTaskItems(sql, USER_ID, url('?project=nonsense'))
    expect(response.status).toBe(400)
  })
})

describe('POST /task-items', () => {
  it('creates a task in a project', async () => {
    const sql = createMockSql([
      [{ id: PROJECT_ID }],
      [{ id: ITEM_ID, projectId: PROJECT_ID, content: 'Ship it' }],
    ])

    const response = await createTaskItem(sql, USER_ID, {
      content: 'Ship it',
      projectId: PROJECT_ID,
    })

    expect(response.status).toBe(201)
    expect((await response.json()).item.content).toBe('Ship it')
  })

  it('creates an Inbox task when no project is given', async () => {
    const sql = createMockSql([[{ id: ITEM_ID, projectId: null, content: 'Ship it' }]])

    const response = await createTaskItem(sql, USER_ID, { content: 'Ship it' })

    expect(response.status).toBe(201)
    expect((await response.json()).item.projectId).toBeNull()
  })

  it('rejects a blank content', async () => {
    const sql = createMockSql([])
    const response = await createTaskItem(sql, USER_ID, { content: '   ' })
    expect(response.status).toBe(400)
  })

  it('404s a project the caller does not own', async () => {
    const sql = createMockSql([[]])
    const response = await createTaskItem(sql, USER_ID, {
      content: 'Ship it',
      projectId: PROJECT_ID,
    })
    expect(response.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd workers/cookie-web-tasks && npx vitest run test/taskItems.test.js`
Expected: FAIL — `Failed to resolve import "../src/taskItems.js"`.

- [ ] **Step 3: Write the implementation**

Create `workers/cookie-web-tasks/src/taskItems.js`:

```javascript
// Cookie-owned tasks. Distinct from `tasks`, which holds the overnight
// enricher's gathered Todoist and email items and is not a place a person
// writes to. The two never share a row.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_CONTENT_LENGTH = 500
const MAX_DESCRIPTION_LENGTH = 10000

/** @param {any} value */
function isUuid(value) {
  return value === String(value ?? '') && UUID_RE.test(value)
}

/** @param {any} value @param {number} max */
function cleanText(value, max) {
  if (!(value?.trim instanceof Function)) return null
  const text = value.trim().slice(0, max)
  return text || null
}

/** @param {import('postgres').Sql} sql @param {string} userId @param {string} id */
function fetchOwnedProject(sql, userId, id) {
  return sql`SELECT id FROM task_projects WHERE id = ${id} AND user_id = ${userId}`
}

/**
 * GET /task-items?project=<uuid|inbox>[&completed=1]
 *
 * @param {import('postgres').Sql} sql
 * @param {string} userId
 * @param {URL} url
 */
export async function getTaskItems(sql, userId, url) {
  const project = url.searchParams.get('project') ?? 'inbox'
  const inbox = project === 'inbox'
  if (!inbox && !isUuid(project)) {
    return Response.json({ error: 'project must be a project id or "inbox"' }, { status: 400 })
  }
  const includeCompleted = url.searchParams.get('completed') === '1'

  const items = await sql`
    SELECT t.id, t.project_id AS "projectId", t.parent_id AS "parentId", t.content,
           t.description, t.due_date AS "dueDate", t.completed_at AS "completedAt",
           t.created_at AS "createdAt"
    FROM task_items t
    WHERE t.user_id = ${userId}
      AND ${inbox ? sql`t.project_id IS NULL` : sql`t.project_id = ${project}`}
      ${includeCompleted ? sql`AND TRUE` : sql`AND t.completed_at IS NULL`}
    ORDER BY t.created_at ASC
  `
  return Response.json({ items })
}

/**
 * POST /task-items — { content, description?, projectId?, parentId?, dueDate? }
 *
 * @param {import('postgres').Sql} sql
 * @param {string} userId
 * @param {any} body
 */
export async function createTaskItem(sql, userId, body) {
  const content = cleanText(body?.content, MAX_CONTENT_LENGTH)
  if (!content) return Response.json({ error: 'Task content is required' }, { status: 400 })

  const description = Object.hasOwn(body ?? {}, 'description')
    ? cleanText(body.description, MAX_DESCRIPTION_LENGTH)
    : null

  const projectId = body?.projectId ?? null
  if (projectId !== null) {
    if (!isUuid(projectId) || !(await fetchOwnedProject(sql, userId, projectId)).length) {
      return Response.json({ error: 'Project not found' }, { status: 404 })
    }
  }

  const dueDate = DATE_RE.test(String(body?.dueDate ?? '')) ? String(body.dueDate) : null

  const [item] = await sql`
    INSERT INTO task_items (user_id, project_id, content, description, due_date)
    VALUES (${userId}, ${projectId}, ${content}, ${description}, ${dueDate})
    RETURNING id, project_id AS "projectId", parent_id AS "parentId", content, description,
              due_date AS "dueDate", completed_at AS "completedAt", created_at AS "createdAt"
  `
  return Response.json({ item }, { status: 201 })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd workers/cookie-web-tasks && npx vitest run test/taskItems.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Wire the route**

In `workers/cookie-web-tasks/src/worker.js`, add to the import block:

```javascript
import { createTaskItem, getTaskItems } from './taskItems.js'
```

and add this branch inside `route()`, immediately **before** the `if (segments[0] === 'projects')` branch:

```javascript
if (segments[0] === 'task-items') {
  if (segments.length > 1) return Response.json({ error: 'Not Found' }, { status: 404 })
  if (request.method === 'GET') return getTaskItems(sql, userId, url)
  if (request.method !== 'POST' && request.method !== 'PATCH' && request.method !== 'DELETE') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  let body
  try {
    body = await readJsonBody(request)
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (request.method === 'POST') return createTaskItem(sql, userId, body)
  return Response.json({ error: 'Method not allowed' }, { status: 405 })
}
```

Tasks 4 and 5 fill in the `PATCH` and `DELETE` arms.

- [ ] **Step 6: Run everything and commit**

Run: `cd ../.. && npm test && npm run lint && npm run typecheck`

```bash
git add workers/cookie-web-tasks/src/taskItems.js workers/cookie-web-tasks/test/taskItems.test.js workers/cookie-web-tasks/src/worker.js
git commit -m "List and create Cookie-owned tasks"
```

---

### Task 4: `PATCH /task-items`

**Files:**

- Modify: `workers/cookie-web-tasks/src/taskItems.js`
- Modify: `workers/cookie-web-tasks/test/taskItems.test.js`
- Modify: `workers/cookie-web-tasks/src/worker.js`

**Interfaces:**

- Consumes: `isUuid`, `cleanText`, `fetchOwnedProject` (Task 3); `isAncestorOf` (Task 2).
- Produces: `updateTaskItem(sql, userId, body)` → `{ item }`.

- [ ] **Step 1: Write the failing tests**

Append to `workers/cookie-web-tasks/test/taskItems.test.js`, adding `updateTaskItem` to the import:

```javascript
describe('PATCH /task-items', () => {
  it('renames a task', async () => {
    const sql = createMockSql([[{ id: ITEM_ID }], [{ id: ITEM_ID, content: 'Renamed' }]])

    const response = await updateTaskItem(sql, USER_ID, { id: ITEM_ID, content: 'Renamed' })

    expect(response.status).toBe(200)
    expect((await response.json()).item.content).toBe('Renamed')
  })

  // Completion stamps a time rather than deleting, so history survives and
  // un-completing is clearing the column.
  it('stamps completed_at when completed is true and clears it when false', async () => {
    const done = createMockSql([[{ id: ITEM_ID }], [{ id: ITEM_ID, completedAt: 't1' }]])
    await updateTaskItem(done, USER_ID, { id: ITEM_ID, completed: true })
    const doneUpdate = done.calls.find((call) => call.text.includes('UPDATE task_items'))
    expect(doneUpdate.text).toContain('completed_at')
    expect(doneUpdate.text).not.toContain('DELETE')

    const undone = createMockSql([[{ id: ITEM_ID }], [{ id: ITEM_ID, completedAt: null }]])
    const response = await updateTaskItem(undone, USER_ID, { id: ITEM_ID, completed: false })
    expect((await response.json()).item.completedAt).toBeNull()
  })

  it('404s an id the caller does not own', async () => {
    const sql = createMockSql([[]])
    const response = await updateTaskItem(sql, USER_ID, { id: ITEM_ID, content: 'Stolen' })
    expect(response.status).toBe(404)
  })

  it('rejects a move that would make a task its own descendant', async () => {
    const sql = createMockSql([
      [{ id: ITEM_ID }], // the task exists
      [{ id: '33333333-3333-4333-8333-333333333333' }], // the proposed parent exists
      [{ ok: 1 }], // ancestry walk finds the task above the parent
    ])

    const response = await updateTaskItem(sql, USER_ID, {
      id: ITEM_ID,
      parentId: '33333333-3333-4333-8333-333333333333',
    })

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('own descendant')
    expect(sql.calls.some((call) => call.text.includes('UPDATE task_items'))).toBe(false)
  })

  it('moves a task to the Inbox with projectId null', async () => {
    const sql = createMockSql([[{ id: ITEM_ID }], [{ id: ITEM_ID, projectId: null }]])

    const response = await updateTaskItem(sql, USER_ID, { id: ITEM_ID, projectId: null })

    expect(response.status).toBe(200)
    expect((await response.json()).item.projectId).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd workers/cookie-web-tasks && npx vitest run test/taskItems.test.js`
Expected: FAIL — `updateTaskItem is not a function`.

- [ ] **Step 3: Write the implementation**

Add to the top of `workers/cookie-web-tasks/src/taskItems.js`:

```javascript
import { isAncestorOf } from './ancestry.js'
```

and append:

```javascript
/** @param {import('postgres').Sql} sql @param {string} userId @param {string} id */
function fetchOwnedTaskItem(sql, userId, id) {
  return sql`SELECT id FROM task_items WHERE id = ${id} AND user_id = ${userId}`
}

/**
 * PATCH /task-items — { id, content?, description?, projectId?, parentId?,
 * dueDate?, completed? }. projectId: null moves the task to the Inbox.
 *
 * @param {import('postgres').Sql} sql
 * @param {string} userId
 * @param {any} body
 */
export async function updateTaskItem(sql, userId, body) {
  const id = isUuid(body?.id) ? String(body.id) : null
  if (!id) return Response.json({ error: 'A valid task id is required' }, { status: 400 })
  if (!(await fetchOwnedTaskItem(sql, userId, id)).length) {
    return Response.json({ error: 'Task not found' }, { status: 404 })
  }

  const hasContent = Object.hasOwn(body, 'content')
  const hasDescription = Object.hasOwn(body, 'description')
  const hasProject = Object.hasOwn(body, 'projectId')
  const hasParent = Object.hasOwn(body, 'parentId')
  const hasDueDate = Object.hasOwn(body, 'dueDate')
  const hasCompleted = Object.hasOwn(body, 'completed')

  const content = hasContent ? cleanText(body.content, MAX_CONTENT_LENGTH) : null
  if (hasContent && !content) {
    return Response.json({ error: 'Task content is required' }, { status: 400 })
  }
  if (!hasContent && !hasDescription && !hasProject && !hasParent && !hasDueDate && !hasCompleted) {
    return Response.json({ error: 'At least one change is required' }, { status: 400 })
  }

  const description = hasDescription ? cleanText(body.description, MAX_DESCRIPTION_LENGTH) : null

  const projectId = hasProject ? (body.projectId ?? null) : null
  if (hasProject && projectId !== null) {
    if (!isUuid(projectId) || !(await fetchOwnedProject(sql, userId, projectId)).length) {
      return Response.json({ error: 'Project not found' }, { status: 404 })
    }
  }

  const parentId = hasParent ? (body.parentId ?? null) : null
  if (hasParent && parentId !== null) {
    if (parentId === id) {
      return Response.json({ error: 'A task cannot be its own parent' }, { status: 400 })
    }
    if (!isUuid(parentId) || !(await fetchOwnedTaskItem(sql, userId, parentId)).length) {
      return Response.json({ error: 'Task not found' }, { status: 404 })
    }
    if (await isAncestorOf(sql, { table: 'task_items', userId, id, candidateParentId: parentId })) {
      return Response.json({ error: 'A task cannot become its own descendant' }, { status: 400 })
    }
  }

  const dueDate =
    hasDueDate && DATE_RE.test(String(body.dueDate ?? '')) ? String(body.dueDate) : null

  const [item] = await sql`
    UPDATE task_items t SET
      content      = COALESCE(${hasContent ? content : null}, t.content),
      description  = CASE WHEN ${hasDescription}::boolean THEN ${description} ELSE t.description END,
      project_id   = CASE WHEN ${hasProject}::boolean THEN ${projectId}::uuid ELSE t.project_id END,
      parent_id    = CASE WHEN ${hasParent}::boolean THEN ${parentId}::uuid ELSE t.parent_id END,
      due_date     = CASE WHEN ${hasDueDate}::boolean THEN ${dueDate}::date ELSE t.due_date END,
      completed_at = CASE
        WHEN ${hasCompleted}::boolean THEN (CASE WHEN ${Boolean(body.completed)}::boolean THEN now() ELSE NULL END)
        ELSE t.completed_at
      END,
      updated_at   = now()
    WHERE t.id = ${id} AND t.user_id = ${userId}
    RETURNING t.id, t.project_id AS "projectId", t.parent_id AS "parentId", t.content,
              t.description, t.due_date AS "dueDate", t.completed_at AS "completedAt",
              t.created_at AS "createdAt"
  `
  return Response.json({ item })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd workers/cookie-web-tasks && npx vitest run test/taskItems.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Wire the route**

In `workers/cookie-web-tasks/src/worker.js`, extend the import to `import { createTaskItem, getTaskItems, updateTaskItem } from './taskItems.js';` and replace the branch's trailing lines:

```javascript
if (request.method === 'POST') return createTaskItem(sql, userId, body)
if (request.method === 'PATCH') return updateTaskItem(sql, userId, body)
return Response.json({ error: 'Method not allowed' }, { status: 405 })
```

- [ ] **Step 6: Run everything and commit**

Run: `cd ../.. && npm test && npm run lint && npm run typecheck`

```bash
git add workers/cookie-web-tasks/src/taskItems.js workers/cookie-web-tasks/test/taskItems.test.js workers/cookie-web-tasks/src/worker.js
git commit -m "Edit, complete and re-file Cookie-owned tasks"
```

---

### Task 5: `DELETE /task-items`, and a project description

**Files:**

- Modify: `workers/cookie-web-tasks/src/taskItems.js`
- Modify: `workers/cookie-web-tasks/test/taskItems.test.js`
- Modify: `workers/cookie-web-tasks/src/projects.js` (accept `description` on PATCH, return it on GET)
- Modify: `workers/cookie-web-tasks/test/projects.test.js`
- Modify: `workers/cookie-web-tasks/src/worker.js`

**Interfaces:**

- Consumes: `isUuid` (Task 3).
- Produces: `deleteTaskItem(sql, userId, body)` → `{ ok: true }`; `/projects` rows gain `description`.

- [ ] **Step 1: Write the failing tests**

Append to `workers/cookie-web-tasks/test/taskItems.test.js`, adding `deleteTaskItem` to the import:

```javascript
describe('DELETE /task-items', () => {
  it('deletes an owned task', async () => {
    const sql = createMockSql([[{ id: ITEM_ID }]])
    const response = await deleteTaskItem(sql, USER_ID, { id: ITEM_ID })

    expect(response.status).toBe(200)
    expect((await response.json()).ok).toBe(true)
    expect(sql.calls[0].text).toContain('DELETE FROM task_items')
  })

  it('404s an id the caller does not own', async () => {
    const sql = createMockSql([[]])
    const response = await deleteTaskItem(sql, USER_ID, { id: ITEM_ID })
    expect(response.status).toBe(404)
  })
})
```

Append to `workers/cookie-web-tasks/test/projects.test.js`:

```javascript
describe('project descriptions', () => {
  it('returns a description from GET', async () => {
    const sql = createMockSql([[]])
    await getProjects(sql, USER_ID)
    expect(sql.calls[0].text).toContain('p.description')
  })

  it('updates a description through PATCH', async () => {
    const sql = createMockSql([
      [{ id: PROJECT_ID }],
      [{ id: PROJECT_ID, description: 'What this project is for' }],
    ])

    const response = await updateProject(sql, USER_ID, {
      id: PROJECT_ID,
      description: 'What this project is for',
    })

    expect(response.status).toBe(200)
    expect((await response.json()).project.description).toBe('What this project is for')
  })

  // Clearing a description is a real edit, not "no change given".
  it('accepts an empty description as a clear', async () => {
    const sql = createMockSql([[{ id: PROJECT_ID }], [{ id: PROJECT_ID, description: null }]])
    const response = await updateProject(sql, USER_ID, { id: PROJECT_ID, description: '' })
    expect(response.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd workers/cookie-web-tasks && npx vitest run test/taskItems.test.js test/projects.test.js`
Expected: FAIL — `deleteTaskItem is not a function`, and the description tests failing on the missing column.

- [ ] **Step 3: Write the implementations**

Append to `workers/cookie-web-tasks/src/taskItems.js`:

```javascript
/**
 * DELETE /task-items — { id }. Sub-tasks go with it via ON DELETE CASCADE.
 *
 * @param {import('postgres').Sql} sql
 * @param {string} userId
 * @param {any} body
 */
export async function deleteTaskItem(sql, userId, body) {
  const id = isUuid(body?.id) ? String(body.id) : null
  if (!id) return Response.json({ error: 'A valid task id is required' }, { status: 400 })

  const deleted = await sql`
    DELETE FROM task_items WHERE id = ${id} AND user_id = ${userId} RETURNING id
  `
  if (!deleted.length) return Response.json({ error: 'Task not found' }, { status: 404 })
  return Response.json({ ok: true })
}
```

In `workers/cookie-web-tasks/src/projects.js`:

1. Add `p.description` to `getProjects`' SELECT list and `description` to the `RETURNING` lists of both `createProject` and `updateProject`.
2. In `updateProject`, add alongside the other `Object.hasOwn` flags:

```javascript
const hasDescription = Object.hasOwn(body, 'description')
const description = hasDescription
  ? String(body.description ?? '')
      .trim()
      .slice(0, 10000) || null
  : null
```

3. Include `hasDescription` in the "at least one change is required" guard, and add to the `SET` clause:

```javascript
      description = CASE WHEN ${hasDescription}::boolean THEN ${description} ELSE p.description END,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd workers/cookie-web-tasks && npx vitest run test/taskItems.test.js test/projects.test.js`
Expected: PASS — 15 in taskItems, and projects up by 3.

- [ ] **Step 5: Wire the route**

In `workers/cookie-web-tasks/src/worker.js`, extend the import to include `deleteTaskItem` and replace the branch's trailing lines:

```javascript
if (request.method === 'POST') return createTaskItem(sql, userId, body)
if (request.method === 'PATCH') return updateTaskItem(sql, userId, body)
return deleteTaskItem(sql, userId, body)
```

- [ ] **Step 6: Run everything and commit**

Run: `cd ../.. && npm test && npm run lint && npm run typecheck`

```bash
git add workers/cookie-web-tasks/src/taskItems.js workers/cookie-web-tasks/test/taskItems.test.js workers/cookie-web-tasks/src/projects.js workers/cookie-web-tasks/test/projects.test.js workers/cookie-web-tasks/src/worker.js
git commit -m "Delete tasks, and give projects a description"
```

---

### Task 6: The task items store

**Files:**

- Create: `src/stores/taskItems.js`
- Create: `src/stores/__tests__/taskItems.spec.js`

**Interfaces:**

- Consumes: `TASKS_API_URL` from `src/lib/apiWorkers.js`.
- Produces: `useTaskItemsStore()` with state `{ items: [], loadedProject: null, isLoading: false }` and actions `loadItems(project, { force })`, `createItem({ content, projectId })`, `renameItem(id, content)`, `setCompleted(id, completed)`, `deleteItem(id)`. Mutating actions return the item (or `true`) on success and `null`/`false` on failure, having notified with the server's message when it sends one.

- [ ] **Step 1: Write the failing tests**

Create `src/stores/__tests__/taskItems.spec.js`:

```javascript
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTaskItemsStore } from '../taskItems'
import { useInboxStore } from '../inbox'

const ITEM = { id: 't1', projectId: 'p1', parentId: null, content: 'Ship it', completedAt: null }

let store

beforeEach(() => {
  setActivePinia(createPinia())
  store = useTaskItemsStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
})

function stubFetch(handler) {
  vi.stubGlobal('fetch', vi.fn(handler))
}

describe('task items store', () => {
  it('loads a project once, and refetches when the project changes', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ items: [ITEM] }) }))

    await store.loadItems('p1')
    await store.loadItems('p1')
    expect(fetch).toHaveBeenCalledTimes(1)

    await store.loadItems('inbox')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('sends the project and content when creating', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ item: ITEM }) }))

    await store.createItem({ content: 'Ship it', projectId: 'p1' })

    const [, options] = fetch.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({ content: 'Ship it', projectId: 'p1' })
    expect(store.items).toHaveLength(1)
  })

  // Completing hides the task from the list without deleting it.
  it('drops a completed task from the visible list', async () => {
    store.items = [{ ...ITEM }]
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ item: { ...ITEM, completedAt: '2026-08-29T10:00:00Z' } }),
    }))

    await store.setCompleted('t1', true)

    expect(store.items).toEqual([])
  })

  it('rolls a failed rename back and surfaces the server message', async () => {
    store.items = [{ ...ITEM }]
    const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})
    stubFetch(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Task content is required' }),
    }))

    const result = await store.renameItem('t1', '')

    expect(result).toBeNull()
    expect(store.items[0].content).toBe('Ship it')
    expect(notify).toHaveBeenCalledWith('Task content is required', 'error')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/stores/__tests__/taskItems.spec.js`
Expected: FAIL — cannot resolve `../taskItems`.

- [ ] **Step 3: Write the implementation**

Create `src/stores/taskItems.js`:

```javascript
import { defineStore } from 'pinia'

import { getAuth0 } from '../auth0-client'
import { TASKS_API_URL } from '../lib/apiWorkers'
import { useInboxStore } from './inbox'

// Cookie-owned tasks for the Tasks app. Shaped after stores/projects.js: the
// same auth headers, the same request helper that surfaces the server's own
// error text, and local state updated optimistically with a rollback when the
// server refuses.
export const useTaskItemsStore = defineStore('taskItems', {
  state: () => ({
    items: [],
    // Which project the loaded items belong to ('inbox' or a project id), so
    // navigating between projects refetches rather than showing the last one.
    loadedProject: null,
    isLoading: false,
  }),

  actions: {
    async authHeaders(extra = {}) {
      const headers = { ...extra }
      const auth0 = getAuth0()
      if (auth0) {
        const token = await auth0.getAccessTokenSilently()
        headers.Authorization = `Bearer ${token}`
      }
      return headers
    },

    notify(message, kind = 'info') {
      useInboxStore().notify(message, kind)
    },

    async request(method, { params = '', body } = {}) {
      const headers = await this.authHeaders(
        body !== undefined ? { 'Content-Type': 'application/json' } : {},
      )
      const options = { method, headers }
      if (body !== undefined) options.body = JSON.stringify(body)
      const response = await fetch(`${TASKS_API_URL}/task-items${params}`, options)
      if (!response.ok) {
        const error = new Error(`${method} /task-items responded ${response.status}`)
        error.status = response.status
        // The server explains permanent refusals; a parse failure here must
        // not mask the HTTP error.
        try {
          const body = await response.json()
          if (body?.error) error.userMessage = String(body.error)
        } catch {
          // no usable body — the generic message stands
        }
        throw error
      }
      return response.json()
    },

    async loadItems(project, { force = false } = {}) {
      if (this.loadedProject === project && !force) return
      this.isLoading = true
      try {
        const { items } = await this.request('GET', {
          params: `?project=${encodeURIComponent(project)}`,
        })
        this.items = items
        this.loadedProject = project
      } catch (error) {
        console.error('Failed to load tasks:', error)
        this.notify(error.userMessage || 'Failed to load tasks.', 'error')
      } finally {
        this.isLoading = false
      }
    },

    async createItem({ content, projectId = null }) {
      try {
        const { item } = await this.request('POST', { body: { content, projectId } })
        this.items.push(item)
        return item
      } catch (error) {
        console.error('Failed to create task:', error)
        this.notify(error.userMessage || 'Failed to create the task.', 'error')
        return null
      }
    },

    async patchItem(id, changes, failureMessage) {
      const item = this.items.find((row) => row.id === id)
      if (!item) {
        this.notify(failureMessage, 'error')
        return null
      }
      const previous = { ...item }
      Object.assign(item, changes)
      try {
        const { item: updated } = await this.request('PATCH', { body: { id, ...changes } })
        Object.assign(item, updated)
        // A completed task leaves the visible list; it is not deleted.
        if (updated.completedAt) this.items = this.items.filter((row) => row.id !== id)
        return item
      } catch (error) {
        console.error('Failed to update task:', error)
        Object.assign(item, previous)
        this.notify(error.userMessage || failureMessage, 'error')
        return null
      }
    },

    renameItem(id, content) {
      return this.patchItem(id, { content }, 'Failed to rename the task.')
    },

    setCompleted(id, completed) {
      return this.patchItem(id, { completed }, 'Failed to update the task.')
    },

    async deleteItem(id) {
      const previous = this.items
      this.items = this.items.filter((row) => row.id !== id)
      try {
        await this.request('DELETE', { body: { id } })
        return true
      } catch (error) {
        console.error('Failed to delete task:', error)
        this.items = previous
        this.notify(error.userMessage || 'Failed to delete the task.', 'error')
        return false
      }
    },
  },
})
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/stores/__tests__/taskItems.spec.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/stores/taskItems.js src/stores/__tests__/taskItems.spec.js
git commit -m "Add a store for Cookie-owned tasks"
```

---

### Task 7: The project header

**Files:**

- Modify: `src/views/TasksView.vue`
- Create: `src/views/__tests__/TasksView.spec.js`
- Modify: `src/stores/projects.js` (a `describeProject` action for the description edit, and `ancestorsOf` for the breadcrumb)

**Interfaces:**

- Consumes: `useProjectsStore` (its `projects` state and `patchProject`).
- Produces: `ancestorsOf(id)` getter returning the chain from root to the project, and `describeProject(id, description)`. DOM hooks: `.tasks-breadcrumb`, `.tasks-title`, `.tasks-description`.

- [ ] **Step 1: Write the failing tests**

Create `src/views/__tests__/TasksView.spec.js`:

```javascript
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import TasksView from '../TasksView.vue'
import { useProjectsStore } from '../../stores/projects'

let router

function mountView() {
  return mount(TasksView, { global: { plugins: [router] } })
}

beforeEach(async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/tasks', name: 'tasks', component: { template: '<div />' } }],
  })
  await router.push('/tasks?project=p2')
  await router.isReady()
  setActivePinia(createPinia())
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ items: [], projects: [] }) })),
  )
  const projects = useProjectsStore()
  projects.projects = [
    { id: 'p1', parentId: null, name: 'Technical Projects', description: null },
    { id: 'p2', parentId: 'p1', name: 'Githup', description: null },
  ]
  projects.isLoaded = true
})

describe('TasksView', () => {
  it('shows the ancestor chain and the project name', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('.tasks-breadcrumb').text()).toContain('My Projects')
    expect(wrapper.get('.tasks-breadcrumb').text()).toContain('Technical Projects')
    expect(wrapper.get('.tasks-title').text()).toBe('Githup')
  })

  it('offers the description placeholder until one is written', async () => {
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('.tasks-description').text()).toBe('Add a description')
  })

  // Inbox is a rule, not a project row, so it has no ancestors to show.
  it('titles the Inbox without a breadcrumb chain', async () => {
    await router.push('/tasks?project=inbox')
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('.tasks-title').text()).toBe('Inbox')
    expect(wrapper.get('.tasks-breadcrumb').text()).not.toContain('Technical Projects')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/views/__tests__/TasksView.spec.js`
Expected: FAIL — no `.tasks-breadcrumb` element.

- [ ] **Step 3: Add the store pieces**

In `src/stores/projects.js`, add to `getters`:

```javascript
    // The chain from the root down to (and including) this project, for the
    // view's breadcrumb. A parentId that no longer resolves simply stops the
    // walk rather than looping.
    ancestorsOf: (state) => (id) => {
      const byId = new Map(state.projects.map((project) => [project.id, project]))
      const chain = []
      let current = byId.get(id)
      const seen = new Set()
      while (current && !seen.has(current.id)) {
        seen.add(current.id)
        chain.unshift(current)
        current = current.parentId ? byId.get(current.parentId) : null
      }
      return chain
    },
```

and to `actions`:

```javascript
    describeProject(id, description) {
      return this.patchProject(id, { description }, 'Failed to save the description.')
    },
```

- [ ] **Step 4: Write the view**

Replace `src/views/TasksView.vue` entirely:

```vue
<script setup>
import { computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'

import { useProjectsStore } from '../stores/projects'
import { useTaskItemsStore } from '../stores/taskItems'

const route = useRoute()
const projects = useProjectsStore()
const items = useTaskItemsStore()

// 'inbox' is a filter, not a project id — the Inbox is the tasks that belong
// to no project, so there is no row to look up.
const project = computed(() => String(route.query.project ?? 'inbox'))
const isInbox = computed(() => project.value === 'inbox')
const current = computed(() =>
  isInbox.value ? null : projects.projects.find((row) => row.id === project.value),
)
const ancestors = computed(() =>
  isInbox.value ? [] : projects.ancestorsOf(project.value).slice(0, -1),
)
const title = computed(() => (isInbox.value ? 'Inbox' : (current.value?.name ?? '')))

onMounted(() => {
  projects.loadProjects()
  items.loadItems(project.value)
})

watch(project, (next) => items.loadItems(next))
</script>

<template>
  <div class="view-panel active tasks-view">
    <nav class="tasks-breadcrumb" aria-label="Breadcrumb">
      <span>My Projects</span>
      <template v-for="ancestor in ancestors" :key="ancestor.id">
        <span aria-hidden="true">/</span>
        <router-link :to="{ path: '/tasks', query: { project: ancestor.id } }">
          {{ ancestor.name }}
        </router-link>
      </template>
      <span aria-hidden="true">/</span>
    </nav>

    <h1 class="tasks-title">{{ title }}</h1>

    <p v-if="!isInbox" class="tasks-description">
      {{ current?.description || 'Add a description' }}
    </p>
  </div>
</template>

<style scoped>
.tasks-view {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 24px;
}

.tasks-breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
}

.tasks-breadcrumb a {
  color: inherit;
  text-decoration: none;
}

.tasks-breadcrumb a:hover {
  color: var(--text-primary);
}

.tasks-title {
  margin: 18px 0 6px;
  font-size: 26px;
  font-weight: 700;
}

.tasks-description {
  margin: 0 0 24px;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: text;
}
</style>
```

Note the `useInboxStore()` chunk-budget shim the old file carried is gone: the two real store imports keep the Tasks chunk store-connected.

- [ ] **Step 5: Run the tests and the build**

Run: `npx vitest run src/views/__tests__/TasksView.spec.js && npm run build`
Expected: PASS, 3 tests; build succeeds with no `entry-chunk-budget` error. **If the build fails on the budget, do not raise it** — report instead.

- [ ] **Step 6: Commit**

```bash
git add src/views/TasksView.vue src/views/__tests__/TasksView.spec.js src/stores/projects.js
git commit -m "Give the Tasks view a project header"
```

---

### Task 8: Inline editing of the project title and description

**Files:**

- Modify: `src/views/TasksView.vue`
- Modify: `src/views/__tests__/TasksView.spec.js`

**Interfaces:**

- Consumes: `renameProject` and `describeProject` (Tasks 6–7).
- Produces: DOM hooks `.tasks-title-input`, `.tasks-description-input`.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('TasksView', …)` block:

```javascript
it('renames the project from the title, submitting once on Enter then blur', async () => {
  const projects = useProjectsStore()
  const rename = vi.spyOn(projects, 'renameProject').mockResolvedValue(null)

  const wrapper = mountView()
  await flushPromises()
  await wrapper.get('.tasks-title').trigger('click')
  const input = wrapper.get('.tasks-title-input')
  await input.setValue('Renamed')
  await input.trigger('keydown.enter')
  await input.trigger('blur')

  expect(rename).toHaveBeenCalledTimes(1)
  expect(rename).toHaveBeenCalledWith('p2', 'Renamed')
})

it('writes a description from the placeholder', async () => {
  const projects = useProjectsStore()
  const describe = vi.spyOn(projects, 'describeProject').mockResolvedValue(null)

  const wrapper = mountView()
  await flushPromises()
  await wrapper.get('.tasks-description').trigger('click')
  const input = wrapper.get('.tasks-description-input')
  await input.setValue('What this project is for')
  await input.trigger('keydown.enter')

  expect(describe).toHaveBeenCalledWith('p2', 'What this project is for')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/views/__tests__/TasksView.spec.js`
Expected: FAIL — no `.tasks-title-input`.

- [ ] **Step 3: Write the implementation**

Add to `<script setup>` in `src/views/TasksView.vue`:

```javascript
import { nextTick, ref } from 'vue'

const editingTitle = ref(false)
const titleDraft = ref('')
const titleInput = ref(null)

async function startTitleEdit() {
  if (isInbox.value) return
  titleDraft.value = current.value?.name ?? ''
  editingTitle.value = true
  await nextTick()
  titleInput.value?.focus()
  titleInput.value?.select()
}

async function submitTitle() {
  // Enter commits and unmounts the input, which fires blur; the second call
  // must be a no-op or every rename would be sent twice.
  if (!editingTitle.value) return
  const name = titleDraft.value.trim()
  editingTitle.value = false
  if (name && name !== current.value?.name) await projects.renameProject(project.value, name)
}

const editingDescription = ref(false)
const descriptionDraft = ref('')
const descriptionInput = ref(null)

async function startDescriptionEdit() {
  if (isInbox.value) return
  descriptionDraft.value = current.value?.description ?? ''
  editingDescription.value = true
  await nextTick()
  descriptionInput.value?.focus()
}

async function submitDescription() {
  // Same Enter-then-blur double fire as submitTitle.
  if (!editingDescription.value) return
  const description = descriptionDraft.value.trim()
  editingDescription.value = false
  if (description !== (current.value?.description ?? '')) {
    await projects.describeProject(project.value, description)
  }
}
```

Replace the title and description elements in the template:

```html
<input
  v-if="editingTitle"
  ref="titleInput"
  v-model="titleDraft"
  class="tasks-title-input"
  aria-label="Project name"
  @keydown.enter.prevent="submitTitle"
  @keydown.escape="editingTitle = false"
  @blur="submitTitle"
/>
<h1 v-else class="tasks-title" @click="startTitleEdit">{{ title }}</h1>

<input
  v-if="editingDescription"
  ref="descriptionInput"
  v-model="descriptionDraft"
  class="tasks-description-input"
  placeholder="Add a description"
  aria-label="Project description"
  @keydown.enter.prevent="submitDescription"
  @keydown.escape="editingDescription = false"
  @blur="submitDescription"
/>
<p v-else-if="!isInbox" class="tasks-description" @click="startDescriptionEdit">
  {{ current?.description || 'Add a description' }}
</p>
```

Add to `<style scoped>`:

```css
.tasks-title-input,
.tasks-description-input {
  display: block;
  width: 100%;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 2px 6px;
}

.tasks-title-input {
  margin: 18px 0 6px;
  font-size: 26px;
  font-weight: 700;
}

.tasks-description-input {
  margin: 0 0 24px;
  font-size: 14px;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/views/__tests__/TasksView.spec.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/views/TasksView.vue src/views/__tests__/TasksView.spec.js
git commit -m "Edit a project's name and description in place"
```

---

### Task 9: The task list and the inline composer

**Files:**

- Modify: `src/views/TasksView.vue`
- Modify: `src/views/__tests__/TasksView.spec.js`

**Interfaces:**

- Consumes: `useTaskItemsStore` (Task 6).
- Produces: DOM hooks `.task-row`, `.task-check`, `.task-content`, `.task-description`, `.add-task-btn`, `.add-task-row`.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('TasksView', …)` block:

```javascript
it('lists tasks with their descriptions', async () => {
  const items = useTaskItemsStore()
  items.items = [
    { id: 't1', content: 'Add auto-merge', description: 'Rather than waiting', completedAt: null },
  ]
  items.loadedProject = 'p2'

  const wrapper = mountView()
  await flushPromises()

  const row = wrapper.get('.task-row')
  expect(row.get('.task-content').text()).toBe('Add auto-merge')
  expect(row.get('.task-description').text()).toBe('Rather than waiting')
})

it('completes a task from its circle', async () => {
  const items = useTaskItemsStore()
  items.items = [{ id: 't1', content: 'Add auto-merge', description: null, completedAt: null }]
  items.loadedProject = 'p2'
  const setCompleted = vi.spyOn(items, 'setCompleted').mockResolvedValue(null)

  const wrapper = mountView()
  await flushPromises()
  await wrapper.get('.task-check').trigger('click')

  expect(setCompleted).toHaveBeenCalledWith('t1', true)
})

// Enter commits and unmounts the composer, which fires blur: without the
// guard the same task would be created twice.
it('creates a task once when Enter is followed by blur', async () => {
  const items = useTaskItemsStore()
  items.loadedProject = 'p2'
  const create = vi.spyOn(items, 'createItem').mockResolvedValue({ id: 't9' })

  const wrapper = mountView()
  await flushPromises()
  await wrapper.get('.add-task-btn').trigger('click')
  const input = wrapper.get('.add-task-row input')
  await input.setValue('Ship it')
  await input.trigger('keydown.enter')
  await input.trigger('blur')

  expect(create).toHaveBeenCalledTimes(1)
  expect(create).toHaveBeenCalledWith({ content: 'Ship it', projectId: 'p2' })
})

it('creates an Inbox task with no project', async () => {
  await router.push('/tasks?project=inbox')
  const items = useTaskItemsStore()
  items.loadedProject = 'inbox'
  const create = vi.spyOn(items, 'createItem').mockResolvedValue({ id: 't9' })

  const wrapper = mountView()
  await flushPromises()
  await wrapper.get('.add-task-btn').trigger('click')
  await wrapper.get('.add-task-row input').setValue('Ship it')
  await wrapper.get('.add-task-row input').trigger('keydown.enter')

  expect(create).toHaveBeenCalledWith({ content: 'Ship it', projectId: null })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/views/__tests__/TasksView.spec.js`
Expected: FAIL — no `.task-row`.

- [ ] **Step 3: Write the implementation**

Add to `<script setup>`:

```javascript
const composing = ref(false)
const draft = ref('')
const draftInput = ref(null)

async function startCompose() {
  draft.value = ''
  composing.value = true
  await nextTick()
  draftInput.value?.focus()
}

async function submitDraft() {
  // Same Enter-then-blur double fire as the title and description edits.
  if (!composing.value) return
  const content = draft.value.trim()
  composing.value = false
  if (!content) return
  await items.createItem({ content, projectId: isInbox.value ? null : project.value })
}
```

Add to the template, after the description:

```html
<ul class="task-rows">
  <li v-for="item in items.items" :key="item.id" class="task-row">
    <button
      class="task-check"
      type="button"
      :aria-label="`Complete ${item.content}`"
      @click="items.setCompleted(item.id, true)"
    ></button>
    <div class="task-body">
      <span class="task-content">{{ item.content }}</span>
      <span v-if="item.description" class="task-description">{{ item.description }}</span>
    </div>
  </li>
</ul>

<form v-if="composing" class="add-task-row" @submit.prevent="submitDraft">
  <input
    ref="draftInput"
    v-model="draft"
    placeholder="Task name"
    aria-label="Task name"
    @keydown.enter.prevent="submitDraft"
    @keydown.escape="composing = false"
    @blur="submitDraft"
  />
</form>
<button v-else class="add-task-btn" type="button" @click="startCompose">
  <span aria-hidden="true">+</span>
  <span>Add task</span>
</button>
```

Add to `<style scoped>`:

```css
.task-rows {
  list-style: none;
  margin: 0;
  padding: 0;
}

.task-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-color);
}

.task-check {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  flex: 0 0 auto;
  border: 1.5px solid var(--text-secondary);
  border-radius: 50%;
  background: none;
  cursor: pointer;
}

.task-check:hover {
  border-color: var(--text-primary);
}

.task-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.task-content {
  font-size: 14px;
}

.task-description {
  font-size: 13px;
  color: var(--text-secondary);
}

.add-task-row {
  display: flex;
  padding: 10px 0;
}

.add-task-row input {
  flex: 1;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 4px 8px;
}

.add-task-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 0;
  border: none;
  background: none;
  color: var(--text-secondary);
  font: inherit;
  cursor: pointer;
}

.add-task-btn:hover {
  color: var(--text-primary);
}
```

- [ ] **Step 4: Run the tests, the suite and the build**

Run: `npx vitest run && npm run build && npx oxlint .`
Expected: all pass; no `entry-chunk-budget` error.

- [ ] **Step 5: Commit**

```bash
git add src/views/TasksView.vue src/views/__tests__/TasksView.spec.js
git commit -m "List tasks and add them inline"
```

---

### Task 10: Dev and e2e fixture, and the end-to-end spec

**Files:**

- Modify: `vite.config.js` (`fixtureMailboxState`, and `handleWorkerTasksApi`)
- Modify: `e2e/vue.spec.js`

**Interfaces:**

- Consumes: the store and view from Tasks 6–9.
- Produces: a `task-items` branch in the tasks fixture backed by `state.taskItems`.

- [ ] **Step 1: Write the failing e2e test**

Append to `e2e/vue.spec.js`:

```javascript
test('Tasks: a task can be added to a project and completed', async ({ page }) => {
  await page.goto('/tasks')

  const sidebar = page.locator('.tasks-sidebar')
  await sidebar.locator('.new-project-btn').click()
  await sidebar.locator('.new-project-row input').fill('Githup')
  await sidebar.locator('.new-project-row input').press('Enter')
  await sidebar.locator('.project-item', { hasText: 'Githup' }).click()

  await expect(page.locator('.tasks-title')).toHaveText('Githup')
  await expect(page.locator('.tasks-description')).toHaveText('Add a description')

  await page.locator('.add-task-btn').click()
  await page.locator('.add-task-row input').fill('Add auto-merge feature')
  await page.locator('.add-task-row input').press('Enter')

  await expect(page.locator('.task-row')).toHaveCount(1)
  await expect(page.locator('.task-content')).toHaveText('Add auto-merge feature')

  // Completing hides it from the list; a reload proves the server agrees.
  await page.locator('.task-check').click()
  await expect(page.locator('.task-row')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.task-row')).toHaveCount(0)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test e2e/vue.spec.js --project=chromium -g "Tasks: a task"`
Expected: FAIL — the fixture 404s `/task-items`, so no row is ever created.

- [ ] **Step 3: Add the fixture**

In `vite.config.js`, add `taskItems: []` to the object created in `fixtureMailboxState`, alongside `projects: []`.

Then in `handleWorkerTasksApi`, immediately after the `if (segments[0] === 'projects') { … }` block, add:

```javascript
if (segments[0] === 'task-items') {
  const project = url.searchParams.get('project') ?? 'inbox'
  if (req.method === 'GET') {
    const includeCompleted = url.searchParams.get('completed') === '1'
    const items = state.taskItems
      .filter((item) =>
        project === 'inbox' ? item.projectId === null : item.projectId === project,
      )
      .filter((item) => includeCompleted || item.completedAt === null)
    return json(res, { items })
  }
  const body = await readBody(req)
  if (req.method === 'POST') {
    const item = {
      id: randomUUID(),
      projectId: body.projectId ?? null,
      parentId: null,
      content: String(body.content || '').slice(0, 500),
      description: body.description ?? null,
      dueDate: body.dueDate ?? null,
      completedAt: null,
      createdAt: new Date().toISOString(),
    }
    state.taskItems.push(item)
    return json(res, { item }, 201)
  }
  if (req.method === 'PATCH') {
    const item = state.taskItems.find((row) => row.id === body.id)
    if (!item) return json(res, { error: 'Task not found' }, 404)
    if (body.content !== undefined) item.content = body.content
    if (body.description !== undefined) item.description = body.description
    if (Object.hasOwn(body, 'projectId')) item.projectId = body.projectId
    if (Object.hasOwn(body, 'dueDate')) item.dueDate = body.dueDate
    // Completion stamps a time; it never deletes, matching the real handler.
    if (Object.hasOwn(body, 'completed')) {
      item.completedAt = body.completed ? new Date().toISOString() : null
    }
    return json(res, { item })
  }
  if (req.method === 'DELETE') {
    const before = state.taskItems.length
    state.taskItems = state.taskItems.filter((row) => row.id !== body.id)
    if (state.taskItems.length === before) return json(res, { error: 'Task not found' }, 404)
    return json(res, { ok: true })
  }
  return json(res, { error: 'Method not allowed' }, 405)
}
```

The existing `projects` fixture branch also needs the description the view reads. In its `POST` handler, add to the object it builds:

```javascript
          description: body.description ?? null,
```

and in its `PATCH` handler, alongside the name and parentId lines:

```javascript
if (Object.hasOwn(body, 'description')) project.description = body.description
```

- [ ] **Step 4: Run the e2e test to verify it passes**

Run: `npx playwright test e2e/vue.spec.js --project=chromium -g "Tasks: a task"`
Expected: PASS.

- [ ] **Step 5: Run the whole chromium e2e suite**

Run: `npx playwright test --project=chromium`
Expected: your new test passes. **Seven specs fail for reasons that predate this work** — Calendar settings, Reader Summarize, Due Today, Snoozed groups, Inbox Zero, and two Composer specs ("disables Send while sending", "Send Later"). Confirm that set is unchanged and do not fix them.

- [ ] **Step 6: Commit**

```bash
git add vite.config.js e2e/vue.spec.js
git commit -m "Cover the task list end to end"
```

---

### Task 11: Ship it

**Files:** none — deployment.

- [ ] **Step 1: Apply the migration**

Pushing `migrations/**` to `main` triggers `.github/workflows/migrate.yml`, which supplies `DATABASE_URL` from repo secrets. Push **only** the migration commit first, so the schema lands before anything reads it:

```bash
cd ~/Development/Projects/Cookie/Cookie-Web
git push origin <migration-commit-sha>:main
```

Then confirm the run applied it:

```bash
gh run list --workflow=migrate.yml --limit=1
gh run view <id> --log | grep 0054
```

Expected: `apply  0054_task_items.sql`.

- [ ] **Step 2: Push and deploy the Worker**

```bash
cd ~/Development/Projects/Cookie/Cookie-Worker
npm test && npm run lint && npm run typecheck
git push origin main
gh workflow run deploy.yml -f worker=cookie-web-tasks --ref main
gh run watch "$(gh run list --workflow=deploy.yml --limit=1 --json databaseId -q '.[0].databaseId')" --exit-status
```

Expected: both jobs succeed. Verify before continuing — the web app is about to depend on this endpoint.

- [ ] **Step 3: Push Cookie-Web**

```bash
cd ~/Development/Projects/Cookie/Cookie-Web
npx vitest run && npm run build
git push origin main
```

- [ ] **Step 4: Confirm the Vercel deployment reached READY**

An `ERROR` here is most likely the entry-chunk budget, which Step 3's local build should have caught.

- [ ] **Step 5: Smoke-test in production**

Open a project in the Tasks app: the breadcrumb and title render, the description placeholder is editable, `+ Add task` creates a task, the circle completes it, and a reload shows it gone. Then the Inbox: a task created there belongs to no project and appears under Inbox only.

---

## Notes for the executor

- **Tasks 1 and 6–10 are Cookie-Web; 2–5 are Cookie-Worker; 11 touches both.** Either repo order works, but nothing ships until Task 11, whose order is fixed.
- **Code blocks here are formatted with Cookie-Web's Prettier config, which omits semicolons.** Cookie-Worker uses them. Copy the snippets as-is and run that repo's own `npx prettier --write`; it restores them.
- **Do not raise `ENTRY_CHUNK_BUDGET_BYTES`.** If the build trips on it, keep the Tasks chunk connected to a store instead.
- **Deliberately not in this phase**: the detail panel, sub-task UI, labels, comments, reminders, the Display menu, the project `⋯` menu. `parent_id` and the cycle guard exist in the API but nothing in the UI creates a sub-task yet.
- **A known follow-on**: deleting a project now cascades to its tasks, but the sidebar's delete confirmation still names only sub-projects. Phase 2 or a follow-up must make that prompt name the tasks too, or it understates what is lost.
