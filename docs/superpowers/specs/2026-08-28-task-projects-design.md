# Task projects: a nested project tree in the Tasks sidebar

Status: designed, not implemented. Spans Cookie-Web and Cookie-Worker.

## Problem

The Tasks sidebar has a "My Projects" section that renders from an empty
list. Nothing in Cookie has a concept of a project: the `tasks` table has no
project column, and the only nesting-capable source available is Todoist,
whose projects carry a `parent_id`.

Cookie should own projects itself rather than mirroring Todoist's, so the
tree is Cookie's own data and does not depend on a third-party account.

## Scope

In scope: a `task_projects` table, CRUD endpoints, and a nested, editable
tree in the Tasks sidebar.

Out of scope for this phase, deliberately:

- Tasks belonging to projects. Nothing links `tasks` to `task_projects` yet,
  so `GET /tasks` gains no `?project=` filter — it would return everything.
- Task creation. The tasks API still only completes and reschedules what the
  overnight run gathered; there is no create endpoint and this does not add
  one.
- Content in `TasksView`. Selecting a project routes to `/tasks?project=<id>`
  and the view still shows its empty state. The tree is navigation with
  nowhere to lead until tasks land in a later phase.

## Inbox

Inbox is where a task with no project belongs. It is **not** a
`task_projects` row and never becomes one.

- The UI renders it as a static row above "My Projects", routing to
  `/tasks?project=inbox`. That value is a filter, not an id.
- When task creation arrives, a task created without a project is stored with
  a null project and therefore appears in Inbox. There is no default project
  to look up, seed per user, or backfill.
- The awkward questions answer themselves: Inbox cannot be renamed,
  deleted or nested, because there is no row to act on. None of
  the CRUD paths need a guard for it.

The alternative — a seeded row flagged `is_inbox`, the way migration 0023
seeds five default calendars — would make "every task belongs to a project"
literally true, at the cost of a guard on every mutating path and a backfill
for existing users. Not worth it for a property nothing depends on.

The sidebar row ships ahead of the rest of this design: it is static markup
with no backing data, so it costs nothing to add early, and it leads to the
same empty `TasksView` the project rows will until tasks exist.

## Decisions

| Decision       | Choice                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| Ownership      | Cookie-native projects, not a Todoist mirror                           |
| Management UI  | Inline in the sidebar, mirroring document folders                      |
| Attributes     | Name only — no colour, no emoji                                        |
| API home       | `cookie-web-tasks`, alongside `/tasks` and `/documents`                |
| Frontend state | A Pinia store, `stores/projects.js`, modelled on `stores/documents.js` |
| Ordering       | Alphabetical within a parent; no manual ordering                       |
| Inbox          | A rule, not a row: the name for tasks belonging to no project          |

The through-line: the Documents sidebar already solves the nested-tree,
inline-editing, drag-to-re-parent problem in this codebase. Every choice
here follows that pattern rather than inventing a second one.

## Data model

Migration `0053_task_projects.sql` (0052 is taken by follow-up reminders):

```sql
CREATE TABLE public.task_projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  parent_id  uuid REFERENCES public.task_projects(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_projects_user_idx ON public.task_projects (user_id);
ALTER TABLE public.task_projects ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.task_projects FROM anon, authenticated;
```

This is `document_folders` with `title` renamed to `name` and `emoji` dropped,
so cascade behaviour and RLS posture match a table that is already proven.

- **`task_projects`, not `projects`.** A bare `projects` reads as a
  workspace-wide concept; this table belongs to the Tasks app.
- **`parent_id` cascades on delete.** Deleting a parent deletes its
  sub-projects. Folders can afford this because documents survive via
  `ON DELETE SET NULL`; projects own nothing yet, so nothing is orphaned.
  It is the one destructive edge in the feature, so the UI confirms before
  deleting a project that has children.
- **No colour and no emoji.** A project is its name and its place in the
  tree. The sidebar marks rows with a `#`, the way the Documents sidebar
  already marks its tag rows, so there is nothing to pick when creating one
  and no second visual vocabulary to maintain.
- **No `position` column.** Ordering is alphabetical by name within each
  parent, as the documents tree does. Manual ordering would need a position
  column, reorder endpoints and drag-to-sort; it is cheap to add later.
- **No depth cap.** The API rejects a re-parent that would create a cycle,
  which is the constraint that matters. Depth beyond that is indentation.

## API

A `segments[0] === 'projects'` branch in `cookie-web-tasks/src/worker.js`,
rejecting sub-paths, reading the JSON body once and dispatching by method —
the shape the `documents` branch already has. Handlers live in a new
`src/projects.js`; the worker keeps only routing.

| Route              | Body                       | Response                                                             |
| ------------------ | -------------------------- | -------------------------------------------------------------------- |
| `GET /projects`    | —                          | `{ projects: [{ id, parentId, name, createdAt }] }`, ordered by name |
| `POST /projects`   | `{ name, parentId? }`      | the created row, 201                                                 |
| `PATCH /projects`  | `{ id, name?, parentId? }` | the updated row                                                      |
| `DELETE /projects` | `{ id }`                   | `{ ok: true }`                                                       |

- `GET` returns a **flat** list; the tree is assembled client-side, exactly
  as `getDocuments` returns flat folders for `flattenDocumentsTree`.
