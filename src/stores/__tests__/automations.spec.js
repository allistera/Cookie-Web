import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AUTOMATIONS_API_URL } from '../../lib/apiWorkers'
import { useAutomationsStore } from '../automations'
import { useInboxStore } from '../inbox'
import { useTaskItemsStore } from '../taskItems'

const TRIGGER = { type: 'schedule', time: '00:00', days: ['mon'], timeZone: 'Europe/London' }
const AUTOMATION = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Reschedule Overdue Tasks to Today',
  handler: 'reschedule_overdue',
  trigger: TRIGGER,
  enabled: true,
  nextRunAt: '2026-11-30T00:00:00.000Z',
}
const RUN = {
  id: 'run-1',
  automationId: AUTOMATION.id,
  automationName: AUTOMATION.name,
  status: 'succeeded',
  summary: 'Moved 2 overdue tasks to today.',
  startedAt: '2026-11-28T15:00:00.000Z',
}

const ok = (body, status = 200) => ({ ok: true, status, json: async () => body })
const failure = (status, body) => ({ ok: false, status, json: async () => body })

let store
let notify
let tasks

beforeEach(() => {
  setActivePinia(createPinia())
  store = useAutomationsStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  notify = vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => 1)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // The tasks store a run refreshes; its own requests are not under test.
  tasks = useTaskItemsStore()
  vi.spyOn(tasks, 'loadItems').mockResolvedValue()
  vi.spyOn(tasks, 'invalidateHistory')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// Answers each request from `routes`, keyed by "METHOD /path".
function stubApi(routes) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options = {}) => {
      const key = `${options.method ?? 'GET'} ${String(url).slice(AUTOMATIONS_API_URL.length)}`
      const answer = routes[key]
      if (!answer) throw new Error(`Unexpected request ${key}`)
      return answer(options.body ? JSON.parse(options.body) : undefined)
    }),
  )
}

