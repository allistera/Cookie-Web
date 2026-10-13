import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  installConnectivityListeners,
  isNetworkError,
  isOnline,
  noteNetworkFailure,
  noteNetworkSuccess,
  onReconnect,
  resetConnectivityForTests,
} from '../connectivity'

beforeEach(() => {
  resetConnectivityForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isNetworkError', () => {
  it('recognises fetch failing at the network layer', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(
      true,
    )
  })

  it('recognises the Auth0 SDK timing out a token request', () => {
    const error = new Error('Timeout')
    error.error = 'timeout'
    expect(isNetworkError(error)).toBe(true)
  })

  it('leaves HTTP failures and other errors alone', () => {
    const httpError = new Error('GET /emails responded 500')
    httpError.status = 500
    expect(isNetworkError(httpError)).toBe(false)
    expect(isNetworkError(new Error('boom'))).toBe(false)
    const abort = new DOMException('Aborted', 'AbortError')
    expect(isNetworkError(abort)).toBe(false)
    expect(isNetworkError(null)).toBe(false)
  })
})

describe('online state', () => {
  it('goes offline on a network failure and back online on the next success', () => {
    const reconnected = vi.fn()
    onReconnect(reconnected)

    noteNetworkFailure()
    expect(isOnline.value).toBe(false)
    expect(reconnected).not.toHaveBeenCalled()

    noteNetworkSuccess()
    expect(isOnline.value).toBe(true)
    expect(reconnected).toHaveBeenCalledTimes(1)

    // Already online: nothing to announce.
    noteNetworkSuccess()
    expect(reconnected).toHaveBeenCalledTimes(1)
  })

  it('follows the browser online and offline events', () => {
    const target = new EventTarget()
    const reconnected = vi.fn()
    onReconnect(reconnected)
    const stop = installConnectivityListeners(target)

    target.dispatchEvent(new Event('offline'))
    expect(isOnline.value).toBe(false)
    target.dispatchEvent(new Event('online'))
    expect(isOnline.value).toBe(true)
    expect(reconnected).toHaveBeenCalledTimes(1)

    stop()
    target.dispatchEvent(new Event('offline'))
    expect(isOnline.value).toBe(true)
  })

  it('lets a reconnect listener unsubscribe and survives one that throws', () => {
    const failing = vi.fn(() => {
      throw new Error('listener broke')
    })
    const second = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    onReconnect(failing)
    const stopSecond = onReconnect(second)

    noteNetworkFailure()
    noteNetworkSuccess()
    expect(second).toHaveBeenCalledTimes(1)

    stopSecond()
    noteNetworkFailure()
    noteNetworkSuccess()
    expect(second).toHaveBeenCalledTimes(1)
    expect(failing).toHaveBeenCalledTimes(2)
  })
})