- Names are trimmed and length-capped through the same `cleanText` helper the
  documents handlers use.
- `parentId` must reference a project the caller owns, else 404.
  `parentId: null` on `PATCH` moves a project to the root, which is what
  dropping onto the section header does.
- **A project cannot become its own descendant.** Dragging a parent onto its
  own child would cut a subtree loose from the root: invisible in the
  sidebar, still in the table. The re-parent path walks the proposed parent's
  ancestors in a recursive CTE and rejects a cycle with 400 before writing.
- Every statement is scoped by `user_id`, so someone else's id is a 404
  rather than an authorization error — the posture `fetchOwnedTask` and the
  documents handlers already take.
- No rate limiting. The `allowRequest` budget guards AI and blob calls; plain
  CRUD (labels, calendars, folders) is not gated either.

## Frontend

### Tree helper

A new `src/lib/taskProjectsTree.js` rather than reusing
`flattenDocumentsTree`: that function interleaves two node types, sorts
documents into folders, and tags rows `kind: 'folder' | 'document'`. A
single-type tree would carry that machinery for nothing.

Two behaviours are ported verbatim, because the documents tree already paid
for both:

- A project whose `parent_id` does not resolve, or which sits in a cycle, is
  pulled up to the root, so a subtree can never silently vanish.
- Reachability is computed ignoring expansion, so a collapsed parent hides
  its children rather than orphaning them.

### Expansion persistence

`lib/documentsSidebarFolders.js` is already generic apart from a hard-coded
storage key. Parameterise it by key and reuse it for
`cookie-tasks-expanded-projects`, keeping the 500-id cap and the try/catch
around `localStorage`.

### Store

`stores/projects.js`, modelled on `stores/documents.js`: a `request()` helper
over `TASKS_API_URL/projects`, `loadProjects()` guarded by a loaded flag with
a `force` option, and create/rename/move/delete that update local state first
and notify through the inbox store on failure.

This also replaces the `useInboxStore()` call currently in `TasksSidebar`,
which exists only to keep the Tasks chunk store-connected for the
entry-chunk budget. With a real store import that workaround goes, and its
comment with it.

### Sidebar

The "My Projects" section becomes the tree, matching the document-folder
interactions one for one:

- A `+` on the section header opens an inline row holding a single name
  input. Enter commits, Escape cancels.
- Double-click renames in place. The rename and create rows both carry the
  Enter-then-blur guard `DocumentsSidebar` documents: Enter commits and
  unmounts the input, which fires `blur`, so the second call must be a no-op
  or every rename would submit twice.
- Hover actions per row: add a sub-project, delete. Hidden with `opacity`,
  never `display: none` — display-none rows became unreachable to assistive
  tech and to WebKit hit-testing.
- Drag a project onto another to re-parent, or onto the section header for
  the root, with the same `drop-target` outline. The client blocks the
  obvious self-drop; the server owns the cycle rule.
- Rows indent by `10 + depth * 14`px, with a chevron on anything that has
  children, and a `#` marker in place of an icon.
- Deleting a project that has children asks for confirmation first, naming
  the count: "Delete Work and its 3 sub-projects?". This is the one new
  interaction pattern in the feature — the app has no `confirm()` anywhere
  today, and `DocumentsSidebar` deletes a folder outright. The difference is
  the cascade: a folder's documents survive via `ON DELETE SET NULL`, while
  a project's children are deleted with it and there is no undo endpoint to
  restore them. A childless project deletes without a prompt.
- The empty state stays: "No projects yet" until the first project exists.

## Testing

- **Worker** (`test/projects.test.js`, `createMockSql`): each verb's happy
  path; an empty name and an unknown `parentId` rejected;
  another user's id returning 404; and a re-parent onto a descendant
  rejected before any UPDATE runs.
- **Tree helper**: ordering and depth, a collapsed parent hiding rather than
  orphaning children, and both failure modes — unresolvable `parent_id` and
  a parent cycle — surfacing at the root.
- **Store**: load-once-then-force, and a failed create/rename/move/delete
  rolling local state back and notifying.
- **Sidebar** (modelled on `DocumentsSidebar.spec.js`): tree rendering,
  expand/collapse, inline create and rename including the double-fire guard,
  delete confirmation, drag-to-re-parent, empty state.
- **e2e** (`e2e/vue.spec.js`): create a project, nest a second under it,
  collapse, reload, assert the expansion persisted. Requires a `/projects`
  branch in `vite.config.js`'s `handleWorkerTasksApi` and a `projects` bucket
  in the per-session fixture state; without it the SPA's cross-origin call
  reaches the real Worker and 401s.

## Rollout

Order matters — each step is useless or broken without the one before it:

1. Apply migration `0053`. Additive, no contract phase, safe while the
   current code runs.
2. Deploy `cookie-web-tasks` via the manual Deploy workflow, so `/projects`
   answers before anything calls it.
3. Push Cookie-Web; Vercel deploys it. Reversed, the sidebar would `GET
/projects`, take a 404, and show its error path.

Gates before each push: `npm test` in Cookie-Worker, and `npm run test:unit`,
`npm run test:e2e`, `npm run format:check`, `npm run lint` plus `npm run build`
in Cookie-Web (which has no `npm test`) — the build is where the entry-chunk
budget is enforced.

No feature flag. The section already renders empty, so the change is
additive and a revert is a clean undo.
