# Task items: a working Tasks app

Status: designed, not implemented. Spans Cookie-Web and Cookie-Worker.
Follows on from `2026-08-28-task-projects-design.md`, which built the project
tree this hangs from.

## Problem

`TasksView` renders "Nothing here yet." The sidebar now has a project tree,
but a project leads nowhere: nothing in Cookie can be filed into one, and
there is no way to create a task at all. The `tasks` table that feeds AI
Today holds gathered items only — Todoist tasks and action items extracted
from mail — and is not a place a person can write to.

This design gives the Tasks app its own tasks: created, edited, completed,
nested, labelled, commented on, and reminded about.

## Scope

Three phases, one spec, three implementation plans. Each phase ships
something usable.

1. **Tasks in projects** — the `task_items` table, list/create/complete, and
   the project view: breadcrumb, title, description, task rows, add-task.
2. **The detail panel** — a task opens in a modal: edit title and
   description, set a date, step through siblings.
3. **Depth** — sub-tasks, labels, comments with attachments, reminders, and
   the Display menu.

Out of scope, deliberately:

- **Priority.** The source mockup shows a P4 flag; it was not selected when
  the fields were chosen. The `tasks` table's 1–4 priority vocabulary exists
  if it is wanted later, and adding it is a column plus one control.
- **Deadline and Location.** Padlocked paid features in the source mockup.
- **Manual ordering.** Tasks order by `created_at`. The mockups show no drag
  handles; a `position` column and reorder endpoint can follow if the list
  ever needs it.
- **Web Push.** See Reminders — this is a ceiling on what reminders can do,
  not an omission to fix silently.
- **Touching the gathered `tasks` table.** AI Today keeps its own data and
  its own behaviour. The two systems never share a row.

## Decisions

| Decision     | Choice                                                                     |
| ------------ | -------------------------------------------------------------------------- |
| Storage      | A separate `task_items` table; gathered `tasks` untouched                  |
| Completion   | Kept, stamped `completed_at`; hidden from the list by default              |
| Inbox        | `project_id IS NULL` — a rule, not a row, as the sidebar already treats it |
| Fields       | Date, Labels, Reminders. No Priority, Deadline or Location                 |
| Labels       | Task labels, separate from email labels; name only, no colour              |
| Comments     | Text plus attachments in Vercel Blob                                       |
| Sub-tasks    | `parent_id`, arbitrary depth, cycle-guarded like projects                  |
| Ordering     | `created_at`; no manual ordering                                           |
| Detail panel | A modal, but URL-backed at `?project=<id>&task=<id>`                       |
| Reminders    | Cron finds them; delivery is realtime + in-app, no Web Push                |

## Data model

Migrations follow the phases rather than landing all at once, so no unused
table sits in the schema ahead of the code that reads it. Phase 1 is
`0054_task_items.sql`; phase 3's tables come in a later migration, numbered
when it is written. All follow `task_projects`' posture: RLS enabled,
privileges revoked from `anon` and `authenticated`, `user_id` cascading,
wrapped in BEGIN/COMMIT.

**Phase 1 — `0054_task_items.sql`:**

```sql
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
```

- **`project_id IS NULL` is the Inbox.** No seeded row, nothing to rename or
  delete, no backfill — the same rule the sidebar already encodes. A task
  created without a project simply has none.
- **`parent_id` gives sub-tasks**, reusing the project tree's shape and its
  cycle guard.
- **`completed_at` rather than a boolean**, so "when" is available for free
  and un-completing is clearing a column.
- **Deleting a project deletes its tasks** (`ON DELETE CASCADE`). The
  project delete confirmation already names the sub-projects it will take;
  once tasks exist it must name those too — see Rollout.

`parent_id` ships in phase 1 even though sub-tasks are a phase 3 feature:
the column costs nothing, and adding a self-reference later means a second
migration against a populated table.

**Phase 3 — supporting tables, same posture:**

```sql
CREATE TABLE public.task_labels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE public.task_item_labels (
  task_id  uuid NOT NULL REFERENCES public.task_items(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES public.task_labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

CREATE TABLE public.task_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  task_id     uuid NOT NULL REFERENCES public.task_items(id) ON DELETE CASCADE,
  body        text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.task_reminders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  task_id      uuid NOT NULL REFERENCES public.task_items(id) ON DELETE CASCADE,
  remind_at    timestamptz NOT NULL,
  delivered_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_reminders_due_idx
  ON public.task_reminders (remind_at) WHERE delivered_at IS NULL;

```

**Phase 1 also adds the project description** the view needs:

```sql
ALTER TABLE public.task_projects ADD COLUMN description text;
```

- **Labels carry a name and nothing else** — consistent with the call made
  on projects, which carry no colour or emoji either.
- **Attachments are a `jsonb` array on the comment**, each entry
  `{url, filename, contentType, bytes}`, rather than a fourth table. Blob
  URLs are opaque strings with no query needs, and this mirrors how
  documents store blocks. Capped at 10 per comment.
- **The reminder index is partial** (`WHERE delivered_at IS NULL`), so the
  cron's scan touches only rows that can still fire.

