import { describe, expect, it, vi } from 'vitest'
import { subscribeTaskMutations } from '../taskMutationRefresh'

function harness() {
  let listener
  const refresh = vi.fn()
  const stop = subscribeTaskMutations(
    {
      $onAction: (fn) => {
        listener = fn
        return vi.fn()
      },
    },
    refresh,
  )
  function action(name, ...args) {
    let success = () => {}
    let failure = () => {}
    listener({
      name,
      args,
      after: (fn) => {
        success = fn
      },
      onError: (fn) => {
        failure = fn
      },
    })
    return { success, failure }
  }
  return { action, refresh, stop }
}

describe('task history invalidation', () => {
  it('refreshes after an explicitly completed external sync', async () => {
    const { action, refresh } = harness()
    action('invalidateHistory').success()
    await Promise.resolve()
    expect(refresh).toHaveBeenCalledTimes(1)
  })
  it('ignores reads and failed writes', async () => {
    const { action, refresh } = harness()
    action('request', 'GET').success()
    action('request', 'PATCH').failure()
    await Promise.resolve()
    expect(refresh).not.toHaveBeenCalled()
  })
  it('coalesces sequential bulk writes including partial failures', async () => {
    const { action, refresh } = harness()
    const batch = action('moveItems')
    action('request', 'PATCH').success()
    await Promise.resolve()
    action('request', 'PATCH').failure()
    await Promise.resolve()
    action('request', 'PATCH').success()
    expect(refresh).not.toHaveBeenCalled()
    batch.success()
    await Promise.resolve()
    expect(refresh).toHaveBeenCalledTimes(1)
  })
  it('drops queued refresh after disposal', async () => {
    const { action, refresh, stop } = harness()
    action('request', 'POST').success()
    stop()
    await Promise.resolve()
    expect(refresh).not.toHaveBeenCalled()
  })
})
