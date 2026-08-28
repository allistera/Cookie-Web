# Task Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Tasks sidebar a nested, editable tree of Cookie-owned projects.

**Architecture:** A `task_projects` table with a self-referencing `parent_id`, served by CRUD endpoints on the existing `cookie-web-tasks` Worker at `/projects`. The client fetches a flat list into a Pinia store, flattens it into depth-annotated rows in a pure helper, and renders it in `TasksSidebar` with the same inline editing and drag-to-re-parent interactions `DocumentsSidebar` already uses.

**Tech Stack:** Cloudflare Workers + postgres.js (Cookie-Worker), Vue 3 + Pinia + Vite (Cookie-Web), Vitest everywhere, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-08-28-task-projects-design.md`

## Global Constraints

- **Two repos.** Paths starting `workers/` are in `Cookie-Worker`; everything else is in `Cookie-Web`. Both are siblings under `~/Development/Projects/Cookie/`.
- **Push straight to `main`** in both repos. No PRs.
- **Before any push to Cookie-Web:** `npm test` **and** `npm run build`. The build is where the entry-chunk budget (150000 bytes) is enforced; tests alone will not catch a violation.
- **Before any push to Cookie-Worker:** `npm test`, `npm run lint`, `npm run typecheck`.
- **Formatting:** `npx prettier --write` on every file touched. Cookie-Web additionally runs `npx oxlint .`, whose `anti-slop` rules reject runtime `typeof` narrowing — coerce at the boundary instead (`String(value ?? '')`).
- **Colour format:** `^#[0-9a-fA-F]{6}$`, lowercase hex, everywhere.
- **Inbox is never a row.** No task in this plan creates, seeds or special-cases an "Inbox" record. The static Inbox row already exists in `TasksSidebar` and must keep working.
- **Deploy order at the end:** migration → `cookie-web-tasks` → Cookie-Web. Never web first.

---

### Task 1: Migration for `task_projects`

**Files:**

- Create: `migrations/0053_task_projects.sql`

**Interfaces:**

- Consumes: nothing.
- Produces: table `public.task_projects` with columns `id uuid`, `user_id uuid`, `parent_id uuid`, `name text`, `color text`, `created_at timestamptz`.

- [ ] **Step 1: Write the migration**

Create `migrations/0053_task_projects.sql`:

```sql
-- Cookie-owned projects for the Tasks app: a self-nesting tree the Tasks
-- sidebar renders. Shaped after document_folders (migration 0036) so the
-- cascade and RLS posture match a table already proven in production, with
-- title/emoji swapped for name/color.
--
-- There is deliberately no "Inbox" row. Inbox is the name the UI gives to
-- tasks belonging to no project, so it needs no record and no seeding.

BEGIN;

CREATE TABLE public.task_projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  parent_id  uuid REFERENCES public.task_projects(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_projects_user_idx ON public.task_projects (user_id);

ALTER TABLE public.task_projects ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.task_projects FROM anon, authenticated;

COMMIT;
```

- [ ] **Step 2: Check the number is still free**

Run: `ls migrations | tail -5`
Expected: `0052_follow_up_reminders.sql` is the highest numbered file. If a `0053_*` already exists, renumber this file to the next free number and use that number for the rest of this task.

- [ ] **Step 3: Commit**

```bash
git add migrations/0053_task_projects.sql
git commit -m "Add the task_projects table"
```

---

### Task 2: `GET` and `POST /projects` in the Worker

**Files:**

- Create: `workers/cookie-web-tasks/src/projects.js`
- Create: `workers/cookie-web-tasks/test/projects.test.js`
- Modify: `workers/cookie-web-tasks/src/worker.js` (imports at the top; new branch in `route()` before the `documents` branch)

**Interfaces:**

- Consumes: the `task_projects` table from Task 1.
- Produces: `getProjects(sql, userId)`, `createProject(sql, userId, body)`, plus module-local `isUuid` and `MAX_NAME_LENGTH`. Response shapes: `GET` → `{ projects: [...] }`; `POST` → `{ project: {...} }` with status 201. Every row is `{ id, parentId, name, color, createdAt }`.

- [ ] **Step 1: Write the failing tests**

Create `workers/cookie-web-tasks/test/projects.test.js`:

```javascript
import { describe, expect, it } from 'vitest'
import { createProject, getProjects } from '../src/projects.js'
import { createMockSql } from './helpers.js'

const USER_ID = '99999999-9999-9999-9999-999999999999'
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const PARENT_ID = '22222222-2222-4222-8222-222222222222'

describe('GET /projects', () => {
  it('returns the caller rows as a flat list', async () => {
    const sql = createMockSql([
      [{ id: PROJECT_ID, parentId: null, name: 'Work', color: '#1a73e8', createdAt: 't0' }],
    ])

    const response = await getProjects(sql, USER_ID)

    expect(response.status).toBe(200)
    expect((await response.json()).projects).toHaveLength(1)
    expect(sql.calls[0].text).toContain('FROM task_projects')
    expect(sql.calls[0].values).toContain(USER_ID)
  })
})

describe('POST /projects', () => {
  it('creates a root project and defaults the colour', async () => {
    const sql = createMockSql([
      [{ id: PROJECT_ID, parentId: null, name: 'Work', color: '#1a73e8', createdAt: 't0' }],
    ])

    const response = await createProject(sql, USER_ID, { name: 'Work' })

    expect(response.status).toBe(201)
    expect((await response.json()).project.name).toBe('Work')
  })

  it('rejects a blank name', async () => {
    const sql = createMockSql([])
    const response = await createProject(sql, USER_ID, { name: '   ' })
    expect(response.status).toBe(400)
  })

  it('rejects a colour that is not six hex digits', async () => {
    const sql = createMockSql([])
    const response = await createProject(sql, USER_ID, { name: 'Work', color: 'red' })
    expect(response.status).toBe(400)
  })

  // An unknown parent means the tree would gain an unreachable node.
  it('404s a parentId the caller does not own', async () => {
    const sql = createMockSql([[]])
    const response = await createProject(sql, USER_ID, { name: 'Sub', parentId: PARENT_ID })
    expect(response.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd workers/cookie-web-tasks && npx vitest run test/projects.test.js`
Expected: FAIL — `Failed to resolve import "../src/projects.js"`.

- [ ] **Step 3: Write the implementation**

Create `workers/cookie-web-tasks/src/projects.js`:

