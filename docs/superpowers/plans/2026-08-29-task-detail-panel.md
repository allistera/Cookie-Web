# Task Detail Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a task opens it in a modal at `/tasks?project=<id>&task=<id>` where its title, description and date can be edited, siblings stepped through, and the task deleted.

**Architecture:** A new `TaskDetailPanel.vue` renders over the dimmed project list, modelled on `NewDocumentDialog` for Escape-to-close and click-outside. It is URL-backed, so a task is linkable, survives a reload, and sibling navigation is a plain route push that the browser's back button understands. The two inline-edit blocks already duplicated in `TasksView.vue` are lifted into a `useInlineEdit` composable that the panel's title and description reuse. No migration: `task_items.due_date` shipped in `0054`.

**Tech Stack:** Vue 3 `<script setup>`, Pinia, vue-router, Vitest + @vue/test-utils, Playwright, Cloudflare Workers, postgres.js.

**Spec:** `docs/superpowers/specs/2026-08-29-task-items-design.md` — phase 2 of three. Read the spec's **Scope**, **Decisions** and **The detail panel** sections before Task 1.

## Global Constraints

- **Two repos.** Paths starting `workers/` are in `Cookie-Worker`; everything else is in `Cookie-Web`. Siblings under `~/Development/Projects/Cookie/`.
- **Push straight to `main`** in both repos. No PRs.
- **Before any push to Cookie-Web:** `npm run test:unit`, `npm run test:e2e`, `npm run format:check`, `npm run lint` **and `npm run build`**. There is no `npm test` in this repo. The build enforces a 150000-byte entry-chunk budget; tests alone will not catch a violation. **Never raise the budget.** `format:check` runs oxfmt **and** Prettier — `npx prettier --check` alone leaves oxfmt failures that turn CI red.
- **Before any push to Cookie-Worker:** `npm test`, `npm run lint`, `npm run typecheck`.
- **Formatting:** `npx prettier --write` on every file touched. Cookie-Web also runs `npx oxlint .`, whose `anti-slop` rules reject runtime `typeof` narrowing — coerce at the boundary (`String(value ?? '')`).
- **No Priority, Deadline or Location.** Explicitly out of scope in the spec. Do not add them, even though the source mockup shows them.
- **No sub-tasks, labels, comments or reminders.** Those are phase 3. `+ Add sub-task` does not appear in this phase.
- **`project_id IS NULL` is the Inbox.** A rule, not a row.
- **Completion never deletes.** `completed: true` stamps `completed_at`; `false` clears it.
- **Dates are `YYYY-MM-DD` strings** on the wire, matching the `due_date date` column. No time component, no timezone conversion.
- **The e2e suite is green.** Any failure is yours.

---

## File Structure

| File                                        | Responsibility                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `workers/cookie-web-tasks/src/taskItems.js` | Reject a malformed `dueDate` instead of silently clearing it (Task 1)                |
| `src/composables/useInlineEdit.js`          | Click-to-edit state: draft, focus, double-fire guard (Task 2)                        |
| `src/views/TasksView.vue`                   | Refactored onto the composable (Task 2); rows open the panel, panel mounted (Task 7) |
| `src/stores/taskItems.js`                   | `itemById` getter, `describeItem`, `setDueDate` (Task 3)                             |
| `src/components/TaskDetailPanel.vue`        | The modal: shell (Task 4), left column (Task 5), right rail (Task 6)                 |
| `vite.config.js`                            | Fixture mirrors the Worker's `dueDate` validation (Task 8)                           |

---

### Task 1: Reject a malformed `dueDate` rather than clearing the date

`updateTaskItem` currently reads `hasDueDate && DATE_RE.test(...) ? String(body.dueDate) : null`. Any value that fails the pattern — a typo, a half-typed date, a `Date` object — collapses to `null`, and the `CASE WHEN ${hasDueDate}` branch then **writes that null**, silently wiping a date the user had set. Phase 2 puts a date control on this exact field, so it must refuse bad input instead. `DATE_RE` also admits impossible dates like `2026-02-31`, which Postgres rejects at the cast with a 500 rather than a useful 400.

Clearing the date stays legitimate: `dueDate: null` means "no date".

**Files:**

- Modify: `workers/cookie-web-tasks/src/taskItems.js`
- Test: `workers/cookie-web-tasks/test/taskItems.test.js`

**Interfaces:**

- Produces: `isCalendarDate(value)` — `true` only for a real `YYYY-MM-DD` date. Used by both `createTaskItem` and `updateTaskItem`.

- [ ] **Step 1: Write the failing tests**

Add to `workers/cookie-web-tasks/test/taskItems.test.js`:

```js
it('rejects a malformed dueDate instead of clearing the date', async () => {
  const sql = createMockSql([[{ id: TASK_ID }]])
  const response = await updateTaskItem(sql, USER_ID, { id: TASK_ID, dueDate: 'tomorrow' })
  expect(response.status).toBe(400)
  await expect(response.json()).resolves.toEqual({ error: 'dueDate must be a YYYY-MM-DD date' })
})

it('rejects a date that does not exist in the calendar', async () => {
  const sql = createMockSql([[{ id: TASK_ID }]])
  const response = await updateTaskItem(sql, USER_ID, { id: TASK_ID, dueDate: '2026-02-31' })
  expect(response.status).toBe(400)
})

it('accepts an explicit null dueDate as clearing the date', async () => {
  const sql = createMockSql([[{ id: TASK_ID }], [{ id: TASK_ID, dueDate: null }]])
  const response = await updateTaskItem(sql, USER_ID, { id: TASK_ID, dueDate: null })
  expect(response.status).toBe(200)
})

it('accepts a well-formed dueDate', async () => {
  const sql = createMockSql([[{ id: TASK_ID }], [{ id: TASK_ID, dueDate: '2026-09-01' }]])
  const response = await updateTaskItem(sql, USER_ID, { id: TASK_ID, dueDate: '2026-09-01' })
  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toMatchObject({ item: { dueDate: '2026-09-01' } })
})

it('rejects a malformed dueDate on create', async () => {
  const sql = createMockSql([])
  const response = await createTaskItem(sql, USER_ID, { content: 'Ship it', dueDate: '01/09/2026' })
  expect(response.status).toBe(400)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd workers/cookie-web-tasks && npx vitest run test/taskItems.test.js`
