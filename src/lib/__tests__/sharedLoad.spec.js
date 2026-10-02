import { describe, expect, it, vi } from 'vitest'

import { createSharedLoad } from '../sharedLoad'

function deferred() {
  let resolve
  const promise = new Promise((done) => (resolve = done))
  return { promise, resolve }
}

describe('createSharedLoad', () => {
  it('shares one in-flight load between unforced callers', async () => {
    const sharedLoad = createSharedLoad()
    const owner = {}
    const gate = deferred()
    const load = vi.fn(() => gate.promise)

    const first = sharedLoad(owner, load)
    const second = sharedLoad(owner, load)
    gate.resolve('rows')

    await expect(Promise.all([first, second])).resolves.toEqual(['rows', 'rows'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('queues exactly one fresh load after an in-flight one for forced callers', async () => {
    const sharedLoad = createSharedLoad()
    const owner = {}
    const gates = [deferred(), deferred()]
    let calls = 0
    const load = vi.fn(() => gates[calls++].promise)

    const unforced = sharedLoad(owner, load)
    const forced = sharedLoad(owner, load, { force: true })
    const alsoForced = sharedLoad(owner, load, { force: true })
    expect(sharedLoad.current(owner)).toBe(forced)

    gates[0].resolve('stale')
    await expect(unforced).resolves.toBe('stale')
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    gates[1].resolve('fresh')

    await expect(Promise.all([forced, alsoForced])).resolves.toEqual(['fresh', 'fresh'])
    expect(load).toHaveBeenCalledTimes(2)
    expect(sharedLoad.current(owner)).toBeNull()
  })

  it('still runs the queued reload when the in-flight load rejects', async () => {
    const sharedLoad = createSharedLoad()
    const owner = {}
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('fresh')

    const first = sharedLoad(owner, load)
    const forced = sharedLoad(owner, load, { force: true })

    await expect(first).rejects.toThrow('offline')
    await expect(forced).resolves.toBe('fresh')
  })

  it('drops a queued reload once the owner is reset', async () => {
    const sharedLoad = createSharedLoad()
    const owner = {}
    const gate = deferred()
    const load = vi.fn(() => gate.promise)

    sharedLoad(owner, load)
    const forced = sharedLoad(owner, load, { force: true })
    sharedLoad.reset(owner)
    gate.resolve(true)

    await expect(forced).resolves.toBe(false)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('keeps owners apart', async () => {
    const sharedLoad = createSharedLoad()
    const load = vi.fn(async () => true)

    await Promise.all([sharedLoad({}, load), sharedLoad({}, load)])

    expect(load).toHaveBeenCalledTimes(2)
  })
})
