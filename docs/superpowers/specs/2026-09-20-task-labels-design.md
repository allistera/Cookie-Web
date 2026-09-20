# Task labels: managed labels with colours

Status: implemented (Cookie-Worker + Cookie-Web, September 2026).

## Problem

A task already carries labels: migration 0067 added `task_items.labels
text[]`, the worker normalises them (lowercase, 1–40 characters, no spaces,
at most 20 per task), the add dialog and detail panel take them as free text
(`@home @errands`), and the list view can group by label and shows a grey
chip per label.

What is missing is any notion of a label as a thing of its own. There is no
list of the labels a person uses, nowhere to click a label and see its
tasks, no colour, no picker or suggestions, and no way to rename or delete a
label across every task that carries it. A typo creates a label nobody can
find again.

## Scope

In scope:

- A `task_labels` table: one row per user-defined label, with a colour.
- Worker endpoints to list, create, rename, recolour and delete labels.
  Rename and delete rewrite the label on every task that carries it.
- Task writes register any label name they receive, so `@newlabel` typed in
  the add dialog, or produced by the AI task parser, still works and the
  label appears in the sidebar.
- A Labels section in the Tasks sidebar: filter by label, create, rename,
  recolour and delete inline.
- Coloured label chips in the list, coloured headers when grouping by label,
  and a label view titled by the label.
- A chip picker with suggestions in the add dialog and the detail panel.

Out of scope, deliberately:

- Dragging a task onto a sidebar label to tag it.
- Task counts displayed beside each sidebar label (the API returns one, but
  only the delete confirmation reads it).
- A Settings page for labels.
- Label search in the unified search index.

## Decisions

| Decision      | Choice                                                                       |
| ------------- | ---------------------------------------------------------------------------- |
| Link          | Keep `task_items.labels text[]` of names; `task_labels` is keyed by name     |
| Identity      | Name, unique per user, normalised the way the worker already normalises it   |
| Colour        | Hex, one of the eight-swatch palette email categories use; default `#64748b` |
| Unknown names | Registered on task write with the default colour, never refused              |
| Management UI | Inline in the sidebar, mirroring projects                                    |
| Label view    | `?project=label:<name>`, a third rule beside `inbox` and `today`             |

Why the name array stays as the link: a junction table keyed by label id
would be the textbook shape, but it would mean rewriting every read and
write of labels in the worker (`taskItems.js`, `taskPages.js`, `taskAi.js`,
`taskMetadata.js`), the store, and every template, plus a data migration,
for no user-visible difference. Names are already unique per user and
normalised, so they are a stable key. A rename is the one operation that
has to touch tasks, and it does so in a single transaction.

## Data model

Migration `0079_task_labels.sql` in Cookie-Web's `migrations/`:

```sql
CREATE TABLE public.task_labels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text NOT NULL DEFAULT '#64748b',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name),
  CONSTRAINT task_labels_name_check
    CHECK (name ~ '^[^\s@#]{1,40}$' AND name = lower(name)),
  CONSTRAINT task_labels_color_check CHECK (color ~ '^#[0-9a-f]{6}$')
);
CREATE INDEX task_items_labels_idx ON public.task_items USING gin (labels);
ALTER TABLE public.task_labels ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.task_labels FROM anon, authenticated;

INSERT INTO public.task_labels (user_id, name)
SELECT DISTINCT t.user_id, l.name
FROM public.task_items t, unnest(t.labels) AS l(name)
ON CONFLICT (user_id, name) DO NOTHING;
```

The seed means every label name already on a task has a row before the new
worker ships, so the sidebar is populated on first load and a rename never
meets a name it does not know. The GIN index serves the label view's
`labels @> ARRAY[name]` filter.

The worker's `normalizeTaskLabels` (lowercase, trim, strip a leading `@`,
1–40 characters, no whitespace, `@` or `#`) remains the single definition of
a valid name; the CHECK mirrors it as a backstop.