Expected: FAIL — the malformed values currently produce a 200 with the date cleared.

- [ ] **Step 3: Add the validator**

Add beside `DATE_RE` in `workers/cookie-web-tasks/src/taskItems.js`:

```js
/**
 * A real calendar date in YYYY-MM-DD. DATE_RE alone admits 2026-02-31, which
 * Postgres refuses at the ::date cast — a 500 where the caller deserves a 400.
 *
 * @param {any} value
 */
function isCalendarDate(value) {
  const text = String(value ?? '')
  if (!DATE_RE.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
}
```

- [ ] **Step 4: Use it in `updateTaskItem`**

Replace:

```js
const dueDate = hasDueDate && DATE_RE.test(String(body.dueDate ?? '')) ? String(body.dueDate) : null
```

with:

```js
// A malformed date must be refused, not quietly turned into null: that
// wrote an empty due_date over whatever the task already had. An explicit
// null (or '') still means "clear the date", which is a real request.
const clearsDueDate = hasDueDate && (body.dueDate === null || body.dueDate === '')
if (hasDueDate && !clearsDueDate && !isCalendarDate(body.dueDate)) {
  return Response.json({ error: 'dueDate must be a YYYY-MM-DD date' }, { status: 400 })
}
const dueDate = clearsDueDate ? null : hasDueDate ? String(body.dueDate) : null
```

- [ ] **Step 5: Use it in `createTaskItem`**

Replace:

```js
const dueDate = DATE_RE.test(String(body?.dueDate ?? '')) ? String(body.dueDate) : null
```

with:

```js
const hasDueDate = body?.dueDate !== undefined && body?.dueDate !== null && body?.dueDate !== ''
if (hasDueDate && !isCalendarDate(body.dueDate)) {
  return Response.json({ error: 'dueDate must be a YYYY-MM-DD date' }, { status: 400 })
}
const dueDate = hasDueDate ? String(body.dueDate) : null
```

- [ ] **Step 6: Run the tests**

Run: `cd workers/cookie-web-tasks && npx vitest run test/taskItems.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full gate and commit**

Run: `cd ../.. && npm test && npm run lint && npm run typecheck`

```bash
git add workers/cookie-web-tasks/src/taskItems.js workers/cookie-web-tasks/test/taskItems.test.js
git commit -m "Refuse a malformed dueDate instead of clearing the task's date"
```

---

### Task 2: Extract `useInlineEdit`

`TasksView.vue` carries two near-identical click-to-edit blocks (title, description); the panel needs two more. Four copies of the same double-fire guard is three too many.

**Files:**

- Create: `src/composables/useInlineEdit.js`
- Create: `src/composables/__tests__/useInlineEdit.spec.js`
- Modify: `src/views/TasksView.vue`

**Interfaces:**

- Produces: `useInlineEdit({ read, write, canEdit })` → `{ editing, draft, inputRef, start, submit }`.
  - `read()` returns the current committed value as a string.
  - `write(value)` persists a trimmed value; awaited by `submit`.
  - `canEdit()` optional, defaults to `() => true`; `start()` is a no-op when false.

- [ ] **Step 1: Write the failing test**

Create `src/composables/__tests__/useInlineEdit.spec.js`:

```js
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useInlineEdit } from '../useInlineEdit'