```javascript
// Cookie-owned projects for the Tasks app. Shaped after documents.js: the
// same id/text validation, the same user-scoped statements, and a flat list
// on GET that the client assembles into a tree.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLOR_RE = /^#[0-9a-fA-F]{6}$/
const MAX_NAME_LENGTH = 120
const DEFAULT_COLOR = '#1a73e8'

/** @param {any} value */
function isUuid(value) {
  return value === String(value ?? '') && UUID_RE.test(value)
}

/** @param {any} value */
function cleanName(value) {
  if (!(value?.trim instanceof Function)) return null
  const name = value.trim().slice(0, MAX_NAME_LENGTH)
  return name || null
}

/** @param {any} value */
function cleanColor(value) {
  if (value === undefined || value === null) return DEFAULT_COLOR
  const color = String(value)
  return COLOR_RE.test(color) ? color.toLowerCase() : null
}

/** @param {import('postgres').Sql} sql @param {string} userId @param {string} id */
function fetchOwnedProject(sql, userId, id) {
  return sql`SELECT id FROM task_projects WHERE id = ${id} AND user_id = ${userId}`
}

/**
 * GET /projects — every project the caller owns, ordered by name. Flat, not
 * nested: the sidebar builds the tree client-side.
 *
 * @param {import('postgres').Sql} sql
 * @param {string} userId
 */
export async function getProjects(sql, userId) {
  const projects = await sql`
    SELECT p.id, p.parent_id AS "parentId", p.name, p.color, p.created_at AS "createdAt"
    FROM task_projects p
    WHERE p.user_id = ${userId}
    ORDER BY p.name ASC
  `
  return Response.json({ projects })
}

/**
 * POST /projects — { name, color?, parentId? }.
 *
 * @param {import('postgres').Sql} sql
 * @param {string} userId
 * @param {any} body
 */
export async function createProject(sql, userId, body) {
  const name = cleanName(body?.name)
  const color = cleanColor(body?.color)
  if (!name || !color) {
    return Response.json({ error: 'A name and a #rrggbb colour are required' }, { status: 400 })
  }

  const parentId = body?.parentId ?? null
  if (parentId !== null) {
    if (!isUuid(parentId) || !(await fetchOwnedProject(sql, userId, parentId)).length) {
      return Response.json({ error: 'Project not found' }, { status: 404 })
    }
  }

  const [project] = await sql`
    INSERT INTO task_projects (user_id, parent_id, name, color)
    VALUES (${userId}, ${parentId}, ${name}, ${color})
    RETURNING id, parent_id AS "parentId", name, color, created_at AS "createdAt"
  `
  return Response.json({ project }, { status: 201 })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd workers/cookie-web-tasks && npx vitest run test/projects.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire the route**

In `workers/cookie-web-tasks/src/worker.js`, add to the import block near the top (imports are alphabetical by module path):

```javascript
import { createProject, getProjects } from './projects.js'
```

Then add this branch inside `route()`, immediately **before** the `if (segments[0] === 'documents')` branch:

```javascript
if (segments[0] === 'projects') {
  if (segments.length > 1) return Response.json({ error: 'Not Found' }, { status: 404 })
  if (request.method === 'GET') return getProjects(sql, userId)
  if (request.method !== 'POST' && request.method !== 'PATCH' && request.method !== 'DELETE') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  let body
  try {
    body = await readJsonBody(request)
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (request.method === 'POST') return createProject(sql, userId, body)
  return Response.json({ error: 'Method not allowed' }, { status: 405 })
}
```

The `PATCH`/`DELETE` arms are filled in by Tasks 3 and 4; until then they answer 405 rather than 404, which is the honest response for a route that exists but has no handler yet.

- [ ] **Step 6: Run the whole worker suite**

Run: `cd ../.. && npm test && npm run lint && npm run typecheck`
Expected: all suites pass, no lint or type errors.

- [ ] **Step 7: Commit**

```bash
git add workers/cookie-web-tasks/src/projects.js workers/cookie-web-tasks/test/projects.test.js workers/cookie-web-tasks/src/worker.js
git commit -m "Serve task projects from the tasks Worker"
```

---

### Task 3: `PATCH /projects` with the cycle guard

**Files:**

- Modify: `workers/cookie-web-tasks/src/projects.js`
- Modify: `workers/cookie-web-tasks/test/projects.test.js`
- Modify: `workers/cookie-web-tasks/src/worker.js` (replace the `PATCH` arm from Task 2 Step 5)

**Interfaces:**

- Consumes: `isUuid`, `cleanName`, `cleanColor`, `fetchOwnedProject` from Task 2.
- Produces: `updateProject(sql, userId, body)` returning `{ project }`, and `isAncestorOf(sql, userId, projectId, candidateParentId)` returning a boolean.

- [ ] **Step 1: Write the failing tests**

Append to `workers/cookie-web-tasks/test/projects.test.js` (and add `updateProject` to the import from `../src/projects.js`):

```javascript
describe('PATCH /projects', () => {
  it('renames a project', async () => {
    const sql = createMockSql([
      [{ id: PROJECT_ID }],
      [{ id: PROJECT_ID, parentId: null, name: 'Renamed', color: '#1a73e8', createdAt: 't0' }],
    ])

    const response = await updateProject(sql, USER_ID, { id: PROJECT_ID, name: 'Renamed' })

    expect(response.status).toBe(200)
    expect((await response.json()).project.name).toBe('Renamed')
  })

  it('404s an id the caller does not own', async () => {
    const sql = createMockSql([[]])
    const response = await updateProject(sql, USER_ID, { id: PROJECT_ID, name: 'Stolen' })
    expect(response.status).toBe(404)
  })

  // Re-parenting onto your own descendant severs the subtree from the root:
  // invisible in the sidebar, still in the table.
  it('rejects a move that would make a project its own descendant', async () => {
    const sql = createMockSql([
      [{ id: PROJECT_ID }], // the project being moved exists
      [{ id: PARENT_ID }], // the proposed parent exists
      [{ ok: 1 }], // ancestry walk finds the project above the parent
    ])

    const response = await updateProject(sql, USER_ID, {
      id: PROJECT_ID,
      parentId: PARENT_ID,
    })

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('own descendant')
    // The guard must run before any write.
    expect(sql.calls.some((call) => call.text.includes('UPDATE task_projects'))).toBe(false)
  })

  it('allows a move to the root with parentId null', async () => {
    const sql = createMockSql([
      [{ id: PROJECT_ID }],
      [{ id: PROJECT_ID, parentId: null, name: 'Work', color: '#1a73e8', createdAt: 't0' }],
    ])

    const response = await updateProject(sql, USER_ID, { id: PROJECT_ID, parentId: null })

    expect(response.status).toBe(200)
    expect((await response.json()).project.parentId).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd workers/cookie-web-tasks && npx vitest run test/projects.test.js`
Expected: FAIL — `updateProject is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `workers/cookie-web-tasks/src/projects.js`:

```javascript
/**
 * True when `projectId` sits on the ancestry chain above `candidateParentId`,
 * which is exactly the case where re-parenting would create a cycle. The walk
 * climbs from the proposed parent to the root, so it terminates on the tree's
 * depth rather than its size.
 *
 * @param {import('postgres').Sql} sql
 * @param {string} userId
 * @param {string} projectId
 * @param {string} candidateParentId
 */
export async function isAncestorOf(sql, userId, projectId, candidateParentId) {
  const rows = await sql`
    WITH RECURSIVE ancestry AS (
      SELECT id, parent_id FROM task_projects
      WHERE id = ${candidateParentId} AND user_id = ${userId}
      UNION ALL
      SELECT p.id, p.parent_id FROM task_projects p
      JOIN ancestry a ON p.id = a.parent_id AND p.user_id = ${userId}
    )
    SELECT 1 FROM ancestry WHERE id = ${projectId} LIMIT 1
  `
  return rows.length > 0
}

/**
 * PATCH /projects — { id, name?, color?, parentId? }. parentId: null moves the
 * project to the root.
 *
 * @param {import('postgres').Sql} sql
 * @param {string} userId
 * @param {any} body
 */
export async function updateProject(sql, userId, body) {
  const id = isUuid(body?.id) ? String(body.id) : null
  if (!id) return Response.json({ error: 'A valid project id is required' }, { status: 400 })
  if (!(await fetchOwnedProject(sql, userId, id)).length) {
    return Response.json({ error: 'Project not found' }, { status: 404 })
  }

  const hasName = Object.hasOwn(body, 'name')
  const hasColor = Object.hasOwn(body, 'color')
  const hasParent = Object.hasOwn(body, 'parentId')
  const name = hasName ? cleanName(body.name) : null
  const color = hasColor ? cleanColor(body.color) : null
  if ((hasName && !name) || (hasColor && !color)) {
    return Response.json({ error: 'A name and a #rrggbb colour are required' }, { status: 400 })
  }
  if (!hasName && !hasColor && !hasParent) {
    return Response.json({ error: 'At least one change is required' }, { status: 400 })
  }

  const parentId = hasParent ? (body.parentId ?? null) : null
  if (hasParent && parentId !== null) {
    if (parentId === id) {
      return Response.json({ error: 'A project cannot be its own parent' }, { status: 400 })
    }
    if (!isUuid(parentId) || !(await fetchOwnedProject(sql, userId, parentId)).length) {
      return Response.json({ error: 'Project not found' }, { status: 404 })
    }
    if (await isAncestorOf(sql, userId, id, parentId)) {
      return Response.json({ error: 'A project cannot become its own descendant' }, { status: 400 })
    }
  }

  const [project] = await sql`
    UPDATE task_projects p SET
      name      = COALESCE(${hasName ? name : null}, p.name),
      color     = COALESCE(${hasColor ? color : null}, p.color),
      parent_id = CASE WHEN ${hasParent}::boolean THEN ${parentId}::uuid ELSE p.parent_id END
    WHERE p.id = ${id} AND p.user_id = ${userId}
    RETURNING p.id, p.parent_id AS "parentId", p.name, p.color, p.created_at AS "createdAt"
  `
  return Response.json({ project })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd workers/cookie-web-tasks && npx vitest run test/projects.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Wire the route**

In `workers/cookie-web-tasks/src/worker.js`, extend the import to `import { createProject, getProjects, updateProject } from './projects.js';` and replace the projects branch's trailing line:

```javascript
if (request.method === 'POST') return createProject(sql, userId, body)
if (request.method === 'PATCH') return updateProject(sql, userId, body)
return Response.json({ error: 'Method not allowed' }, { status: 405 })
```

- [ ] **Step 6: Run the whole worker suite**

Run: `cd ../.. && npm test && npm run lint && npm run typecheck`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add workers/cookie-web-tasks/src/projects.js workers/cookie-web-tasks/test/projects.test.js workers/cookie-web-tasks/src/worker.js
git commit -m "Let projects be renamed, recoloured and re-parented"
```

---

### Task 4: `DELETE /projects`

**Files:**

- Modify: `workers/cookie-web-tasks/src/projects.js`
- Modify: `workers/cookie-web-tasks/test/projects.test.js`
- Modify: `workers/cookie-web-tasks/src/worker.js`

**Interfaces:**

- Consumes: `isUuid` from Task 2.
- Produces: `deleteProject(sql, userId, body)` returning `{ ok: true }`.

- [ ] **Step 1: Write the failing tests**

Append to `workers/cookie-web-tasks/test/projects.test.js` (adding `deleteProject` to the import):

```javascript
describe('DELETE /projects', () => {
  it('deletes an owned project', async () => {
    const sql = createMockSql([[{ id: PROJECT_ID }]])
    const response = await deleteProject(sql, USER_ID, { id: PROJECT_ID })

    expect(response.status).toBe(200)
    expect((await response.json()).ok).toBe(true)
    expect(sql.calls[0].text).toContain('DELETE FROM task_projects')
  })

  it('404s an id the caller does not own', async () => {
    const sql = createMockSql([[]])
    const response = await deleteProject(sql, USER_ID, { id: PROJECT_ID })
    expect(response.status).toBe(404)
  })

  it('400s a malformed id', async () => {
    const sql = createMockSql([])
    const response = await deleteProject(sql, USER_ID, { id: 'not-a-uuid' })
    expect(response.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd workers/cookie-web-tasks && npx vitest run test/projects.test.js`
Expected: FAIL — `deleteProject is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `workers/cookie-web-tasks/src/projects.js`:

```javascript
/**
 * DELETE /projects — { id }. Sub-projects go with it via the schema's
 * ON DELETE CASCADE; nothing else references a project yet.
 *
 * @param {import('postgres').Sql} sql
 * @param {string} userId
 * @param {any} body
 */
export async function deleteProject(sql, userId, body) {
  const id = isUuid(body?.id) ? String(body.id) : null
  if (!id) return Response.json({ error: 'A valid project id is required' }, { status: 400 })

  const deleted = await sql`
    DELETE FROM task_projects WHERE id = ${id} AND user_id = ${userId} RETURNING id
  `
  if (!deleted.length) return Response.json({ error: 'Project not found' }, { status: 404 })
  return Response.json({ ok: true })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd workers/cookie-web-tasks && npx vitest run test/projects.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Wire the route**

In `workers/cookie-web-tasks/src/worker.js`, extend the import to include `deleteProject` and replace the branch's trailing line:

```javascript
if (request.method === 'POST') return createProject(sql, userId, body)
if (request.method === 'PATCH') return updateProject(sql, userId, body)
return deleteProject(sql, userId, body)
```

- [ ] **Step 6: Run everything and commit**

Run: `cd ../.. && npm test && npm run lint && npm run typecheck`

```bash
git add workers/cookie-web-tasks/src/projects.js workers/cookie-web-tasks/test/projects.test.js workers/cookie-web-tasks/src/worker.js
git commit -m "Delete a project and its sub-projects"
```

---

### Task 5: Share the colour palette

**Files:**

- Create: `src/lib/palette.js`
- Modify: `src/views/SettingsView.vue` (remove the local `LABEL_PALETTE` array, import it instead)

**Interfaces:**

- Consumes: nothing.
- Produces: `export const PALETTE` — an array of 8 lowercase `#rrggbb` strings — and `nextPaletteColor(usedColors)` returning the first palette entry not present in `usedColors`, falling back to `PALETTE[0]` when all are used.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/palette.spec.js`:

```javascript
import { describe, expect, it } from 'vitest'

import { PALETTE, nextPaletteColor } from '../palette'

describe('palette', () => {
  it('is eight lowercase six-digit hex colours', () => {
    expect(PALETTE).toHaveLength(8)
    for (const color of PALETTE) expect(color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('offers the first unused colour', () => {
    expect(nextPaletteColor([])).toBe(PALETTE[0])
    expect(nextPaletteColor([PALETTE[0], PALETTE[1]])).toBe(PALETTE[2])
  })

  // A full palette should keep working rather than hand back undefined.
  it('falls back to the first colour once every one is used', () => {
    expect(nextPaletteColor([...PALETTE])).toBe(PALETTE[0])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/palette.spec.js`
Expected: FAIL — cannot resolve `../palette`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/palette.js`:

```javascript
// The colour set Settings offers for labels, shared so projects pick from the
// same eight rather than introducing a second visual vocabulary.
export const PALETTE = [
  '#e5484d',
  '#e58f1a',
  '#2f9e44',
  '#1a73e8',
  '#7048e8',
  '#d6409f',
  '#0ca678',
  '#64748b',
]

// New things open on a colour nothing else is using, so a fresh project or
// calendar looks distinct without anyone touching the picker.
export function nextPaletteColor(usedColors) {
  const used = new Set(usedColors)
  return PALETTE.find((color) => !used.has(color)) ?? PALETTE[0]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/palette.spec.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Point Settings at the shared module**

In `src/views/SettingsView.vue`, delete the local `const LABEL_PALETTE = [...]` array (around line 244) and add to the imports:

```javascript
import { PALETTE as LABEL_PALETTE } from '../lib/palette'
```

Everything else in that file keeps referring to `LABEL_PALETTE` unchanged, so the template and `newLabel` default need no edits.

- [ ] **Step 6: Verify Settings still passes**

Run: `npx vitest run src/views/__tests__/SettingsView.spec.js`
Expected: PASS, unchanged count.

- [ ] **Step 7: Commit**

```bash
git add src/lib/palette.js src/lib/__tests__/palette.spec.js src/views/SettingsView.vue
git commit -m "Share the label colour palette"
```

---

### Task 6: Parameterise the sidebar expansion store

**Files:**

- Modify: `src/lib/documentsSidebarFolders.js`
- Modify: `src/components/DocumentsSidebar.vue` (two call sites)
- Modify: `src/lib/__tests__/documentsSidebarFolders.spec.js` if it exists; otherwise create it

**Interfaces:**

- Consumes: nothing.
- Produces: `getStoredExpandedIds(key)` and `saveExpandedIds(key, ids)`. The existing `getStoredExpandedFolderIds()` / `saveExpandedFolderIds(ids)` remain as thin wrappers bound to `'cookie-documents-expanded-folders'`, so `DocumentsSidebar` keeps working unchanged if a call site is missed.

- [ ] **Step 1: Write the failing test**

Create or extend `src/lib/__tests__/documentsSidebarFolders.spec.js`:

```javascript
import { beforeEach, describe, expect, it } from 'vitest'

import {
  getStoredExpandedFolderIds,
  getStoredExpandedIds,
  saveExpandedIds,
} from '../documentsSidebarFolders'

beforeEach(() => localStorage.clear())

describe('expansion persistence by key', () => {
  it('keeps two sidebars from sharing one set', () => {
    saveExpandedIds('cookie-tasks-expanded-projects', ['p1'])
    saveExpandedIds('cookie-documents-expanded-folders', ['f1'])

    expect(getStoredExpandedIds('cookie-tasks-expanded-projects')).toEqual(['p1'])
    expect(getStoredExpandedFolderIds()).toEqual(['f1'])
  })

  it('returns an empty list for an unknown key', () => {
    expect(getStoredExpandedIds('nothing-stored-here')).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/documentsSidebarFolders.spec.js`
Expected: FAIL — `getStoredExpandedIds is not a function`.

- [ ] **Step 3: Write the implementation**

Replace the body of `src/lib/documentsSidebarFolders.js` below `sanitizeStoredFolderIds` (keep that function and `MAX_STORED_IDS` exactly as they are) with:

```javascript
const EXPANDED_FOLDERS_KEY = 'cookie-documents-expanded-folders'

export function getStoredExpandedIds(key) {
  try {
    return sanitizeStoredFolderIds(JSON.parse(localStorage.getItem(key) || '[]'))
  } catch {
    return []
  }
}

export function saveExpandedIds(key, ids) {
  const cleaned = sanitizeStoredFolderIds(Array.from(ids))
  try {
    localStorage.setItem(key, JSON.stringify(cleaned))
  } catch (error) {
    console.error('Failed to save expanded ids:', error)
  }
  return cleaned
}

export function getStoredExpandedFolderIds() {
  return getStoredExpandedIds(EXPANDED_FOLDERS_KEY)
}

export function saveExpandedFolderIds(ids) {
  return saveExpandedIds(EXPANDED_FOLDERS_KEY, ids)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/documentsSidebarFolders.spec.js src/components/__tests__/DocumentsSidebar.spec.js`
Expected: PASS. `DocumentsSidebar` is unchanged behaviourally because its two calls go through the wrappers.

- [ ] **Step 5: Commit**

```bash
git add src/lib/documentsSidebarFolders.js src/lib/__tests__/documentsSidebarFolders.spec.js
git commit -m "Key sidebar expansion state by storage key"
```

---

### Task 7: The project tree helper

**Files:**

- Create: `src/lib/taskProjectsTree.js`
- Create: `src/lib/__tests__/taskProjectsTree.spec.js`

**Interfaces:**

- Consumes: nothing.
- Produces: `flattenProjectTree(projects, expandedIds)` where `projects` is an array of `{ id, parentId, name, color }` and `expandedIds` is a `Set`. Returns an array of `{ item, depth, expanded, hasChildren }` in render order, omitting rows inside a collapsed parent.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/taskProjectsTree.spec.js`:

```javascript
import { describe, expect, it } from 'vitest'

import { flattenProjectTree } from '../taskProjectsTree'

const project = (id, parentId = null, name = id) => ({ id, parentId, name, color: '#1a73e8' })

describe('flattenProjectTree', () => {
  it('nests children under an expanded parent and marks depth', () => {
    const rows = flattenProjectTree(
      [project('work'), project('api', 'work'), project('home')],
      new Set(['work']),
    )

    expect(rows.map((row) => [row.item.id, row.depth])).toEqual([
      ['api', 1],
      ['home', 0],
      ['work', 0],
    ])
  })

  it('hides children of a collapsed parent without orphaning them', () => {
    const rows = flattenProjectTree([project('work'), project('api', 'work')], new Set())

    expect(rows.map((row) => row.item.id)).toEqual(['work'])
    expect(rows[0].hasChildren).toBe(true)
    expect(rows[0].expanded).toBe(false)
  })

  // A parent that no longer exists must not take its children down with it.
  it('surfaces a project whose parent does not resolve at the root', () => {
    const rows = flattenProjectTree([project('orphan', 'deleted-parent')], new Set())

    expect(rows.map((row) => [row.item.id, row.depth])).toEqual([['orphan', 0]])
  })

  // Two projects pointing at each other are reachable from no root at all.
  it('breaks a parent cycle by pulling a member up to the root', () => {
    const rows = flattenProjectTree([project('a', 'b'), project('b', 'a')], new Set(['a', 'b']))

    expect(rows).toHaveLength(2)
    expect(rows.some((row) => row.depth === 0)).toBe(true)
  })
})
```

Note the first test's expected order: rows are sorted by name within a parent, and `api` sorts before `home` only because it is nested under `work`, which sorts after `home`. Read the assertion as written — it is the render order, not the input order.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/taskProjectsTree.spec.js`
Expected: FAIL — cannot resolve `../taskProjectsTree`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/taskProjectsTree.js`:

```javascript
// Flattens the project forest into the ordered, depth-annotated rows the Tasks
// sidebar renders — recursion stays here, in a pure function, instead of in a
// recursive component. Rows inside collapsed projects are omitted.
//
// The two failure modes are the ones documentsTree.js already paid for: a
// project whose parentId no longer resolves (or which sits in a cycle) is
// treated as a root so its subtree never silently vanishes, and reachability
// is computed ignoring expansion, so a collapsed parent hides its children
// rather than orphaning them.
export function flattenProjectTree(projects, expandedIds) {
  const byParent = new Map([[null, []]])
  const ids = new Set(projects.map((project) => project.id))
  for (const project of projects) {
    const parent = project.parentId && ids.has(project.parentId) ? project.parentId : null
    if (!byParent.has(parent)) byParent.set(parent, [])
    byParent.get(parent).push(project)
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.name.localeCompare(b.name))
  }

  const reachable = new Set()
  const mark = (parentId) => {
    for (const child of byParent.get(parentId) ?? []) {
      if (reachable.has(child.id)) continue
      reachable.add(child.id)
      mark(child.id)
    }
  }
  mark(null)
  for (const orphan of projects) {
    if (reachable.has(orphan.id)) continue
    reachable.add(orphan.id)
    byParent.get(null).push(orphan)
    // Break the cycle so the render walk terminates at this new root.
    const siblings = byParent.get(orphan.parentId) ?? []
    const at = siblings.indexOf(orphan)
    if (at !== -1) siblings.splice(at, 1)
    mark(orphan.id)
  }

  const rows = []
  const walk = (parentId, depth) => {
    for (const project of byParent.get(parentId) ?? []) {
      const children = byParent.get(project.id) ?? []
      const expanded = expandedIds.has(project.id)
      rows.push({ item: project, depth, expanded, hasChildren: children.length > 0 })
      if (expanded) walk(project.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/taskProjectsTree.spec.js`
Expected: PASS, 4 tests. If the first test's order assertion fails, fix the _assertion_ to the order the sort produces — do not remove the sort.

- [ ] **Step 5: Commit**

```bash
git add src/lib/taskProjectsTree.js src/lib/__tests__/taskProjectsTree.spec.js
git commit -m "Flatten the project forest into sidebar rows"
```

---

### Task 8: The projects store

**Files:**

- Create: `src/stores/projects.js`
- Create: `src/stores/__tests__/projects.spec.js`

**Interfaces:**

- Consumes: `TASKS_API_URL` from `src/lib/apiWorkers.js`, `nextPaletteColor` and `PALETTE` from Task 5.
- Produces: `useProjectsStore()` with state `{ projects: [], isLoaded: false, isLoading: false }` and actions `loadProjects({ force })`, `createProject({ name, parentId })`, `renameProject(id, name)`, `recolorProject(id, color)`, `moveProject(id, parentId)`, `deleteProject(id)`. Every mutating action returns the updated project (or `true` for delete) on success and `null`/`false` on failure, having notified.

- [ ] **Step 1: Write the failing tests**

Create `src/stores/__tests__/projects.spec.js`:

```javascript
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProjectsStore } from '../projects'
import { useInboxStore } from '../inbox'

const PROJECT = { id: 'p1', parentId: null, name: 'Work', color: '#1a73e8', createdAt: 't0' }

let store

beforeEach(() => {
  setActivePinia(createPinia())
  store = useProjectsStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
})

function stubFetch(handler) {
  vi.stubGlobal('fetch', vi.fn(handler))
}

describe('projects store', () => {
  it('loads once and refetches only when forced', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ projects: [PROJECT] }) }))

    await store.loadProjects()
    await store.loadProjects()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(store.projects).toHaveLength(1)

    await store.loadProjects({ force: true })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('adds a created project to local state', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ project: PROJECT }) }))

    const created = await store.createProject({ name: 'Work' })

    expect(created.id).toBe('p1')
    expect(store.projects).toHaveLength(1)
  })

  // A rejected write must not leave the sidebar showing something the server
  // never accepted.
  it('rolls a failed rename back and notifies', async () => {
    store.projects = [{ ...PROJECT }]
    const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})
    stubFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }))

    const result = await store.renameProject('p1', 'Renamed')

    expect(result).toBeNull()
    expect(store.projects[0].name).toBe('Work')
    expect(notify).toHaveBeenCalledWith('Failed to rename the project.', 'error')
  })

  it('removes a deleted project and its descendants from local state', async () => {
    store.projects = [{ ...PROJECT }, { id: 'p2', parentId: 'p1', name: 'API', color: '#2f9e44' }]
    stubFetch(async () => ({ ok: true, json: async () => ({ ok: true }) }))

    await store.deleteProject('p1')

    expect(store.projects).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/stores/__tests__/projects.spec.js`
Expected: FAIL — cannot resolve `../projects`.

- [ ] **Step 3: Write the implementation**

Create `src/stores/projects.js`:

```javascript
import { defineStore } from 'pinia'

import { getAuth0 } from '../auth0-client'
import { TASKS_API_URL } from '../lib/apiWorkers'
import { nextPaletteColor } from '../lib/palette'
import { useInboxStore } from './inbox'

// Cookie-owned projects for the Tasks sidebar. Shaped after stores/documents.js:
// the same auth headers, the same request helper, and local state updated
// optimistically with a rollback when the server refuses.
export const useProjectsStore = defineStore('projects', {
  state: () => ({
    projects: [],
    isLoaded: false,
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

    async request(method, body) {
      const headers = await this.authHeaders(
        body !== undefined ? { 'Content-Type': 'application/json' } : {},
      )
      const options = { method, headers }
      if (body !== undefined) options.body = JSON.stringify(body)
      const response = await fetch(`${TASKS_API_URL}/projects`, options)
      if (!response.ok) {
        const error = new Error(`${method} /projects responded ${response.status}`)
        error.status = response.status
        throw error
      }
      return response.json()
    },

    async loadProjects({ force = false } = {}) {
      if (this.isLoaded && !force) return
      this.isLoading = true
      try {
        const { projects } = await this.request('GET')
        this.projects = projects
        this.isLoaded = true
      } catch (error) {
        console.error('Failed to load projects:', error)
        this.notify('Failed to load projects.', 'error')
      } finally {
        this.isLoading = false
      }
    },

    // Created rows come back from the server rather than being guessed at
    // locally, so the id and colour in state are the ones that were stored.
    async createProject({ name, parentId = null }) {
      const color = nextPaletteColor(this.projects.map((project) => project.color))
      try {
        const { project } = await this.request('POST', { name, color, parentId })
        this.projects.push(project)
        return project
      } catch (error) {
        console.error('Failed to create project:', error)
        this.notify('Failed to create the project.', 'error')
        return null
      }
    },

    async patchProject(id, changes, failureMessage) {
      const project = this.projects.find((row) => row.id === id)
      if (!project) return null
      const previous = { ...project }
      Object.assign(project, changes)
      try {
        const { project: updated } = await this.request('PATCH', { id, ...changes })
        Object.assign(project, updated)
        return project
      } catch (error) {
        console.error('Failed to update project:', error)
        Object.assign(project, previous)
        this.notify(failureMessage, 'error')
        return null
      }
    },

    renameProject(id, name) {
      return this.patchProject(id, { name }, 'Failed to rename the project.')
    },

    recolorProject(id, color) {
      return this.patchProject(id, { color }, 'Failed to recolour the project.')
    },

    moveProject(id, parentId) {
      return this.patchProject(id, { parentId }, 'Failed to move the project.')
    },

    // The server cascades to sub-projects, so local state has to drop the
    // whole subtree or the sidebar would keep rendering rows that are gone.
    async deleteProject(id) {
      const doomed = new Set([id])
      let grew = true
      while (grew) {
        grew = false
        for (const project of this.projects) {
          if (!doomed.has(project.id) && doomed.has(project.parentId)) {
            doomed.add(project.id)
            grew = true
          }
        }
      }
      const previous = this.projects
      this.projects = this.projects.filter((project) => !doomed.has(project.id))
      try {
        await this.request('DELETE', { id })
        return true
      } catch (error) {
        console.error('Failed to delete project:', error)
        this.projects = previous
        this.notify('Failed to delete the project.', 'error')
        return false
      }
    },
  },
})
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/stores/__tests__/projects.spec.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/stores/projects.js src/stores/__tests__/projects.spec.js
git commit -m "Add a projects store for the Tasks sidebar"
```

---

### Task 9: Render the tree in the sidebar

**Files:**

- Modify: `src/components/TasksSidebar.vue`
- Modify: `src/components/__tests__/TasksSidebar.spec.js`

**Interfaces:**

- Consumes: `useProjectsStore` (Task 8), `flattenProjectTree` (Task 7), `getStoredExpandedIds`/`saveExpandedIds` (Task 6).
- Produces: the rendered tree. Rows carry class `nav-item project-item`, indent by `10 + depth * 14`px, and the chevron is `.project-arrow`.

- [ ] **Step 1: Write the failing tests**

Replace the second test in `src/components/__tests__/TasksSidebar.spec.js` (`keeps Inbox out of the projects list`) with these, keeping the other two as they are:

```javascript
it('keeps Inbox out of the projects list', async () => {
  const store = useProjectsStore()
  store.projects = [{ id: 'p1', parentId: null, name: 'Work', color: '#1a73e8' }]
  store.isLoaded = true

  const wrapper = mountSidebar()
  await flushPromises()

  const names = wrapper.findAll('.tasks-projects-nav .nav-item').map((row) => row.text())
  expect(names).toEqual(['Work'])
  expect(names).not.toContain('Inbox')
})

it('nests a sub-project under its expanded parent', async () => {
  const store = useProjectsStore()
  store.projects = [
    { id: 'p1', parentId: null, name: 'Work', color: '#1a73e8' },
    { id: 'p2', parentId: 'p1', name: 'API', color: '#2f9e44' },
  ]
  store.isLoaded = true

  const wrapper = mountSidebar()
  await flushPromises()
  expect(wrapper.findAll('.tasks-projects-nav .nav-item')).toHaveLength(1)

  await wrapper.get('.project-arrow').trigger('click')

  const rows = wrapper.findAll('.tasks-projects-nav .nav-item')
  expect(rows).toHaveLength(2)
  expect(rows[1].text()).toContain('API')
  expect(rows[1].attributes('style')).toContain('padding-left: 24px')
})

it('shows the empty hint when there are no projects', async () => {
  const wrapper = mountSidebar()
  await flushPromises()
  expect(wrapper.get('.tasks-projects-empty').text()).toBe('No projects yet')
})
```

Add to that file's imports:

```javascript
import { flushPromises } from '@vue/test-utils'
import { PALETTE } from '../../lib/palette'
import { useProjectsStore } from '../../stores/projects'
```

and stub the network in `beforeEach`, after `setActivePinia(createPinia())`:

```javascript
vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({ ok: true, json: async () => ({ projects: [] }) })),
)
```

(`vi` needs adding to the `vitest` import.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/__tests__/TasksSidebar.spec.js`
Expected: FAIL — no `.project-arrow` element.

- [ ] **Step 3: Write the implementation**

In `src/components/TasksSidebar.vue`, replace the whole `<script setup>` block with:

```javascript
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { getStoredExpandedIds, saveExpandedIds } from '../lib/documentsSidebarFolders'
import { PALETTE } from '../lib/palette'
import { flattenProjectTree } from '../lib/taskProjectsTree'
import { useProjectsStore } from '../stores/projects'

const EXPANDED_KEY = 'cookie-tasks-expanded-projects'

const route = useRoute()
const store = useProjectsStore()

// Which projects are open, persisted so a reload restores the same tree.
const expandedIds = ref(new Set(getStoredExpandedIds(EXPANDED_KEY)))
watch(expandedIds, (ids) => saveExpandedIds(EXPANDED_KEY, ids))

const rows = computed(() => flattenProjectTree(store.projects, expandedIds.value))

onMounted(() => store.loadProjects())

function toggle(id) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}
```

Then replace the projects `<nav>` in the template with:

```html
<nav class="sidebar-nav tasks-projects-nav" aria-label="My projects">
  <router-link
    v-for="row in rows"
    :key="row.item.id"
    :to="{ path: '/tasks', query: { project: row.item.id } }"
    class="nav-item project-item"
    :class="{ active: route.query.project === row.item.id }"
    :style="{ paddingLeft: `${10 + row.depth * 14}px` }"
  >
    <button
      v-if="row.hasChildren"
      class="project-arrow"
      type="button"
      :aria-expanded="row.expanded"
      :aria-label="`${row.expanded ? 'Collapse' : 'Expand'} ${row.item.name}`"
      @click.prevent.stop="toggle(row.item.id)"
    >
      <span class="material-symbols-outlined" aria-hidden="true">
        {{ row.expanded ? 'keyboard_arrow_down' : 'keyboard_arrow_right' }}
      </span>
    </button>
    <span v-else class="project-arrow-spacer" aria-hidden="true"></span>
    <span class="material-symbols-outlined" :style="{ color: row.item.color }">tag</span>
    <span class="nav-text">{{ row.item.name }}</span>
  </router-link>
  <p v-if="!rows.length" class="tasks-projects-empty">No projects yet</p>
</nav>
```

Add to the component's `<style scoped>` block:

```css
.project-arrow,
.project-arrow-spacer {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  margin-left: -4px;
  border: none;
  background: none;
  padding: 0;
  color: inherit;
  cursor: pointer;
}

.project-arrow .material-symbols-outlined {
  font-size: 16px;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/__tests__/TasksSidebar.spec.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify the entry-chunk budget still holds**

Run: `npm run build`
Expected: `✓ built in …` with no `entry-chunk-budget` error. The old `useInboxStore()` call is gone, replaced by the real `useProjectsStore` import — which keeps the Tasks chunk store-connected, so the budget stays satisfied. If the build fails here, the chunk grouping changed: re-add `useInboxStore()` with a comment and open an issue rather than raising the budget.

- [ ] **Step 6: Commit**

```bash
git add src/components/TasksSidebar.vue src/components/__tests__/TasksSidebar.spec.js
git commit -m "Render the project tree in the Tasks sidebar"
```

---

### Task 10: Create, rename and delete inline

**Files:**

- Modify: `src/components/TasksSidebar.vue`
- Modify: `src/components/__tests__/TasksSidebar.spec.js`

**Interfaces:**

- Consumes: `useProjectsStore` actions `createProject`, `renameProject`, `deleteProject` (Task 8).
- Produces: no new exports. New DOM hooks: `.new-project-btn` on the section label, `.new-project-row` for the create form, `.project-rename-input`, and `.row-action-btn` buttons inside `.row-actions`.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('TasksSidebar', …)` block:

```javascript
it('creates a project from the inline row', async () => {
  const store = useProjectsStore()
  store.isLoaded = true
  const create = vi.spyOn(store, 'createProject').mockResolvedValue({
    id: 'p1',
    parentId: null,
    name: 'Work',
    color: '#1a73e8',
  })

  const wrapper = mountSidebar()
  await flushPromises()
  await wrapper.get('.new-project-btn').trigger('click')
  await wrapper.get('.new-project-row input').setValue('Work')
  await wrapper.get('.new-project-row').trigger('submit')

  expect(create).toHaveBeenCalledWith({ name: 'Work', parentId: null })
})

// The row opens on an unused palette colour, so a project can be created
// without touching the picker; picking one recolours the created project.
it('offers the palette and recolours the new project when one is picked', async () => {
  const store = useProjectsStore()
  store.isLoaded = true
  vi.spyOn(store, 'createProject').mockResolvedValue({
    id: 'p1',
    parentId: null,
    name: 'Work',
    color: PALETTE[0],
  })
  const recolor = vi.spyOn(store, 'recolorProject').mockResolvedValue(null)

  const wrapper = mountSidebar()
  await flushPromises()
  await wrapper.get('.new-project-btn').trigger('click')

  const swatches = wrapper.findAll('.new-project-row .color-swatch')
  expect(swatches).toHaveLength(PALETTE.length)

  await swatches[5].trigger('click')
  await wrapper.get('.new-project-row input').setValue('Work')
  await wrapper.get('.new-project-row').trigger('submit')
  await flushPromises()

  expect(recolor).toHaveBeenCalledWith('p1', PALETTE[5])
})

// Enter commits and unmounts the input, which fires blur: without a guard
// the same rename would be submitted twice.
it('submits a rename once when Enter is followed by blur', async () => {
  const store = useProjectsStore()
  store.projects = [{ id: 'p1', parentId: null, name: 'Work', color: '#1a73e8' }]
  store.isLoaded = true
  const rename = vi.spyOn(store, 'renameProject').mockResolvedValue(null)

  const wrapper = mountSidebar()
  await flushPromises()
  await wrapper.get('.project-item').trigger('dblclick')
  const input = wrapper.get('.project-rename-input')
  await input.setValue('Renamed')
  await input.trigger('keydown.enter')
  await input.trigger('blur')

  expect(rename).toHaveBeenCalledTimes(1)
  expect(rename).toHaveBeenCalledWith('p1', 'Renamed')
})

it('confirms before deleting a project that has children', async () => {
  const store = useProjectsStore()
  store.projects = [
    { id: 'p1', parentId: null, name: 'Work', color: '#1a73e8' },
    { id: 'p2', parentId: 'p1', name: 'API', color: '#2f9e44' },
  ]
  store.isLoaded = true
  const remove = vi.spyOn(store, 'deleteProject').mockResolvedValue(true)
  const confirm = vi.fn(() => false)
  vi.stubGlobal('confirm', confirm)

  const wrapper = mountSidebar()
  await flushPromises()
  await wrapper.get('.project-item .row-action-btn[data-action="delete"]').trigger('click')

  expect(confirm).toHaveBeenCalledWith('Delete Work and its 1 sub-project?')
  expect(remove).not.toHaveBeenCalled()
})

it('deletes a childless project without asking', async () => {
  const store = useProjectsStore()
  store.projects = [{ id: 'p1', parentId: null, name: 'Work', color: '#1a73e8' }]
  store.isLoaded = true
  const remove = vi.spyOn(store, 'deleteProject').mockResolvedValue(true)
  const confirm = vi.fn(() => true)
  vi.stubGlobal('confirm', confirm)

  const wrapper = mountSidebar()
  await flushPromises()
  await wrapper.get('.project-item .row-action-btn[data-action="delete"]').trigger('click')

  expect(confirm).not.toHaveBeenCalled()
  expect(remove).toHaveBeenCalledWith('p1')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/__tests__/TasksSidebar.spec.js`
Expected: FAIL — no `.new-project-btn`.

- [ ] **Step 3: Write the implementation**

Add to `<script setup>` in `src/components/TasksSidebar.vue`, after `toggle`:

```javascript
import { nextTick } from 'vue'

// Inline create row: null when hidden, '' for a root project, or a project id
// when adding a sub-project of it.
const newProjectFor = ref(null)
const newProjectName = ref('')
const newProjectInput = ref(null)
// Null means "whatever colour the store picks", so creating without touching
// the swatches still lands on an unused palette entry.
const newProjectColor = ref(null)

async function showNewProject(parentId) {
  newProjectFor.value = parentId ?? ''
  newProjectName.value = ''
  newProjectColor.value = null
  await nextTick()
  newProjectInput.value?.focus()
}

async function submitNewProject() {
  // Enter submits and unmounts the input, which fires blur; the second call
  // must be a no-op or every Enter would create the project twice.
  if (newProjectFor.value === null) return
  const name = newProjectName.value.trim()
  const parentId = newProjectFor.value === '' ? null : newProjectFor.value
  newProjectFor.value = null
  if (!name) return
  const chosen = newProjectColor.value
  const created = await store.createProject({ name, parentId })
  if (!created) return
  if (chosen && chosen !== created.color) await store.recolorProject(created.id, chosen)
  if (parentId) expandedIds.value = new Set(expandedIds.value).add(parentId)
}

const renamingId = ref(null)
const renameName = ref('')
const renameInput = ref(null)

async function startRename(project) {
  renamingId.value = project.id
  renameName.value = project.name
  await nextTick()
  renameInput.value?.[0]?.focus?.()
  renameInput.value?.[0]?.select?.()
}

async function submitRename(project) {
  // Same Enter-then-blur double-fire as submitNewProject.
  if (renamingId.value !== project.id) return
  const name = renameName.value.trim()
  renamingId.value = null
  if (name && name !== project.name) await store.renameProject(project.id, name)
}

function childCount(id) {
  return store.projects.filter((project) => project.parentId === id).length
}

// The cascade is the one destructive edge here: sub-projects go with the
// parent and there is no undo endpoint, so name the count before doing it.
function removeProject(project) {
  const children = childCount(project.id)
  const plural = children === 1 ? 'sub-project' : 'sub-projects'
  if (children && !confirm(`Delete ${project.name} and its ${children} ${plural}?`)) return
  store.deleteProject(project.id)
}
```

Replace the section label with:

```html
<div class="sb-section-label tasks-projects-label">
  <span>My Projects</span>
  <button
    class="new-project-btn"
    type="button"
    title="New project"
    aria-label="New project"
    @click.stop="showNewProject(null)"
  >
    <span class="material-symbols-outlined" aria-hidden="true">add</span>
  </button>
</div>
```

Inside the row `<router-link>`, replace the name span with the rename input plus name, and add the actions before the closing tag:

```html
<input
  v-if="renamingId === row.item.id"
  ref="renameInput"
  v-model="renameName"
  class="project-rename-input"
  :aria-label="`Rename ${row.item.name}`"
  @click.prevent.stop
  @keydown.enter.prevent="submitRename(row.item)"
  @keydown.escape="renamingId = null"
  @blur="submitRename(row.item)"
/>
<span v-else class="nav-text">{{ row.item.name }}</span>
<span class="row-actions" @click.prevent.stop>
  <button
    class="row-action-btn"
    data-action="add"
    :title="`New project in ${row.item.name}`"
    :aria-label="`New project in ${row.item.name}`"
    @click="showNewProject(row.item.id)"
  >
    <span class="material-symbols-outlined">add</span>
  </button>
  <button
    class="row-action-btn"
    data-action="delete"
    :title="`Delete ${row.item.name}`"
    :aria-label="`Delete ${row.item.name}`"
    @click="removeProject(row.item)"
  >
    <span class="material-symbols-outlined">delete</span>
  </button>
</span>
```

Add `@dblclick.prevent="startRename(row.item)"` to the `<router-link>` opening tag, and add the create form after the `v-for` rows, before the empty hint:

```html
<form v-if="newProjectFor !== null" class="new-project-row" @submit.prevent="submitNewProject">
  <input
    ref="newProjectInput"
    v-model="newProjectName"
    class="project-rename-input"
    placeholder="Project name"
    aria-label="New project name"
    @keydown.escape="newProjectFor = null"
    @blur="submitNewProject"
  />
  <span class="color-swatches">
    <button
      v-for="color in PALETTE"
      :key="color"
      type="button"
      class="color-swatch"
      :class="{ chosen: newProjectColor === color }"
      :style="{ backgroundColor: color }"
      :aria-label="`Use colour ${color}`"
      @mousedown.prevent
      @click="newProjectColor = color"
    ></button>
  </span>
</form>
```

Change the empty hint's condition to `v-if="!rows.length && newProjectFor === null"`.

Add to `<style scoped>`:

```css
.tasks-projects-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.new-project-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: -5px -4px -5px 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  padding: 0;
  cursor: pointer;
}

.new-project-btn:hover,
.new-project-btn:focus-visible {
  background-color: var(--bg-hover);
  color: var(--text-primary);
  outline: none;
}

/* Hidden by opacity, not display: display-none rows became unreachable to
   assistive tech and to WebKit hit testing in the documents sidebar. */
.project-item .row-actions {
  display: inline-flex;
  margin-left: auto;
  gap: 2px;
  opacity: 0;
}

.project-item:hover .row-actions,
.project-item:focus-within .row-actions {
  opacity: 1;
}

.row-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  overflow: hidden;
  flex-shrink: 0;
  border: none;
  background: none;
  padding: 1px;
  cursor: pointer;
  color: inherit;
  opacity: 0.65;
  border-radius: 4px;
}

.row-action-btn:hover {
  opacity: 1;
}

.row-action-btn .material-symbols-outlined {
  font-size: 15px;
}

.new-project-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
}

.project-rename-input {
  flex: 1;
  min-width: 0;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 1px 4px;
}

.color-swatches {
  display: inline-flex;
  gap: 3px;
  flex: 0 0 auto;
}

/* mousedown is prevented on each swatch so clicking one does not blur the
   name input, which would submit the row before the colour registers. */
.color-swatch {
  width: 12px;
  height: 12px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 3px;
  cursor: pointer;
}

.color-swatch.chosen {
  border-color: var(--text-primary);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/__tests__/TasksSidebar.spec.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/TasksSidebar.vue src/components/__tests__/TasksSidebar.spec.js
git commit -m "Create, rename and delete projects inline"
```

---

### Task 11: Drag to re-parent

**Files:**

- Modify: `src/components/TasksSidebar.vue`
- Modify: `src/components/__tests__/TasksSidebar.spec.js`

**Interfaces:**

- Consumes: `moveProject` from Task 8.
- Produces: no new exports. Rows become `draggable="true"` and gain `.dragging`; drop targets gain `.drop-target`.

- [ ] **Step 1: Write the failing test**

Append inside the `describe` block:

```javascript
it('re-parents a project when dropped onto another', async () => {
  const store = useProjectsStore()
  store.projects = [
    { id: 'p1', parentId: null, name: 'Work', color: '#1a73e8' },
    { id: 'p2', parentId: null, name: 'Admin', color: '#2f9e44' },
  ]
  store.isLoaded = true
  const move = vi.spyOn(store, 'moveProject').mockResolvedValue(null)

  const wrapper = mountSidebar()
  await flushPromises()
  const rows = wrapper.findAll('.project-item')
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }

  // Rows render alphabetically, so Admin is first and Work second.
  await rows[0].trigger('dragstart', { dataTransfer })
  await rows[1].trigger('dragover', { dataTransfer })
  await rows[1].trigger('drop')

  expect(move).toHaveBeenCalledWith('p2', 'p1')
})

it('ignores a drop onto the row being dragged', async () => {
  const store = useProjectsStore()
  store.projects = [{ id: 'p1', parentId: null, name: 'Work', color: '#1a73e8' }]
  store.isLoaded = true
  const move = vi.spyOn(store, 'moveProject').mockResolvedValue(null)

  const wrapper = mountSidebar()
  await flushPromises()
  const row = wrapper.get('.project-item')
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }

  await row.trigger('dragstart', { dataTransfer })
  await row.trigger('drop')

  expect(move).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/__tests__/TasksSidebar.spec.js`
Expected: FAIL — `moveProject` never called.

- [ ] **Step 3: Write the implementation**

Add to `<script setup>`:

```javascript
// Drag a project row onto another to re-parent it, or onto the section label
// for the root. The client only blocks the obvious self-drop; the server owns
// the cycle rule, so a drop onto a descendant fails there with a message.
const dragId = ref(null)
const dropId = ref(undefined)

function onDragStart(project, event) {
  dragId.value = project.id
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', project.id)
}

function onDragOver(targetId, event) {
  if (!dragId.value || dragId.value === targetId) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  dropId.value = targetId
}

function onDrop(targetId) {
  if (dragId.value && dragId.value !== targetId) store.moveProject(dragId.value, targetId)
  dragId.value = null
  dropId.value = undefined
}

function onDragEnd() {
  dragId.value = null
  dropId.value = undefined
}
```

Add these bindings to the row `<router-link>`:

```html
draggable="true" :class="{ dragging: dragId === row.item.id, 'drop-target': dropId === row.item.id
}" @dragstart="onDragStart(row.item, $event)" @dragover="onDragOver(row.item.id, $event)"
@dragleave="dropId = undefined" @drop.prevent="onDrop(row.item.id)" @dragend="onDragEnd"
```

Merge the new `:class` entries into the existing `:class` object on that element rather than adding a second `:class` attribute — Vue keeps only the last one.

Add the same three handlers to the section label so the root is a drop target:

```html
@dragover="onDragOver(null, $event)" @dragleave="dropId = undefined" @drop.prevent="onDrop(null)"
:class="{ 'drop-target': dropId === null }"
```

Add to `<style scoped>`:

```css
.project-item.dragging {
  opacity: 0.5;
}

.drop-target {
  outline: 1.5px dashed currentColor;
  outline-offset: -1.5px;
  border-radius: 6px;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/__tests__/TasksSidebar.spec.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run the full suite and the build**

Run: `npm test && npm run build && npx oxlint . && npx prettier --check src/components/TasksSidebar.vue`
Expected: all pass, no entry-chunk error.

- [ ] **Step 6: Commit**

```bash
git add src/components/TasksSidebar.vue src/components/__tests__/TasksSidebar.spec.js
git commit -m "Drag a project onto another to re-parent it"
```

---

### Task 12: Dev and e2e fixture, and the end-to-end spec

**Files:**

- Modify: `vite.config.js` (the `handleWorkerTasksApi` function and the `fixtureMailboxState` initial bucket)
- Modify: `e2e/vue.spec.js`

**Interfaces:**

- Consumes: the store and sidebar from Tasks 8–11.
- Produces: a `/projects` branch in the tasks fixture handler backed by `state.projects`.

- [ ] **Step 1: Write the failing e2e test**

Append to `e2e/vue.spec.js`:

```javascript
test('Tasks projects nest, collapse, and survive a reload', async ({ page }) => {
  await page.goto('/tasks')

  const sidebar = page.locator('.tasks-sidebar')
  await expect(sidebar.locator('.nav-item', { hasText: 'Inbox' })).toBeVisible()
  await expect(sidebar.locator('.tasks-projects-empty')).toHaveText('No projects yet')

  await sidebar.locator('.new-project-btn').click()
  await sidebar.locator('.new-project-row input').fill('Work')
  await sidebar.locator('.new-project-row input').press('Enter')
  await expect(sidebar.locator('.project-item')).toHaveCount(1)

  // A sub-project appears under its parent, which auto-expands to show it.
  await sidebar.locator('.project-item').hover()
  await sidebar.locator('.project-item .row-action-btn[data-action="add"]').click()
  await sidebar.locator('.new-project-row input').fill('API')
  await sidebar.locator('.new-project-row input').press('Enter')
  await expect(sidebar.locator('.project-item')).toHaveCount(2)

  await sidebar.locator('.project-arrow').click()
  await expect(sidebar.locator('.project-item')).toHaveCount(1)

  await page.reload()
  await expect(sidebar.locator('.project-item')).toHaveCount(1)
  await expect(sidebar.locator('.project-item')).toContainText('Work')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test e2e/vue.spec.js --project=chromium -g "Tasks projects nest"`
Expected: FAIL — the fixture answers 404 for `/projects`, so the sidebar shows the load error and never renders a row.

- [ ] **Step 3: Add the fixture**

In `vite.config.js`, add `projects: []` to the object created in `fixtureMailboxState` (alongside `rules: []` and `scheduledSends: []`).

Then in `handleWorkerTasksApi`, immediately after the `if (segments[0] === 'documents') { … }` block, add:

```javascript
if (segments[0] === 'projects') {
  if (req.method === 'GET') {
    return json(res, {
      projects: [...state.projects].sort((a, b) => a.name.localeCompare(b.name)),
    })
  }
  const body = await readBody(req)
  if (req.method === 'POST') {
    const project = {
      id: randomUUID(),
      parentId: body.parentId ?? null,
      name: String(body.name || '').slice(0, 120),
      color: body.color || '#1a73e8',
      createdAt: new Date().toISOString(),
    }
    state.projects.push(project)
    return json(res, { project }, 201)
  }
  if (req.method === 'PATCH') {
    const project = state.projects.find((row) => row.id === body.id)
    if (!project) return json(res, { error: 'Project not found' }, 404)
    if (body.name !== undefined) project.name = body.name
    if (body.color !== undefined) project.color = body.color
    if (Object.hasOwn(body, 'parentId')) project.parentId = body.parentId
    return json(res, { project })
  }
  if (req.method === 'DELETE') {
    const doomed = new Set([body.id])
    let grew = true
    while (grew) {
      grew = false
      for (const project of state.projects) {
        if (!doomed.has(project.id) && doomed.has(project.parentId)) {
          doomed.add(project.id)
          grew = true
        }
      }
    }
    state.projects = state.projects.filter((project) => !doomed.has(project.id))
    return json(res, { ok: true })
  }
  return json(res, { error: 'Method not allowed' }, 405)
}
```

- [ ] **Step 4: Run the e2e test to verify it passes**

Run: `npx playwright test e2e/vue.spec.js --project=chromium -g "Tasks projects nest"`
Expected: PASS.

- [ ] **Step 5: Run the whole chromium e2e suite**

Run: `npx playwright test --project=chromium`
Expected: the new test passes. Five specs fail for reasons that predate this work (Calendar settings, Reader Summarize, Due Today, Snoozed groups, Inbox Zero) — confirm those are the only failures, and that the count is unchanged from before your first commit.

- [ ] **Step 6: Commit**

```bash
git add vite.config.js e2e/vue.spec.js
git commit -m "Cover the project tree end to end"
```

---

### Task 13: Ship it

**Files:** none — this task is deployment.

**Interfaces:**

- Consumes: every task above, committed.

- [ ] **Step 1: Apply the migration**

```bash
cd ~/Development/Projects/Cookie/Cookie-Web
DATABASE_URL='<the IPv4-reachable Supabase pooler URL>' ./migrations/migrate.sh
```

`migrate.sh` applies pending files in filename order and records them in
`schema_migrations`, so re-running is a no-op. Expected output includes a line
for `0053_task_projects.sql`. Read the connection string from wherever the
project's secrets live — never paste it into a chat.

- [ ] **Step 2: Push the Worker**

```bash
cd ~/Development/Projects/Cookie/Cookie-Worker
npm test && npm run lint && npm run typecheck
git push origin main
```

- [ ] **Step 3: Deploy the Worker**

```bash
gh workflow run deploy.yml -f worker=cookie-web-tasks --ref main
gh run watch "$(gh run list --workflow=deploy.yml --limit=1 --json databaseId -q '.[0].databaseId')" --exit-status
```

Expected: both jobs succeed. Verify before continuing — the web app is about to depend on this endpoint.

- [ ] **Step 4: Push Cookie-Web**

```bash
cd ~/Development/Projects/Cookie/Cookie-Web
npm test && npm run build
git push origin main
```

- [ ] **Step 5: Confirm the Vercel deployment reached READY**

Check the deployment for the pushed commit is `READY`, not `ERROR`. An `ERROR` here is most likely the entry-chunk budget; the local `npm run build` in Step 4 is what should have caught it.

- [ ] **Step 6: Smoke-test in production**

Open the Tasks app: Inbox is present, "No projects yet" shows, creating a project works, a sub-project nests, collapsing persists across a reload, and deleting a parent warns about its children.

---

## Notes for the executor

- **Tasks 1–4 are Cookie-Worker; 5–12 are Cookie-Web; 13 touches both.** They can be done in either repo order, but nothing ships until Task 13, and Task 13's order is fixed.
- **The five pre-existing e2e failures are not yours.** Confirm the set is unchanged rather than trying to fix them.
- **Do not raise `ENTRY_CHUNK_BUDGET_BYTES`.** If the build fails on it, the fix is to keep the Tasks chunk connected to a store, not to move the line.