## API (cookie-web-tasks)

New module `src/taskLabels.js`, routed at `/task-labels` in `worker.js`
exactly the way `/projects` is (no sub-paths; GET without a body; POST,
PATCH and DELETE read a JSON body).

| Method | Body                    | Response                                                                                                                                                                                     |
| ------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | —                       | `{ labels: [{ id, name, color, taskCount, createdAt }] }` ordered by name; `taskCount` is a correlated count of the caller's tasks whose array contains the name, computed in the same query |
| POST   | `{ name, color? }`      | 201 `{ label }`; 400 bad name or colour; 409 name in use                                                                                                                                     |
| PATCH  | `{ id, name?, color? }` | 200 `{ label }`; 400 nothing to change or bad value; 404 not owned; 409 name in use                                                                                                          |
| DELETE | `{ id }`                | 200 `{ ok: true }`; 404 not owned                                                                                                                                                            |

Rename runs inside `sql.begin`: update the row, then
`UPDATE task_items SET labels = array_replace(labels, old, new), updated_at = now()
WHERE user_id = $1 AND labels @> ARRAY[old]`. Delete does the same with
`array_remove`. The 409 on a taken name is what keeps `array_replace` from
producing duplicates inside one task's array.

The Meilisearch task document does not include labels, so neither
operation needs a search sync.

Task writes register labels. `createTaskItemUnlocked` and
`updateTaskItemUnlocked` (when `labels` is in the body) call one helper,
`registerTaskLabels(sql, userId, names)`, which is a no-op for an empty
list and otherwise runs:

```sql
INSERT INTO task_labels (user_id, name)
SELECT $1, unnest($2::text[])
ON CONFLICT (user_id, name) DO NOTHING
```

It runs after validation, immediately before the task insert or update,
inside the same transaction the task write already opens (`createTaskItem`
and `updateTaskItem` wrap their work in `sql.begin` with a per-user
advisory lock), so a refused or failed task write never leaves a label
behind that nothing carries. (A label created this way and then removed
from its only task simply stays in the list, as an intentional label
would.) The AI paths need nothing: `createTaskTree` writes content and
description only, and `interpretTask` hands `@labels` back to the client,
whose ordinary create request registers them.

The paged list (`taskPages.js`, `getTaskPage`) accepts `project=label:<name>`.
The name is validated with `normalizeTaskLabels([name])`; a bad name is a 400. The filter is `AND t.labels @> ARRAY[name]::text[]` and the ordering is
the project ordering (position, created_at, id), so a label view reads as a
flat list across projects. The legacy unpaged `getTaskItems` branch is left
alone: the web app only reads lists through `view=page`, and it keeps
refusing `label:` values with its existing 400.

## Frontend

### Store: `src/stores/taskLabels.js`

Shaped after `stores/projects.js`: `labels`, `isLoaded`, `isLoading`;
`loadLabels`, `createLabel({ name, color })`, `renameLabel(id, name)`,
`recolourLabel(id, color)`, `deleteLabel(id)`; optimistic with rollback and
a notify on failure. Getter `byName` returns a `Map` from name to label so
templates can colour a chip in O(1).

After a successful rename or delete, the store also patches
`useTaskItemsStore().items` locally (replace or remove the name in each
`labels` array) so the open list agrees with the server without a refetch.

Label names go through a shared `src/lib/taskLabels.js` `normalizeLabelName`
(same rules as the worker) so the picker and the sidebar never send a name
the server would refuse, and `LABEL_PALETTE` moves out of
`CategorySettings.vue` into `src/lib/labelPalette.js`, which both the
category settings and the task label swatches import.

### Route rule

`TasksView`'s `project` computed already yields `'inbox'`, `'today'` or an
id. Add `isLabel = project.startsWith('label:')` and `labelName`. A label
view is a rule like Today: no rename, no description, no dividers, no
"add a task here" project. Its title is the label name rendered as a
coloured chip. The task items store's `belongsToLoadedList` treats
`label:<name>` as "the item's labels include name", and `loadItems` and
`loadMoreItems` pass the value through unchanged.