describe('automations store', () => {
  it('loads the automations and their runs from the automations Worker', async () => {
    stubApi({
      'GET /automations': () => ok({ automations: [AUTOMATION] }),
      'GET /automation-runs': () => ok({ runs: [RUN] }),
    })

    expect(await store.load()).toBe(true)

    expect(store.automations).toEqual([AUTOMATION])
    expect(store.runs).toEqual([RUN])
    expect(store.isLoaded).toBe(true)
    expect(store.loadFailed).toBe(false)
  })

  it('marks a failed load and keeps what it already had', async () => {
    store.automations = [AUTOMATION]
    stubApi({
      'GET /automations': () => failure(500, { error: 'Request failed' }),
      'GET /automation-runs': () => ok({ runs: [] }),
    })

    expect(await store.load()).toBe(false)

    expect(store.loadFailed).toBe(true)
    expect(store.automations).toEqual([AUTOMATION])
  })

  it('creates an automation, lists it and says it is on', async () => {
    const sent = []
    stubApi({
      'POST /automations': (body) => {
        sent.push(body)
        return ok({ automation: AUTOMATION }, 201)
      },
    })

    const created = await store.create({ handler: 'reschedule_overdue', trigger: TRIGGER })

    expect(created).toEqual(AUTOMATION)
    expect(sent).toEqual([{ handler: 'reschedule_overdue', trigger: TRIGGER }])
    expect(store.automations).toEqual([AUTOMATION])
    expect(notify).toHaveBeenCalledWith(
      '“Reschedule Overdue Tasks to Today” is switched on',
      'success',
    )
  })

  it('reports the Worker’s reason when an automation cannot be created', async () => {
    stubApi({
      'POST /automations': () => failure(409, { error: 'An account can have 20 automations' }),
    })

    expect(await store.create({ handler: 'reschedule_overdue', trigger: TRIGGER })).toBeNull()

    expect(store.automations).toEqual([])
    expect(notify).toHaveBeenCalledWith('An account can have 20 automations', 'error')
  })

  it('switches an automation off with the row the Worker answers with', async () => {
    store.automations = [AUTOMATION]
    const off = { ...AUTOMATION, enabled: false, nextRunAt: null }
    const sent = []
    stubApi({
      'PATCH /automations': (body) => {
        sent.push(body)
        return ok({ automation: off })
      },
    })

    expect(await store.setEnabled(AUTOMATION.id, false)).toBe(true)

    expect(sent).toEqual([{ id: AUTOMATION.id, enabled: false }])
    expect(store.automations).toEqual([off])
    expect(store.busy).toEqual([])
  })

  it('leaves the automation as it was when the change is refused', async () => {
    store.automations = [AUTOMATION]
    stubApi({ 'PATCH /automations': () => failure(500, {}) })

    expect(await store.setEnabled(AUTOMATION.id, false)).toBe(false)

    expect(store.automations).toEqual([AUTOMATION])
    expect(notify).toHaveBeenCalledWith('Could not change the automation', 'error')
  })

  it('does not send a second change for an automation while one is under way', async () => {
    store.automations = [AUTOMATION]
    let release
    stubApi({
      'PATCH /automations': () =>
        new Promise((resolve) => {
          release = () => resolve(ok({ automation: AUTOMATION }))
        }),
    })

    const first = store.setEnabled(AUTOMATION.id, false)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(store.busy).toEqual([AUTOMATION.id])
    expect(await store.setEnabled(AUTOMATION.id, true)).toBe(false)
    release()
    await first

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('deletes an automation together with its runs', async () => {
    store.automations = [AUTOMATION]
    store.runs = [RUN, { ...RUN, id: 'run-2', automationId: 'another' }]
    stubApi({ 'DELETE /automations': () => ({ ok: true, status: 204 }) })

    expect(await store.remove(AUTOMATION.id)).toBe(true)

    expect(store.automations).toEqual([])
    expect(store.runs.map((run) => run.id)).toEqual(['run-2'])
  })

  it('runs an automation now, puts the run first and says what it did', async () => {
    store.automations = [AUTOMATION]
    store.runs = [{ ...RUN, id: 'older' }]
    stubApi({ 'POST /automations/run': () => ok({ run: RUN }) })

    expect(await store.runNow(AUTOMATION.id)).toBe(true)

    expect(store.runs.map((run) => run.id)).toEqual(['run-1', 'older'])
    expect(notify).toHaveBeenCalledWith('Moved 2 overdue tasks to today.', 'success')
  })

  it('reloads the task list that is open and tells whatever shows tasks, after a run', async () => {
    tasks.loadedProject = 'today'
    stubApi({ 'POST /automations/run': () => ok({ run: RUN }) })

    await store.runNow(AUTOMATION.id)

    expect(tasks.loadItems).toHaveBeenCalledWith('today', { force: true })
    expect(tasks.invalidateHistory).toHaveBeenCalledTimes(1)
  })

  it('reads no task list when none has been opened, but still says tasks changed', async () => {
    stubApi({ 'POST /automations/run': () => ok({ run: RUN }) })

    await store.runNow(AUTOMATION.id)

    expect(tasks.loadItems).not.toHaveBeenCalled()
    expect(tasks.invalidateHistory).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a run that failed part-way', () => ok({ run: { ...RUN, status: 'failed' } })],
    ['a run whose answer never arrived', () => failure(500, {})],
  ])('reloads tasks after %s, which may already have moved some', async (_label, answer) => {
    tasks.loadedProject = 'inbox'
    stubApi({ 'POST /automations/run': answer })

    await store.runNow(AUTOMATION.id)

    expect(tasks.loadItems).toHaveBeenCalledWith('inbox', { force: true })
    expect(tasks.invalidateHistory).toHaveBeenCalledTimes(1)
  })

  it('does not let a read that started before a delete bring the row back', async () => {
    store.automations = [AUTOMATION]
    store.isLoaded = true
    // The first GET is held; the read made again after the delete sees the
    // server as the delete left it.
    let releaseStale
    let reads = 0
    stubApi({
      'GET /automations': () => {
        reads += 1
        if (reads > 1) return ok({ automations: [] })
        return new Promise((resolve) => {
          releaseStale = () => resolve(ok({ automations: [AUTOMATION] }))
        })
      },
      'GET /automation-runs': () => ok({ runs: [] }),
      'DELETE /automations': () => ({ ok: true, status: 204 }),
    })

    const loading = store.load()
    await vi.waitFor(() => expect(releaseStale).toBeTypeOf('function'))
    expect(await store.remove(AUTOMATION.id)).toBe(true)
    expect(store.automations).toEqual([])

    releaseStale()
    expect(await loading).toBe(true)

    expect(store.automations).toEqual([])
    expect(reads).toBe(2)
  })

  it.each([
    ['a new automation', (s) => s.create({ handler: 'reschedule_overdue', trigger: TRIGGER })],
    ['a switch', (s) => s.setEnabled(AUTOMATION.id, false)],
    ['a run', (s) => s.runNow(AUTOMATION.id)],
  ])('counts %s as a write a pending read must not overwrite', async (_label, write) => {
    store.automations = [AUTOMATION]
    stubApi({
      'POST /automations': () => ok({ automation: { ...AUTOMATION, id: 'new' } }, 201),
      'PATCH /automations': () => ok({ automation: { ...AUTOMATION, enabled: false } }),
      'POST /automations/run': () => ok({ run: RUN }),
    })
    const before = store.writeSeq

    await write(store)

    expect(store.writeSeq).toBe(before + 1)
  })

  it('reports a run that failed as an error', async () => {
    const failed = { ...RUN, status: 'failed', summary: 'The run failed.' }
    stubApi({ 'POST /automations/run': () => ok({ run: failed }) })

    await store.runNow(AUTOMATION.id)

    expect(notify).toHaveBeenCalledWith('The run failed.', 'error')
  })
})
