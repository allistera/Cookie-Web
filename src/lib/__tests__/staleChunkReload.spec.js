import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RELOAD_KEY, installStaleChunkReload, isReloadingForStaleChunk } from '../staleChunkReload'

function makeStorage(initial = {}) {
  const data = { ...initial }
  return {
    getItem: vi.fn((key) => data[key] ?? null),
    setItem: vi.fn((key, value) => {
      data[key] = String(value)
    }),
  }
}

function preloadError() {
  const event = new Event('vite:preloadError', { cancelable: true })
  event.payload = new TypeError('Failed to fetch dynamically imported module')
  return event
}

describe('installStaleChunkReload', () => {
  let target

  beforeEach(() => {
    target = new EventTarget()
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reloads the page once when a chunk from an old deploy fails to load', () => {
    const reload = vi.fn()
    const storage = makeStorage()
    installStaleChunkReload({ target, storage, reload })

    const event = preloadError()
    target.dispatchEvent(event)

    expect(reload).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    expect(storage.setItem).toHaveBeenCalledWith(RELOAD_KEY, '1000000')
  })

  it('does not reload again if a reload just happened, so the error surfaces', () => {
    const reload = vi.fn()
    const storage = makeStorage({ [RELOAD_KEY]: String(1_000_000 - 5_000) })
    installStaleChunkReload({ target, storage, reload })

    const event = preloadError()
    target.dispatchEvent(event)

    expect(reload).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('reloads again once the previous reload is old enough', () => {
    const reload = vi.fn()
    const storage = makeStorage({ [RELOAD_KEY]: String(1_000_000 - 60_000) })
    installStaleChunkReload({ target, storage, reload })

    target.dispatchEvent(preloadError())

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('still reloads when session storage is unavailable', () => {
    const reload = vi.fn()
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('blocked')
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked')
      }),
    }
    installStaleChunkReload({ target, storage, reload })

    target.dispatchEvent(preloadError())

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('returns an uninstaller', () => {
    const reload = vi.fn()
    const uninstall = installStaleChunkReload({ target, storage: makeStorage(), reload })

    uninstall()
    target.dispatchEvent(preloadError())

    expect(reload).not.toHaveBeenCalled()
  })
})

describe('installStaleChunkReload while offline', () => {
  it('leaves the error to surface rather than reloading away from the page', () => {
    const reload = vi.fn()
    const storage = makeStorage()
    const target = new EventTarget()
    installStaleChunkReload({ target, storage, reload, isOnline: () => false })
    const event = preloadError()
    target.dispatchEvent(event)

    expect(reload).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
  })
})

describe('isReloadingForStaleChunk', () => {
  it('is true only within the cooldown after a reload was started', () => {
    expect(isReloadingForStaleChunk(makeStorage(), 1_000_000)).toBe(false)
    const storage = makeStorage({ [RELOAD_KEY]: '1000000' })
    expect(isReloadingForStaleChunk(storage, 1_005_000)).toBe(true)
    expect(isReloadingForStaleChunk(storage, 1_040_000)).toBe(false)
  })

  it('is false when storage is unavailable', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('blocked')
      }),
    }
    expect(isReloadingForStaleChunk(storage)).toBe(false)
    expect(isReloadingForStaleChunk(undefined)).toBe(false)
  })
})
