import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'

import { useSwipeTabs } from '../useSwipeTabs'

function setup({ enabled = true, canGo = () => true, reducedMotion = true } = {}) {
  const go = vi.fn()
  const state = {}
  const wrapper = mount(
    defineComponent({
      setup() {
        const el = ref(null)
        Object.assign(
          state,
          useSwipeTabs(el, {
            enabled: () => enabled,
            canGo,
            go,
            reducedMotion: () => reducedMotion,
          }),
        )
        return () => h('div', { ref: el, style: state.style.value })
      },
    }),
    { attachTo: document.body },
  )
  const wheel = (deltaX, deltaY = 0, extra = {}) => {
    const event = new WheelEvent('wheel', {
      deltaX,
      deltaY,
      bubbles: true,
      cancelable: true,
      ...extra,
    })
    wrapper.element.dispatchEvent(event)
    return event
  }
  return { wrapper, wheel, go, state }
}

describe('useSwipeTabs', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('moves to the next tab after a long enough leftward swipe, once per gesture', () => {
    const { wheel, go } = setup()
    for (let i = 0; i < 10; i++) expect(wheel(20).defaultPrevented).toBe(true)
    expect(go).toHaveBeenCalledTimes(1)
    expect(go).toHaveBeenCalledWith(1)
    // Trailing momentum from the same flick must not skip another tab.
    for (let i = 0; i < 10; i++) wheel(20)
    expect(go).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(400)
    for (let i = 0; i < 10; i++) wheel(-20)
    expect(go).toHaveBeenLastCalledWith(-1)
  })

  it('follows the fingers and springs back when the swipe is too short', async () => {
    const { wheel, go, state } = setup()
    wheel(30)
    wheel(30)
    expect(state.offset.value).toBe(-60)
    vi.advanceTimersByTime(200)
    await vi.runAllTimersAsync()
    expect(state.offset.value).toBe(0)
    expect(go).not.toHaveBeenCalled()
  })

  it('only resists at the first or last tab', () => {
    const { wheel, go, state } = setup({ canGo: (direction) => direction === 1 })
    for (let i = 0; i < 10; i++) wheel(-20)
    expect(go).not.toHaveBeenCalled()
    expect(state.offset.value).toBe(50)
  })

  it('leaves vertical scrolling, pinch zoom and disabled lists alone', () => {
    const { wheel, go } = setup()
    expect(wheel(2, 40).defaultPrevented).toBe(false)
    expect(wheel(80, 0, { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(go).not.toHaveBeenCalled()

    const disabled = setup({ enabled: false })
    expect(disabled.wheel(80).defaultPrevented).toBe(false)
    expect(disabled.go).not.toHaveBeenCalled()
  })
})