## API

All in `cookie-web-tasks`, alongside `/tasks`, `/documents` and `/projects`,
each routed the way `/projects` is: no sub-paths, ids in the body, dispatch
by method, every statement scoped by `user_id` so another user's id is a 404
rather than a 403.

**The path is `/task-items`, not `/tasks`** — `/tasks` already serves AI
Today's gathered items and keeps that meaning.

| Route                                 | Body                                                                                   | Response                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /task-items?project=<id\|inbox>` | —                                                                                      | `{ items: [...] }`, flat, `created_at` order, completed excluded unless `?completed=1` |
| `GET /task-items?id=<id>`             | —                                                                                      | `{ item, comments, reminders }` — one request opens the panel                          |
| `POST /task-items`                    | `{content, description?, projectId?, parentId?, dueDate?}`                             | `{ item }`, 201                                                                        |
| `PATCH /task-items`                   | `{id, content?, description?, projectId?, parentId?, dueDate?, completed?, labelIds?}` | `{ item }`                                                                             |
| `DELETE /task-items`                  | `{id}`                                                                                 | `{ ok: true }`                                                                         |
| `GET/POST/PATCH/DELETE /task-labels`  | as `/projects`                                                                         | `{ labels }` / `{ label }`                                                             |
| `GET /task-comments?task=<id>`        | —                                                                                      | `{ comments }`                                                                         |
| `POST /task-comments`                 | `{taskId, body, attachments?}`                                                         | `{ comment }`, 201                                                                     |
| `DELETE /task-comments`               | `{id}`                                                                                 | `{ ok: true }`                                                                         |
| `POST /task-reminders`                | `{taskId, remindAt}`                                                                   | `{ reminder }`, 201                                                                    |
| `DELETE /task-reminders`              | `{id}`                                                                                 | `{ ok: true }`                                                                         |
| `POST /task-attachments`              | multipart                                                                              | `{url, filename, contentType, bytes}`                                                  |

- **`project=inbox` means `project_id IS NULL`**, enforced server-side, not
  only in the UI.
- **`completed: true` stamps `completed_at = now()`; `false` clears it.**
  Nothing is deleted on completion.
- **Labels are set through `PATCH /task-items` as `labelIds`**, replacing the
  whole set. One round trip, one semantic, matching how the messages Worker
  handles label changes.
- **The cycle guard is shared, not copied.** `projects.js` already has
  `isAncestorOf`; it moves to a helper taking a table identifier through
  postgres.js's identifier escaping, called by both projects and task items.
  No string-interpolated table names.
- **Only `/task-attachments` is rate-limited**, through the existing
  `allowRequest` budget, because it writes to blob storage. The rest is plain
  CRUD against indexed tables, ungated like every other CRUD surface here.
- **Validation**: `content` trimmed and capped at 500 characters,
  `description` and comment `body` at 10,000, through the same `cleanText`
  helper the documents handlers use.

## The project view

`TasksView.vue` at `/tasks?project=<id|inbox>`.

- **Breadcrumb** — the project's ancestor chain (`My Projects / Technical
Projects /`), each ancestor a link to its own view. Text only: projects
  carry no emoji or colour, so the source mockup's `🔧` has no equivalent.
  Adding an emoji column is a small, separate change if it is wanted.
- **Title and description edit in place.** Both carry the Enter-then-blur
  guard: Enter commits and unmounts the input, which fires `blur`, so the
  second call must be a no-op. Renaming here and renaming in the sidebar
  both `PATCH /projects`.
- **Task rows** — a circle, the content, the description beneath in muted
  text, sub-tasks indented under their parent. The circle completes;
  anywhere else opens the detail panel.
- **`+ Add task`** below a divider, opening an inline composer rather than a
  dialog, matching the sidebar's inline create. Enter commits, Escape
  cancels, and the same double-fire guard applies.
- **`Display`** — `Sort by` (created, due date, name) and a `Show completed`
  toggle. The source mockup's Display menu also offers grouping and
  filtering, which need features this design does not build.
- **`⋯`** — rename and delete the project: the same two actions the sidebar
  row offers, placed where the eye already is.
- **An empty project shows the add-task row and nothing else.**

## The detail panel

`TaskDetailPanel.vue`, opened at `/tasks?project=<id>&task=<id>`.

A modal over the dimmed list, modelled on `NewDocumentDialog` for focus
trapping, Escape-to-close and click-outside — the dialog behaviour this app
already has, not a new one. It is URL-backed so a task is linkable and
survives a reload, and the `⌃`/`⌄` sibling navigation is a plain route push,
which makes the browser's back button behave.

- **Header**: the project name, sibling navigation, `⋯` to delete, `✕` to
  close.
- **Left**: the circle, the title and description editing in place,
  `+ Add sub-task`, then the comment composer — avatar, text field, and a
  paperclip for attachments.
- **Right**: Project, Date, Labels, Reminders.

Client state lives in `stores/taskItems.js` and `stores/taskLabels.js`,
modelled on `stores/projects.js`: a `request()` helper, load guarded by a
flag with a `force` option, and mutations that update locally and roll back
on failure, surfacing the server's error message. Everything lazy-loads
under the Tasks route, so the entry-chunk budget is untouched.

## Reminders

**What exists**: notifications in Cookie are client-driven. An open tab
subscribes to a Supabase realtime channel and raises a browser
`Notification`; the `cookie-web-notifications` Worker does claim/ack so two
tabs do not both fire the same alert. There are no VAPID keys, no push
subscriptions, and no service-worker push handler.

**Therefore**: a cron can find a due reminder but cannot reach a closed
browser. This design accepts that ceiling rather than building Web Push.

- A `scheduled()` handler in `cookie-web-tasks` — its first — runs every five
  minutes. Precision is therefore ±5 minutes, which is the trade for not
  running a tighter schedule.
- It selects undelivered reminders at or past `remind_at` whose task is not
  completed (no nagging about finished work), writes a notification event,
  and stamps `delivered_at` so a reminder fires exactly once.
- An open tab picks the event up over the existing realtime channel, claims
  it through the notifications Worker's existing dedupe, and shows a browser
  notification.

**The event table needs widening, and this is the riskiest change in the
spec.** `browser_notification_events` (migration 0016) is email-shaped:

```sql
message_id uuid NOT NULL UNIQUE REFERENCES public.messages(id) ON DELETE CASCADE
```

A reminder has no message, so it cannot be represented at all today. Phase 3
therefore adds `kind text NOT NULL DEFAULT 'email'` and a nullable
`task_id`, makes `message_id` nullable, and replaces the bare `UNIQUE` with
partial unique indexes per kind. The Worker's claim/ack query — which joins
`messages` to build its payload — branches on `kind`, and the client's
realtime handler chooses between the new-email and reminder notification
bodies.

This touches a working notification path that currently carries real mail,
so it carries the highest regression risk here: its tests must cover an
email event and a reminder event side by side, and prove that an email
event's behaviour is byte-for-byte what it was before. The alternative — a
parallel `task_reminder_events` table with its own claim/ack — avoids the
risk by duplicating the dedupe logic that already exists, which is the
trade being rejected.

- **A reminder that fires while Cookie is closed is not lost**: due reminders
  also surface in the Tasks UI, so it is waiting when you return. Late, but
  never silently dropped.

If reminders on a closed browser matter later, Web Push is an additive
follow-on: a subscriptions table, VAPID keys, a push handler in the existing
service worker, and the cron sending push messages instead of only writing
events.

## Comments and attachments

- `POST /task-attachments` takes multipart and writes to Vercel Blob through
  the `put` already imported for document image uploads, returning
  `{url, filename, contentType, bytes}`. The client then posts a comment
  carrying that object.
- Caps mirror the image-upload path: a per-file byte ceiling, an allowlist of
  content types, at most 10 attachments per comment.
- Deleting a comment best-effort deletes its blobs, so orphaned files do not
  accumulate.

## Testing

- **Worker** (`createMockSql`): every verb of `/task-items`, including the
  `project=inbox` → `project_id IS NULL` filter, the completed filter, the
  `parent_id` cycle guard rejecting before any write, and user-scoping
  returning 404. The same for labels, comments and reminders. The attachment
  endpoint gets type-allowlist, size-cap and rate-limit tests.
- **The cron**, tested as a plain function: selects only undelivered
  reminders at or past their time, skips reminders whose task is completed,
  and stamps `delivered_at` so a reminder cannot fire twice.
- **Web unit**: both stores including rollback-on-failure and the server's
  message being surfaced; the project view (list, inline add, complete,
  sub-task nesting, breadcrumb, Display menu); the detail panel (open/close,
  sibling navigation, inline edits, sub-task, comment posting, label and date
  editing).
- **e2e**: create a task in a project, complete it, reopen it, add a
  sub-task, post a comment, reload and assert everything persisted; plus the
  Inbox case, where a task belongs to no project.
- **The dev/e2e fixture must mirror the real handlers' contract exactly** —
  shapes, status codes, field names, and the cascade behaviour of delete. A
  fixture that disagrees with production makes the e2e test lie about it.

## Rollout

Per phase, in this order, because each step is useless or broken without the
one before it:

1. Apply the phase's migration.
2. Deploy `cookie-web-tasks` (handlers, and for phase 3 the cron), so the
   endpoints answer before anything calls them.
3. Push Cookie-Web, which Vercel deploys.

Gates before each push: `npm test`, `npm run lint` and `npm run typecheck` in
Cookie-Worker; `npx vitest run` **and `npm run build`** in Cookie-Web — the
build is where the 150,000-byte entry-chunk budget is enforced, and tests
alone will not catch a violation.

No feature flag: `TasksView` is a stub today, so every phase is additive and
a revert is a clean undo.

**One follow-on this design creates**: deleting a project already cascades to
its sub-projects, and will now cascade to their tasks. The sidebar's delete
confirmation names the sub-projects it will take; once phase 1 ships it must
name the tasks too, or the prompt understates what is lost — the same defect
class the last final review caught in that very confirmation.
