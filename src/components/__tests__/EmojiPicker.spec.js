import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import EmojiPicker from '../EmojiPicker.vue'

function mountPicker(props = {}) {
  return mount(EmojiPicker, { attachTo: document.body, props })
}

describe('EmojiPicker', () => {
  beforeEach(() => localStorage.clear())

  it('opens the popover from the toggle button and focuses the search box', async () => {
    const wrapper = mountPicker()
    expect(wrapper.find('.composer-emoji-popover').exists()).toBe(false)

    await wrapper.get('.composer-emoji-btn').trigger('click')

    expect(wrapper.get('.composer-emoji-btn').attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.composer-emoji-popover').exists()).toBe(true)
    expect(document.activeElement).toBe(wrapper.get('.composer-emoji-search').element)
    expect(wrapper.findAll('.composer-emoji-item').length).toBeGreaterThan(100)
    wrapper.unmount()
  })

  it('emits the chosen emoji, closes, and lists it under recently used next time', async () => {
    const wrapper = mountPicker()
    await wrapper.get('.composer-emoji-btn').trigger('click')

    await wrapper.get('.composer-emoji-item[aria-label="party popper"]').trigger('click')

    expect(wrapper.emitted('select')).toEqual([['🎉']])
    expect(wrapper.find('.composer-emoji-popover').exists()).toBe(false)

    await wrapper.get('.composer-emoji-btn').trigger('click')
    const firstGroup = wrapper.findAll('.composer-emoji-group')[0]
    expect(firstGroup.find('.composer-emoji-group-title').text()).toBe('Recently used')
    expect(firstGroup.findAll('.composer-emoji-item').map((item) => item.text())).toEqual(['🎉'])
    wrapper.unmount()
  })

  it('filters the grid by the search query and shows an empty state', async () => {
    const wrapper = mountPicker()
    await wrapper.get('.composer-emoji-btn').trigger('click')

    await wrapper.get('.composer-emoji-search').setValue('thumbs')
    const labels = wrapper.findAll('.composer-emoji-item').map((item) => item.attributes('title'))
    expect(labels).toEqual(['thumbs up', 'thumbs down'])

    await wrapper.get('.composer-emoji-search').setValue('no such emoji')
    expect(wrapper.findAll('.composer-emoji-item')).toHaveLength(0)
    expect(wrapper.get('.composer-emoji-empty').text()).toBe('No emoji found')
    wrapper.unmount()
  })

  it('closes on Escape and on clicks outside the picker', async () => {
    const wrapper = mountPicker()
    await wrapper.get('.composer-emoji-btn').trigger('click')
    await wrapper.get('.composer-emoji-search').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.composer-emoji-popover').exists()).toBe(false)

    await wrapper.get('.composer-emoji-btn').trigger('click')
    expect(wrapper.find('.composer-emoji-popover').exists()).toBe(true)
    document.body.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.composer-emoji-popover').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not open while disabled', async () => {
    const wrapper = mountPicker({ disabled: true })
    expect(wrapper.get('.composer-emoji-btn').attributes('disabled')).toBeDefined()
    await wrapper.get('.composer-emoji-btn').trigger('click')
    expect(wrapper.find('.composer-emoji-popover').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows no tabs and inserts plain emoji without the icons prop', async () => {
    const wrapper = mountPicker()
    await wrapper.get('.composer-emoji-btn').trigger('click')
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    expect(wrapper.get('.composer-emoji-popover').attributes('aria-label')).toBe('Emoji picker')
    wrapper.unmount()
  })

  describe('with the icons prop', () => {
    it('opens on the Icons tab and emits an ms: value', async () => {
      const wrapper = mountPicker({ icons: true, emoji: 'ms:description' })
      expect(wrapper.get('.composer-emoji-btn .material-symbols-outlined').text()).toBe(
        'description',
      )
      await wrapper.get('.composer-emoji-btn').trigger('click')

      const tabs = wrapper.findAll('[role="tab"]')
      expect(tabs.map((tab) => tab.text())).toEqual(['Icons', 'Emoji'])
      expect(tabs[0].attributes('aria-selected')).toBe('true')
      expect(tabs[0].attributes('tabindex')).toBe('0')
      expect(tabs[1].attributes('tabindex')).toBe('-1')
      const panel = wrapper.get('[role="tabpanel"]')
      expect(panel.attributes('aria-labelledby')).toBe(tabs[0].attributes('id'))
      expect(tabs[0].attributes('aria-controls')).toBe(panel.attributes('id'))
      expect(wrapper.get('.composer-emoji-search').attributes('aria-label')).toBe('Search icons')

      await wrapper.get('.composer-emoji-search').setValue('rocket')
      await wrapper.get('.composer-emoji-item[aria-label="rocket launch"]').trigger('click')

      expect(wrapper.emitted('select')).toEqual([['ms:rocket_launch']])
      expect(wrapper.find('.composer-emoji-popover').exists()).toBe(false)
      wrapper.unmount()
    })

    it('switches to the Emoji tab by click or arrow key', async () => {
      const wrapper = mountPicker({ icons: true })
      await wrapper.get('.composer-emoji-btn').trigger('click')

      await wrapper.get('[role="tablist"]').trigger('keydown', { key: 'ArrowRight' })
      let tabs = wrapper.findAll('[role="tab"]')
      expect(tabs[1].attributes('aria-selected')).toBe('true')
      expect(document.activeElement).toBe(tabs[1].element)
      expect(wrapper.get('.composer-emoji-search').attributes('aria-label')).toBe('Search emoji')

      await wrapper.get('.composer-emoji-item[aria-label="party popper"]').trigger('click')
      expect(wrapper.emitted('select')).toEqual([['🎉']])

      await wrapper.get('.composer-emoji-btn').trigger('click')
      tabs = wrapper.findAll('[role="tab"]')
      expect(tabs[0].attributes('aria-selected')).toBe('true')
      await tabs[1].trigger('click')
      expect(wrapper.findAll('[role="tab"]')[1].attributes('aria-selected')).toBe('true')
      wrapper.unmount()
    })

    it('shows an icon-specific empty state', async () => {
      const wrapper = mountPicker({ icons: true })
      await wrapper.get('.composer-emoji-btn').trigger('click')
      await wrapper.get('.composer-emoji-search').setValue('no such icon')
      expect(wrapper.findAll('.composer-emoji-item')).toHaveLength(0)
      expect(wrapper.get('.composer-emoji-empty').text()).toBe('No icons found')
      wrapper.unmount()
    })
  })
})
