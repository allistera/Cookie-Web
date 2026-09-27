import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import SidebarResizer from '../SidebarResizer.vue'
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebarWidth,
} from '../../composables/useSidebarWidth'

// jsdom has no layout, so the sidebar's rendered width is stubbed.
function mountAfterSidebar(renderedWidth = 240) {
  const host = document.createElement('div')
  const sidebar = document.createElement('aside')
  Object.defineProperty(sidebar, 'offsetWidth', { value: renderedWidth })
  host.append(sidebar)
  document.body.append(host)
  const wrapper = mount(SidebarResizer, { attachTo: host })
  // The handle measures the element right before it, as in the app layout.
  sidebar.after(wrapper.element)
  return wrapper
}

function pointer(type, clientX) {
  const event = new MouseEvent(type, { bubbles: true, clientX, button: 0 })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event
}

describe('SidebarResizer', () => {
  afterEach(() => {
    useSidebarWidth().resetWidth()
    document.body.replaceChildren()
  })

  it('is an accessible vertical separator', () => {
    const wrapper = mountAfterSidebar()
    const handle = wrapper.get('[role="separator"]')
    expect(handle.attributes()).toMatchObject({
      'aria-orientation': 'vertical',
      'aria-label': 'Resize sidebar',
      'aria-valuemin': String(SIDEBAR_MIN_WIDTH),
      'aria-valuemax': String(SIDEBAR_MAX_WIDTH),
      tabindex: '0',
    })
  })

  it('drags from the sidebar’s current width and clamps to the limits', async () => {
    const wrapper = mountAfterSidebar(240)
    const el = wrapper.element
    el.dispatchEvent(pointer('pointerdown', 100))
    el.dispatchEvent(pointer('pointermove', 160))
    expect(useSidebarWidth().width.value).toBe(300)
    expect(document.body.classList.contains('sidebar-resizing')).toBe(true)
    el.dispatchEvent(pointer('pointermove', 2000))
    expect(useSidebarWidth().width.value).toBe(SIDEBAR_MAX_WIDTH)
    el.dispatchEvent(pointer('pointerup', 2000))
    expect(document.body.classList.contains('sidebar-resizing')).toBe(false)
    await wrapper.vm.$nextTick()
    expect(wrapper.attributes('aria-valuenow')).toBe(String(SIDEBAR_MAX_WIDTH))
  })

  it('resizes with the keyboard and resets on Escape or double-click', async () => {
    const wrapper = mountAfterSidebar(240)
    await wrapper.trigger('keydown', { key: 'ArrowRight' })
    expect(useSidebarWidth().width.value).toBe(256)
    await wrapper.trigger('keydown', { key: 'Home' })
    expect(useSidebarWidth().width.value).toBe(SIDEBAR_MIN_WIDTH)
    await wrapper.trigger('keydown', { key: 'Escape' })
    expect(useSidebarWidth().width.value).toBeNull()
    await wrapper.trigger('keydown', { key: 'End' })
    await wrapper.trigger('dblclick')
    expect(useSidebarWidth().width.value).toBeNull()
  })
})