describe('useInlineEdit', () => {
  it('seeds the draft from read() and enters edit mode', async () => {
    const edit = useInlineEdit({ read: () => 'Roof', write: vi.fn() })
    await edit.start()
    expect(edit.editing.value).toBe(true)
    expect(edit.draft.value).toBe('Roof')
  })

  it('does not start when canEdit() is false', async () => {
    const edit = useInlineEdit({ read: () => 'Roof', write: vi.fn(), canEdit: () => false })
    await edit.start()
    expect(edit.editing.value).toBe(false)
  })

  // Enter commits and unmounts the input, which fires blur, calling submit a
  // second time. Without the guard every edit is sent twice.
  it('writes once when submit is called twice', async () => {
    const write = vi.fn()
    const edit = useInlineEdit({ read: () => 'Roof', write })
    await edit.start()
    edit.draft.value = 'Roofing'
    await edit.submit()
    await edit.submit()
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('Roofing')
  })

  it('does not write when the value is unchanged', async () => {
    const write = vi.fn()
    const edit = useInlineEdit({ read: () => 'Roof', write })
    await edit.start()
    await edit.submit()
    expect(write).not.toHaveBeenCalled()
  })

  it('trims the draft before comparing and writing', async () => {
    const write = vi.fn()
    const edit = useInlineEdit({ read: () => 'Roof', write })
    await edit.start()
    edit.draft.value = '  Roof  '
    await edit.submit()
    expect(write).not.toHaveBeenCalled()
  })

  it('leaves edit mode even when write rejects', async () => {
    const edit = useInlineEdit({ read: () => 'Roof', write: () => Promise.reject(new Error('no')) })
    await edit.start()
    edit.draft.value = 'Roofing'
    await expect(edit.submit()).rejects.toThrow('no')
    expect(edit.editing.value).toBe(false)
  })

  it('focuses and selects the input once mounted', async () => {
    const edit = useInlineEdit({ read: () => 'Roof', write: vi.fn() })
    const focus = vi.fn()
    const select = vi.fn()
    edit.inputRef.value = { focus, select }
    await edit.start()
    await nextTick()
    expect(focus).toHaveBeenCalled()
    expect(select).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/composables/__tests__/useInlineEdit.spec.js`
Expected: FAIL — cannot resolve `../useInlineEdit`.

- [ ] **Step 3: Write the composable**

Create `src/composables/useInlineEdit.js`:

```js
import { nextTick, ref } from 'vue'

// Click-to-edit state for a single field: a draft, a focused input, and the
// guard that keeps one edit from being sent twice. Enter commits and unmounts
// the input, which fires blur and calls submit again; without `editing` as a
// latch, every rename would go to the server twice.
export function useInlineEdit({ read, write, canEdit = () => true }) {
  const editing = ref(false)
  const draft = ref('')
  const inputRef = ref(null)

  async function start() {
    if (!canEdit()) return
    draft.value = read() ?? ''
    editing.value = true
    await nextTick()
    inputRef.value?.focus()
    inputRef.value?.select?.()
  }

  async function submit() {
    if (!editing.value) return
    const value = draft.value.trim()
    editing.value = false
    if (value === (read() ?? '')) return
    await write(value)
  }

  return { editing, draft, inputRef, start, submit }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/composables/__tests__/useInlineEdit.spec.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Refactor `TasksView.vue` onto it**

Replace the `editingTitle` / `titleDraft` / `titleInput` / `startTitleEdit` / `submitTitle` block **and** the matching description block with:

```js
const titleEdit = useInlineEdit({
  read: () => current.value?.name ?? '',
  // An empty title is not a rename; leaving edit mode without writing keeps
  // the existing name, which is what pressing Enter on a cleared field should
  // do.
  write: (name) => (name ? projects.renameProject(project.value, name) : undefined),
  canEdit: () => !isInbox.value,
})

const descriptionEdit = useInlineEdit({
  read: () => current.value?.description ?? '',
  write: (description) => projects.describeProject(project.value, description),
  canEdit: () => !isInbox.value,
})
```

Add the import `import { useInlineEdit } from '../composables/useInlineEdit'` and update the template's references:

| Was                | Becomes                                          |
| ------------------ | ------------------------------------------------ |
| `editingTitle`     | `titleEdit.editing.value`                        |
| `titleDraft`       | `titleEdit.draft.value`                          |
| `ref="titleInput"` | `:ref="(el) => (titleEdit.inputRef.value = el)"` |
| `startTitleEdit()` | `titleEdit.start()`                              |
| `submitTitle()`    | `titleEdit.submit()`                             |

and the same four for description. **The `.value` is required**: `titleEdit` is
a plain object, and Vue only auto-unwraps refs returned at the top level of
`setup` — a nested one renders as `[object Object]` and never reacts.

- [ ] **Step 6: Verify the refactor changed no behaviour**

Run: `npx vitest run src/views/__tests__/TasksView.spec.js`
Expected: PASS with the existing assertions untouched. **Do not edit that spec** — if it fails, the refactor is wrong.

- [ ] **Step 7: Commit**

```bash
git add src/composables/useInlineEdit.js src/composables/__tests__/useInlineEdit.spec.js src/views/TasksView.vue
git commit -m "Lift the Tasks view's click-to-edit blocks into useInlineEdit"
```

---

### Task 3: Store support for the panel

**Files:**

- Modify: `src/stores/taskItems.js`
- Test: `src/stores/__tests__/taskItems.spec.js`

**Interfaces:**

- Consumes: `patchItem(id, localPatch, body, failureMessage)` (exists).
- Produces:
  - getter `itemById` → `(id) => item | undefined`
  - `describeItem(id, description)` → `Promise<item|null>`
  - `setDueDate(id, dueDate)` → `Promise<item|null>`; `dueDate` is `'YYYY-MM-DD'` or `null`.

- [ ] **Step 1: Write the failing tests**

Add to `src/stores/__tests__/taskItems.spec.js`:

```js
it('finds a loaded item by id', () => {
  const store = useTaskItemsStore()
  store.items = [{ id: 'a', content: 'One' }]
  expect(store.itemById('a')).toEqual({ id: 'a', content: 'One' })
  expect(store.itemById('missing')).toBeUndefined()
})

it('sends a description change and applies it locally', async () => {
  const store = useTaskItemsStore()
  store.items = [{ id: 'a', content: 'One', description: null }]
  const request = vi
    .spyOn(store, 'request')
    .mockResolvedValue({ item: { id: 'a', content: 'One', description: 'Why' } })

  await store.describeItem('a', 'Why')

  expect(request).toHaveBeenCalledWith('PATCH', { body: { id: 'a', description: 'Why' } })
  expect(store.items[0].description).toBe('Why')
})

it('sends a due date and applies it locally', async () => {
  const store = useTaskItemsStore()
  store.items = [{ id: 'a', content: 'One', dueDate: null }]
  const request = vi
    .spyOn(store, 'request')
    .mockResolvedValue({ item: { id: 'a', content: 'One', dueDate: '2026-09-01' } })

  await store.setDueDate('a', '2026-09-01')

  expect(request).toHaveBeenCalledWith('PATCH', { body: { id: 'a', dueDate: '2026-09-01' } })
  expect(store.items[0].dueDate).toBe('2026-09-01')
})

it('rolls the due date back and surfaces the server message when it is refused', async () => {
  const store = useTaskItemsStore()
  store.items = [{ id: 'a', content: 'One', dueDate: '2026-09-01' }]
  const error = new Error('dueDate must be a YYYY-MM-DD date')
  error.userMessage = 'dueDate must be a YYYY-MM-DD date'
  vi.spyOn(store, 'request').mockRejectedValue(error)
  const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})

  await store.setDueDate('a', 'nonsense')

  expect(store.items[0].dueDate).toBe('2026-09-01')
  expect(notify).toHaveBeenCalledWith('dueDate must be a YYYY-MM-DD date', 'error')
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/stores/__tests__/taskItems.spec.js`
Expected: FAIL — `itemById`, `describeItem` and `setDueDate` are not functions.

- [ ] **Step 3: Add the getter and actions**

Add a `getters` block to the store (it currently has none), directly after `state`:

```js
  getters: {
    // The panel is addressed by URL, so it resolves its task out of whatever
    // the list has already loaded rather than fetching one by id.
    itemById: (state) => (id) => state.items.find((row) => row.id === id),
  },
```

Add beside `renameItem`:

```js
    describeItem(id, description) {
      return this.patchItem(id, { description }, { description }, 'Failed to save the description.')
    },

    // `dueDate` is 'YYYY-MM-DD' or null to clear it. The server refuses
    // anything else rather than clearing the date, so a rejection here is a
    // real error worth surfacing.
    setDueDate(id, dueDate) {
      return this.patchItem(id, { dueDate }, { dueDate }, 'Failed to set the date.')
    },
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/stores/__tests__/taskItems.spec.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/taskItems.js src/stores/__tests__/taskItems.spec.js
git commit -m "Add itemById, describeItem and setDueDate to the task items store"
```

---

### Task 4: The panel shell

**Files:**

- Create: `src/components/TaskDetailPanel.vue`
- Create: `src/components/__tests__/TaskDetailPanel.spec.js`

**Interfaces:**

- Consumes: `itemById` (Task 3); `useTaskItemsStore`, `useProjectsStore`.
- Props: `taskId: String` (required).
- Produces: emits nothing. It closes by pushing the route without `task`, so the parent needs no handler.

**Behaviour:**

- Header shows `# <project name>` (or `Inbox`), `⌃`/`⌄` sibling navigation, `⋯` delete, `✕` close.
- Escape closes. A click on the backdrop closes. A click inside does not.
- `⌃`/`⌄` push `?project=<same>&task=<sibling id>`, taking siblings from `items.items` in list order. Disabled at each end.
- A `taskId` that is not in the loaded list closes the panel and notifies once — covering a stale link, a deleted task, or one hidden because it is complete.

- [ ] **Step 1: Write the failing tests**

Create `src/components/__tests__/TaskDetailPanel.spec.js`:

```js
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import TaskDetailPanel from '../TaskDetailPanel.vue'
import { useTaskItemsStore } from '../../stores/taskItems'

let router

const ITEMS = [
  { id: 'a', content: 'First', description: null, dueDate: null, projectId: null },
  { id: 'b', content: 'Second', description: null, dueDate: null, projectId: null },
  { id: 'c', content: 'Third', description: null, dueDate: null, projectId: null },
]

function mountPanel(taskId = 'b') {
  return mount(TaskDetailPanel, {
    props: { taskId },
    global: { plugins: [createTestingPinia({ stubActions: false }), router] },
  })
}

beforeEach(async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/tasks', name: 'tasks', component: { template: '<div />' } }],
  })
  await router.push('/tasks?task=b')
  await router.isReady()
})

describe('TaskDetailPanel', () => {
  it('renders the task it was given', async () => {
    const wrapper = mountPanel()
    useTaskItemsStore().items = [...ITEMS]
    await flushPromises()
    expect(wrapper.get('.task-panel-title').text()).toBe('Second')
  })

  it('closes on Escape by dropping task from the query', async () => {
    const wrapper = mountPanel()
    useTaskItemsStore().items = [...ITEMS]
    await flushPromises()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(router.currentRoute.value.query.task).toBeUndefined()
    wrapper.unmount()
  })

  it('closes on a backdrop click but not on a click inside', async () => {
    const wrapper = mountPanel()
    useTaskItemsStore().items = [...ITEMS]
    await flushPromises()

    await wrapper.get('.task-panel').trigger('click')
    expect(router.currentRoute.value.query.task).toBe('b')

    await wrapper.get('.task-panel-backdrop').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.task).toBeUndefined()
  })

  it('steps to the previous and next sibling', async () => {
    const wrapper = mountPanel()
    useTaskItemsStore().items = [...ITEMS]
    await flushPromises()

    await wrapper.get('.task-panel-prev').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.task).toBe('a')
  })

  it('disables sibling navigation at the ends of the list', async () => {
    const wrapper = mountPanel('a')
    useTaskItemsStore().items = [...ITEMS]
    await flushPromises()
    expect(wrapper.get('.task-panel-prev').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.task-panel-next').attributes('disabled')).toBeUndefined()
  })

  it('closes and notifies when the task is not in the loaded list', async () => {
    const wrapper = mountPanel('missing')
    const store = useTaskItemsStore()
    const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})
    store.items = [...ITEMS]
    store.loadedProject = 'inbox'
    await flushPromises()
    expect(notify).toHaveBeenCalledWith('That task no longer exists.', 'error')
    expect(router.currentRoute.value.query.task).toBeUndefined()
    wrapper.unmount()
  })

  it('deletes the task and closes', async () => {
    const wrapper = mountPanel()
    const store = useTaskItemsStore()
    store.items = [...ITEMS]
    const remove = vi.spyOn(store, 'deleteItem').mockResolvedValue(true)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await flushPromises()

    await wrapper.get('.task-panel-delete').trigger('click')
    await flushPromises()

    expect(remove).toHaveBeenCalledWith('b')
    expect(router.currentRoute.value.query.task).toBeUndefined()
  })

  it('does not delete when the confirmation is dismissed', async () => {
    const wrapper = mountPanel()
    const store = useTaskItemsStore()
    store.items = [...ITEMS]
    const remove = vi.spyOn(store, 'deleteItem').mockResolvedValue(true)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await flushPromises()

    await wrapper.get('.task-panel-delete').trigger('click')
    await flushPromises()

    expect(remove).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/components/__tests__/TaskDetailPanel.spec.js`
Expected: FAIL — cannot resolve `../TaskDetailPanel.vue`.

- [ ] **Step 3: Write the shell**

Create `src/components/TaskDetailPanel.vue`:

```vue
<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useProjectsStore } from '../stores/projects'
import { useTaskItemsStore } from '../stores/taskItems'

const props = defineProps({ taskId: { type: String, required: true } })

const route = useRoute()
const router = useRouter()
const items = useTaskItemsStore()
const projects = useProjectsStore()

const item = computed(() => items.itemById(props.taskId))

const projectName = computed(() => {
  if (!item.value?.projectId) return 'Inbox'
  return projects.projects.find((row) => row.id === item.value.projectId)?.name ?? 'Inbox'
})

// Siblings are the loaded list in its displayed order, so stepping through
// them matches what the person can see behind the modal.
const siblingIndex = computed(() => items.items.findIndex((row) => row.id === props.taskId))
const previousId = computed(() =>
  siblingIndex.value > 0 ? items.items[siblingIndex.value - 1].id : null,
)
const nextId = computed(() =>
  siblingIndex.value >= 0 && siblingIndex.value < items.items.length - 1
    ? items.items[siblingIndex.value + 1].id
    : null,
)

function close() {
  const query = { ...route.query }
  delete query.task
  router.push({ path: '/tasks', query })
}

function open(id) {
  if (id) router.push({ path: '/tasks', query: { ...route.query, task: id } })
}

// A task id that names nothing in the loaded list is a stale link, a deleted
// task, or one hidden because it is complete. Wait for the load to settle
// before judging, or a panel opened by a deep link would close itself while
// the list is still in flight.
watch(
  () => [items.isLoading, items.loadedProject, item.value],
  () => {
    if (items.isLoading || items.loadedProject === null || item.value) return
    items.notify('That task no longer exists.', 'error')
    close()
  },
  { immediate: true },
)

function onKeydown(event) {
  if (event.key === 'Escape') close()
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="task-panel-backdrop" @click="close()">
    <div
      class="task-panel"
      role="dialog"
      aria-modal="true"
      :aria-label="item?.content ?? 'Task'"
      @click.stop
    >
      <header class="task-panel-header">
        <span class="task-panel-project">
          <span class="project-symbol" aria-hidden="true"></span>
          {{ projectName }}
        </span>
        <div class="task-panel-actions">
          <button
            class="task-panel-prev"
            type="button"
            title="Previous task"
            aria-label="Previous task"
            :disabled="!previousId"
            @click="open(previousId)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">expand_less</span>
          </button>
          <button
            class="task-panel-next"
            type="button"
            title="Next task"
            aria-label="Next task"
            :disabled="!nextId"
            @click="open(nextId)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">expand_more</span>
          </button>
          <button
            class="task-panel-delete"
            type="button"
            title="Delete task"
            aria-label="Delete task"
            @click="remove()"
          >
            <span class="material-symbols-outlined" aria-hidden="true">more_horiz</span>
          </button>
          <button
            class="task-panel-close"
            type="button"
            title="Close"
            aria-label="Close task"
            @click="close()"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
      </header>

      <div class="task-panel-body">
        <div class="task-panel-main">
          <h2 class="task-panel-title">{{ item?.content }}</h2>
        </div>
        <aside class="task-panel-rail"></aside>
      </div>
    </div>
  </div>
</template>
```

Add the delete handler to the script, above `onKeydown`:

```js
async function remove() {
  if (!item.value) return
  if (!confirm(`Delete "${item.value.content}"?`)) return
  const deleted = await items.deleteItem(props.taskId)
  if (deleted) close()
}
```

- [ ] **Step 4: Add the icons to the font subset**

`src/lib/iconFont.js` gates which Material Symbols ship. Add `expand_less`, `expand_more`, `more_horiz` and `close` to `MATERIAL_SYMBOL_NAMES` if any is absent — a test enforces that the subset matches what the templates use.

Run: `npx vitest run src/lib/__tests__/iconFontSubset.spec.js`
Expected: PASS.

- [ ] **Step 5: Write the styles**

Append to `TaskDetailPanel.vue`:

```vue
<style scoped>
.task-panel-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 24px;
  background: rgba(0, 0, 0, 0.35);
}

.task-panel {
  width: 100%;
  max-width: 860px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-dialog);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}

.task-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.task-panel-project {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--text-secondary);
}

.task-panel-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.task-panel-actions button {
  display: flex;
  align-items: center;
  padding: 4px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
}

.task-panel-actions button:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.task-panel-actions button:disabled {
  opacity: 0.35;
  cursor: default;
}

.task-panel-body {
  display: flex;
  min-height: 0;
  flex: 1;
}

.task-panel-main {
  flex: 1;
  min-width: 0;
  padding: 20px 24px;
  overflow-y: auto;
}

.task-panel-rail {
  width: 260px;
  flex: 0 0 auto;
  padding: 20px;
  border-left: 1px solid var(--border-color);
  background: var(--bg-subtle);
}

.task-panel-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}
</style>
```

If `--bg-subtle` is not defined in `src/assets/main.css`, use `var(--bg-body)` instead — check before writing, do not invent a token.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/components/__tests__/TaskDetailPanel.spec.js`
Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add src/components/TaskDetailPanel.vue src/components/__tests__/TaskDetailPanel.spec.js src/lib/iconFont.js
git commit -m "Add the task detail panel shell with sibling navigation and delete"
```

---

### Task 5: Title, description and completion in the panel

**Files:**

- Modify: `src/components/TaskDetailPanel.vue`
- Test: `src/components/__tests__/TaskDetailPanel.spec.js`

**Interfaces:**

- Consumes: `useInlineEdit` (Task 2); `renameItem`, `describeItem`, `setCompleted` (Task 3 and existing).

- [ ] **Step 1: Write the failing tests**

Add to `src/components/__tests__/TaskDetailPanel.spec.js`:

```js
it('renames the task from the title', async () => {
  const wrapper = mountPanel()
  const store = useTaskItemsStore()
  store.items = [...ITEMS]
  const rename = vi.spyOn(store, 'renameItem').mockResolvedValue({})
  await flushPromises()

  await wrapper.get('.task-panel-title').trigger('click')
  await flushPromises()
  const input = wrapper.get('.task-panel-title-input')
  await input.setValue('Second, renamed')
  await input.trigger('keydown.enter')
  await flushPromises()

  expect(rename).toHaveBeenCalledWith('b', 'Second, renamed')
})

it('saves a description', async () => {
  const wrapper = mountPanel()
  const store = useTaskItemsStore()
  store.items = [...ITEMS]
  const describe = vi.spyOn(store, 'describeItem').mockResolvedValue({})
  await flushPromises()

  await wrapper.get('.task-panel-description').trigger('click')
  await flushPromises()
  const input = wrapper.get('.task-panel-description-input')
  await input.setValue('Why this matters')
  await input.trigger('keydown.enter')
  await flushPromises()

  expect(describe).toHaveBeenCalledWith('b', 'Why this matters')
})

it('shows the placeholder when there is no description', async () => {
  const wrapper = mountPanel()
  useTaskItemsStore().items = [...ITEMS]
  await flushPromises()
  expect(wrapper.get('.task-panel-description').text()).toBe('Add a description')
})

// Completing removes the task from the visible list, so the panel would be
// left pointing at a task that is no longer there.
it('completes the task and closes', async () => {
  const wrapper = mountPanel()
  const store = useTaskItemsStore()
  store.items = [...ITEMS]
  const complete = vi.spyOn(store, 'setCompleted').mockResolvedValue({})
  await flushPromises()

  await wrapper.get('.task-panel-check').trigger('click')
  await flushPromises()

  expect(complete).toHaveBeenCalledWith('b', true)
  expect(router.currentRoute.value.query.task).toBeUndefined()
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/components/__tests__/TaskDetailPanel.spec.js`
Expected: FAIL — no `.task-panel-title-input`, `.task-panel-description` or `.task-panel-check`.

- [ ] **Step 3: Wire the edits**

Add to the script, after `item`:

```js
const titleEdit = useInlineEdit({
  read: () => item.value?.content ?? '',
  // An empty title is not a rename: leaving edit mode keeps the old content,
  // which is what Enter on a cleared field should do.
  write: (content) => (content ? items.renameItem(props.taskId, content) : undefined),
})

const descriptionEdit = useInlineEdit({
  read: () => item.value?.description ?? '',
  write: (description) => items.describeItem(props.taskId, description || null),
})

async function complete() {
  await items.setCompleted(props.taskId, true)
  close()
}
```

with `import { useInlineEdit } from '../composables/useInlineEdit'`.

- [ ] **Step 4: Replace `.task-panel-main`'s contents**

```vue
<div class="task-panel-main">
          <div class="task-panel-heading">
            <button
              class="task-panel-check"
              type="button"
              :aria-label="`Complete ${item?.content ?? 'task'}`"
              @click="complete()"
            ></button>
            <input
              v-if="titleEdit.editing.value"
              :ref="(el) => (titleEdit.inputRef.value = el)"
              v-model="titleEdit.draft.value"
              class="task-panel-title-input"
              aria-label="Task title"
              @keydown.enter="titleEdit.submit()"
              @keydown.esc="titleEdit.editing.value = false"
              @blur="titleEdit.submit()"
            />
            <h2 v-else class="task-panel-title" @click="titleEdit.start()">{{ item?.content }}</h2>
          </div>

<input
  v-if="descriptionEdit.editing.value"
  :ref="(el) => (descriptionEdit.inputRef.value = el)"
  v-model="descriptionEdit.draft.value"
  class="task-panel-description-input"
  aria-label="Task description"
  @keydown.enter="descriptionEdit.submit()"
  @keydown.esc="descriptionEdit.editing.value = false"
  @blur="descriptionEdit.submit()"
/>
<p v-else class="task-panel-description" @click="descriptionEdit.start()">
            {{ item?.description || 'Add a description' }}
          </p>
```

- [ ] **Step 5: Add the styles**

```css
.task-panel-heading {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.task-panel-check {
  width: 20px;
  height: 20px;
  margin-top: 3px;
  flex: 0 0 auto;
  border: 1.5px solid var(--text-secondary);
  border-radius: 50%;
  background: none;
  cursor: pointer;
}

.task-panel-check:hover {
  background: var(--bg-hover);
}

.task-panel-title {
  cursor: text;
}

.task-panel-description {
  margin: 10px 0 0 32px;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: text;
}

.task-panel-title-input,
.task-panel-description-input {
  display: block;
  width: 100%;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 2px 6px;
}

.task-panel-title-input {
  font-size: 20px;
  font-weight: 700;
}

.task-panel-description-input {
  margin: 10px 0 0 32px;
  width: calc(100% - 32px);
  font-size: 14px;
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/components/__tests__/TaskDetailPanel.spec.js`
Expected: PASS, 12 tests.

- [ ] **Step 7: Commit**

```bash
git add src/components/TaskDetailPanel.vue src/components/__tests__/TaskDetailPanel.spec.js
git commit -m "Edit a task's title and description, and complete it, from the panel"
```

---

### Task 6: The right rail — Project and Date

**Files:**

- Modify: `src/components/TaskDetailPanel.vue`
- Test: `src/components/__tests__/TaskDetailPanel.spec.js`

`<input type="date">` is deliberate: it produces exactly the `YYYY-MM-DD` the column and the API want, needs no library, and adds nothing to the bundle.

- [ ] **Step 1: Write the failing tests**

```js
it("shows the task's project in the rail", async () => {
  const wrapper = mountPanel()
  useTaskItemsStore().items = [...ITEMS]
  await flushPromises()
  expect(wrapper.get('.task-panel-project-value').text()).toBe('Inbox')
})

it('sets a due date', async () => {
  const wrapper = mountPanel()
  const store = useTaskItemsStore()
  store.items = [...ITEMS]
  const setDue = vi.spyOn(store, 'setDueDate').mockResolvedValue({})
  await flushPromises()

  await wrapper.get('.task-panel-date-input').setValue('2026-09-01')
  await flushPromises()

  expect(setDue).toHaveBeenCalledWith('b', '2026-09-01')
})

it('clears a due date', async () => {
  const wrapper = mountPanel()
  const store = useTaskItemsStore()
  store.items = [{ ...ITEMS[0] }, { ...ITEMS[1], dueDate: '2026-09-01' }, { ...ITEMS[2] }]
  const setDue = vi.spyOn(store, 'setDueDate').mockResolvedValue({})
  await flushPromises()

  await wrapper.get('.task-panel-date-clear').trigger('click')
  await flushPromises()

  expect(setDue).toHaveBeenCalledWith('b', null)
})

it('offers no clear control when there is no date', async () => {
  const wrapper = mountPanel()
  useTaskItemsStore().items = [...ITEMS]
  await flushPromises()
  expect(wrapper.find('.task-panel-date-clear').exists()).toBe(false)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/components/__tests__/TaskDetailPanel.spec.js`
Expected: FAIL — no `.task-panel-date-input`.

- [ ] **Step 3: Fill in the rail**

Replace `<aside class="task-panel-rail"></aside>` with:

```vue
<aside class="task-panel-rail">
          <div class="task-panel-field">
            <h3>Project</h3>
            <p class="task-panel-project-value">
              <span v-if="item?.projectId" class="project-symbol" aria-hidden="true"></span>
              {{ projectName }}
            </p>
          </div>

          <div class="task-panel-field">
            <h3>Date</h3>
            <div class="task-panel-date">
              <input
                class="task-panel-date-input"
                type="date"
                aria-label="Due date"
                :value="item?.dueDate ?? ''"
                @change="onDateChange($event)"
              />
              <button
                v-if="item?.dueDate"
                class="task-panel-date-clear"
                type="button"
                title="Clear date"
                aria-label="Clear due date"
                @click="items.setDueDate(taskId, null)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">close</span>
              </button>
            </div>
          </div>
        </aside>
```

Add to the script:

```js
// An empty input means the date was cleared; the store sends null, which the
// server treats as "no date" rather than as a malformed value.
function onDateChange(event) {
  const value = String(event.target.value ?? '')
  items.setDueDate(props.taskId, value || null)
}
```

- [ ] **Step 4: Add the styles**

```css
.task-panel-field + .task-panel-field {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid var(--border-color);
}

.task-panel-field h3 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.task-panel-project-value {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 14px;
}

.task-panel-date {
  display: flex;
  align-items: center;
  gap: 6px;
}

.task-panel-date-input {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 14px;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 4px 6px;
}

.task-panel-date-clear {
  display: flex;
  padding: 2px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
}

.task-panel-date-clear:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/components/__tests__/TaskDetailPanel.spec.js`
Expected: PASS, 16 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/TaskDetailPanel.vue src/components/__tests__/TaskDetailPanel.spec.js
git commit -m "Show Project and edit Date in the task panel's right rail"
```

---

### Task 7: Open the panel from the list

**Files:**

- Modify: `src/views/TasksView.vue`
- Test: `src/views/__tests__/TasksView.spec.js`, `e2e/vue.spec.js`

- [ ] **Step 1: Write the failing tests**

Add to `src/views/__tests__/TasksView.spec.js`:

```js
it('opens a task in the panel by putting its id in the query', async () => {
  const wrapper = mountView()
  const items = useTaskItemsStore()
  items.items = [{ id: 'a', content: 'First', description: null, dueDate: null, projectId: null }]
  items.loadedProject = 'inbox'
  await flushPromises()

  await wrapper.get('.task-open').trigger('click')
  await flushPromises()

  expect(router.currentRoute.value.query.task).toBe('a')
})

it('shows a due date on the row when the task has one', async () => {
  const wrapper = mountView()
  const items = useTaskItemsStore()
  items.items = [
    { id: 'a', content: 'First', description: null, dueDate: '2026-09-01', projectId: null },
  ]
  items.loadedProject = 'inbox'
  await flushPromises()
  expect(wrapper.get('.task-due').text()).toBe('1 Sep')
})

// Completing must stay on the circle: a click that both completes and opens
// the panel would be unusable.
it('does not open the panel when the completion circle is clicked', async () => {
  const wrapper = mountView()
  const items = useTaskItemsStore()
  items.items = [{ id: 'a', content: 'First', description: null, dueDate: null, projectId: null }]
  items.loadedProject = 'inbox'
  vi.spyOn(items, 'setCompleted').mockResolvedValue({})
  await flushPromises()

  await wrapper.get('.task-check').trigger('click')
  await flushPromises()

  expect(router.currentRoute.value.query.task).toBeUndefined()
})
```

Add to `e2e/vue.spec.js`:

```js
test('Tasks: a task opens in the panel, takes a date, and the link survives a reload', async ({
  page,
}) => {
  await page.goto('/tasks')
  await page.locator('.tasks-add-input').fill('Ship the panel')
  await page.locator('.tasks-add-input').press('Enter')
  await expect(page.locator('.task-row')).toHaveCount(1)

  await page.locator('.task-open').click()
  await expect(page.locator('.task-panel')).toBeVisible()
  await expect(page.locator('.task-panel-title')).toHaveText('Ship the panel')

  await page.locator('.task-panel-date-input').fill('2026-09-01')
  await expect(page.locator('.task-due')).toHaveText('1 Sep')

  // URL-backed: the panel is a link, not just view state.
  await page.reload()
  await expect(page.locator('.task-panel')).toBeVisible()
  await expect(page.locator('.task-panel-title')).toHaveText('Ship the panel')

  await page.keyboard.press('Escape')
  await expect(page.locator('.task-panel')).toHaveCount(0)
  await expect(page.locator('.task-row')).toHaveCount(1)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/views/__tests__/TasksView.spec.js`
Expected: FAIL — no `.task-open`.

- [ ] **Step 3: Make rows open the panel**

In `TasksView.vue`, replace `.task-body` with a button, and add the due-date chip:

```vue
<button class="task-open task-body" type="button" @click="open(item.id)">
          <span class="task-content">{{ item.content }}</span>
          <span v-if="item.description" class="task-description">{{ item.description }}</span>
          <span v-if="item.dueDate" class="task-due">{{ formatDue(item.dueDate) }}</span>
        </button>
```

Add to the script:

```js
const DUE_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

// due_date is a plain calendar date with no zone, so it is formatted from its
// own three parts rather than through a Date: constructing one and formatting
// it in the local zone moves the chip a day for anyone west of Greenwich.
// Intl is avoided for a second reason — en-GB's short September is "Sep" on
// some ICU versions and "Sept" on others, which would make the assertion below
// pass locally and fail in CI.
function formatDue(dueDate) {
  const [, month, day] = dueDate.split('-')
  return `${Number(day)} ${DUE_MONTHS[Number(month) - 1]}`
}

function open(id) {
  router.push({ path: '/tasks', query: { ...route.query, task: id } })
}
```

with `useRouter` imported from `vue-router` and `const router = useRouter()`.

- [ ] **Step 4: Mount the panel**

Add to the template, as the last child of `.tasks-view`:

```vue
<TaskDetailPanel v-if="openTaskId" :key="openTaskId" :task-id="openTaskId" />
```

and to the script:

```js
import TaskDetailPanel from '../components/TaskDetailPanel.vue'

const openTaskId = computed(() => {
  const id = route.query.task
  return id ? String(id) : ''
})
```

`:key` forces a remount when stepping between siblings, so the inline-edit
drafts never carry from one task to the next.

- [ ] **Step 5: Style the row button and the chip**

```css
.task-open {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  flex: 1;
  min-width: 0;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.task-due {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/views/__tests__/TasksView.spec.js`
Expected: PASS.

Run: `npx playwright test e2e/vue.spec.js --project=chromium -g "opens in the panel" --timeout=400000`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/views/TasksView.vue src/views/__tests__/TasksView.spec.js e2e/vue.spec.js
git commit -m "Open a task in the detail panel from the project list"
```

---

### Task 8: Mirror the date validation in the dev fixture

The fixture at `vite.config.js` exists so e2e exercises the same refusals the Worker makes. It currently takes `body.dueDate ?? null` unchecked, so the e2e suite would accept dates production rejects.

**Files:**

- Modify: `vite.config.js`

- [ ] **Step 1: Add the validator**

Beside `cleanTaskText`:

```js
// Mirrors isCalendarDate in cookie-web-tasks/src/taskItems.js.
function isTaskCalendarDate(value) {
  const text = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
}
```

- [ ] **Step 2: Use it in POST**

Replace `dueDate: body.dueDate ?? null,` in the created item with a checked value, adding before the item is built:

```js
const hasDue = body.dueDate !== undefined && body.dueDate !== null && body.dueDate !== ''
if (hasDue && !isTaskCalendarDate(body.dueDate)) {
  return json(res, { error: 'dueDate must be a YYYY-MM-DD date' }, 400)
}
```

and `dueDate: hasDue ? String(body.dueDate) : null,` in the item.

- [ ] **Step 3: Use it in PATCH**

Replace `if (hasDueDate) item.dueDate = body.dueDate ?? null`:

```js
if (hasDueDate) {
  const clears = body.dueDate === null || body.dueDate === ''
  if (!clears && !isTaskCalendarDate(body.dueDate)) {
    return json(res, { error: 'dueDate must be a YYYY-MM-DD date' }, 400)
  }
  item.dueDate = clears ? null : String(body.dueDate)
}
```

- [ ] **Step 4: Verify the suite still passes**

Run: `npm run test:e2e -- --project=chromium --timeout=400000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add vite.config.js
git commit -m "Mirror the Worker's dueDate validation in the dev fixture"
```

---

### Task 9: Rollout

Order matters: the Worker's stricter validation must be live before the web app starts sending dates, or a rejected date would arrive at a handler that still silently cleared it.

- [ ] **Step 1: Push and deploy the Worker**

```bash
cd ~/Development/Projects/Cookie/Cookie-Worker
npm test && npm run lint && npm run typecheck
git push origin main
gh workflow run deploy.yml -f worker=cookie-web-tasks --ref main
gh run watch "$(gh run list --workflow=deploy.yml --limit=1 --json databaseId -q '.[0].databaseId')" --exit-status
```

Expected: both succeed. Verify before continuing.

- [ ] **Step 2: Push Cookie-Web**

```bash
cd ~/Development/Projects/Cookie/Cookie-Web
npm run test:unit && npm run test:e2e && npm run format:check && npm run lint && npm run build
git push origin main
```

- [ ] **Step 3: Confirm CI and the Vercel deployment**

CI must be green and the deployment `READY`. An `ERROR` is most likely the entry-chunk budget, which Step 2's build should have caught.

- [ ] **Step 4: Smoke-test in production**

Open a task: the panel opens over the list, the title and description edit in place, a date sets and clears, `⌃`/`⌄` step through the list, the URL carries `?task=`, a reload reopens the same task, Escape closes it, and `⋯` deletes after confirming.

---

## Notes for the executor

- **No migration.** `due_date` and `parent_id` shipped in `0054`. If you find yourself writing SQL DDL, stop — you have left the plan.
- **Do not build sub-tasks, labels, comments or reminders.** They are phase 3 and have their own tables. `parent_id` exists but nothing in this phase writes it.
- **Do not add Priority, Deadline or Location.** The source mockup shows all three; the spec rules out all three.
- **`confirm()` is what the sidebar's project delete already uses.** Match it rather than introducing a second confirmation style.
- **The panel must not fetch.** It reads from the list the view already loaded. A task that is not there closes the panel — that is the designed behaviour, not a gap to fill with a new endpoint.