### Sidebar

A `Labels` section under My Projects in `TasksSidebar.vue`, built the same
way as the projects section:

- Header row with a plus button that opens an inline input; Enter creates
  with the default colour.
- One row per label: a coloured dot, the name, active when
  `selectedProject === 'label:' + name`, linking to
  `/tasks?project=label:<name>`.
- Double-click renames inline. The rename is normalised before sending; an
  empty or unchanged name is a no-op.
- Clicking the dot toggles a swatch row under the label with the eight
  palette colours; picking one recolours and closes it.
- Hover reveals a delete button. Delete confirms with the number of tasks
  that carry the label, read from the `taskCount` that `GET /task-labels`
  returns on every row (see API). A label on no task deletes without a
  prompt. If the deleted label is the one being viewed, the view routes to
  Inbox.

### List view (`TasksView.vue`)

- Chips take the label's colour: text in the colour, background at 12%
  alpha, the same treatment `CategorySettings.vue` uses for category pills.
  A name with no row (possible only between a delete and the next load)
  falls back to the current grey.
- Group-by-labels headers show the dot and the name.

### Picker: `src/components/TaskLabelPicker.vue`

Props: `modelValue` (array of names), `disabled`. Emits `update:modelValue`.

- Selected names render as coloured chips with a remove button.
- A text input follows the chips. Typing filters `labels.labels` by prefix
  (excluding already-selected names) into a listbox below; Enter or clicking
  a suggestion adds it. Enter on a name that matches no label adds the
  normalised name as a new chip; the label is registered by the task write.
- Backspace in an empty input removes the last chip. Escape closes the list.
- `AddTaskDialog.vue` replaces `labelsText` with the picker bound to
  `draft.labels`; the natural-language `@label` parse still fills it.
- `TaskDetailPanel.vue` replaces the labels input with the picker; each
  change calls `items.setLabels` immediately (there is no blur to wait for).

## Testing

Worker (`workers/cookie-web-tasks/test`), with the existing `createMockSql`:

- `taskLabels.test.js`: list, create, duplicate 409, bad name and colour
  400, rename rewrites task arrays inside a transaction, delete strips the
  name, 404 for unowned ids.
- `taskItems.test.js`: creating and updating with labels issues the
  register insert first; an empty label list issues none. Existing tests
  that pass labels gain one queued result.
- `taskPages.test.js` (or the equivalent): `project=label:home` filters by
  containment and rejects a bad name.
- `worker.test.js`: `/task-labels` routing and method handling.

Web (`src/**/__tests__`):

- `stores/__tests__/taskLabels.spec.js`: load once, create, rename with
  rollback, delete, and local patching of loaded task arrays.
- `components/__tests__/TaskLabelPicker.spec.js`: chips render with colour,
  suggestions filter, Enter adds, Backspace removes, new names normalise.
- `components/__tests__/TasksSidebar.spec.js`: Labels section lists rows
  with the right hrefs, inline create, rename, swatch recolour, delete
  confirmation text.
- `views/__tests__/TasksView.spec.js`: the label rule hides project
  controls and loads with `label:` intact; chips carry the colour.
- `stores/__tests__/taskItems.spec.js`: `belongsToLoadedList` for a label.

## Rollout

1. Push the migration (Cookie-Web `migrations/`); the Migrate Database
   workflow applies it on push to main. The current worker keeps working: it
   never reads `task_labels`.
2. Deploy `cookie-web-tasks` (manual Deploy workflow in Cookie-Worker). The
   current web build keeps working: it never calls `/task-labels`, and
   `project=` values it sends are unchanged.
3. Push Cookie-Web.

Documentation: a Task labels section in `migrations/README.md`, a row in
Cookie-Docs' schema areas table, and the Tasks paragraph in the Cookie-Web
component page.
