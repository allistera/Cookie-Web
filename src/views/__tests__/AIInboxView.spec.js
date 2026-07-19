import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

import AIInboxView from '../AIInboxView.vue'

describe('AIInboxView (AI Today mock)', () => {
  it('greets Allister with the to-do and topic counters', () => {
    const wrapper = mount(AIInboxView)
    const greeting = wrapper.get('.ai-greeting').text()
    expect(greeting).toContain('Hi Allister')
    expect(greeting).toContain('5 to-dos')
    expect(greeting).toContain('4 topics')
  })

  it('shows three suggested to-dos with a "Show 2 more" toggle', () => {
    const wrapper = mount(AIInboxView)
    const rows = wrapper.get('[data-testid="todo-rows"]').findAll('.todo-row')
    expect(rows).toHaveLength(3)

    const text = wrapper.text()
    expect(text).toContain('Kitchen Renovation')
    expect(text).toContain('RSVP for College Tour')
    expect(text).toContain('Bring snack to soccer practice')
    expect(wrapper.get('.show-more-btn').text()).toContain('Show 2 more')
  })

  it('reveals the hidden to-dos when "Show more" is clicked', async () => {
    const wrapper = mount(AIInboxView)
    await wrapper.get('.show-more-btn').trigger('click')

    const rows = wrapper.get('[data-testid="todo-rows"]').findAll('.todo-row')
    expect(rows).toHaveLength(5)
    expect(wrapper.find('.show-more-btn').exists()).toBe(false)
  })

  it('completing a to-do removes it and decrements the counter', async () => {
    const wrapper = mount(AIInboxView)
    const firstRow = wrapper.get('[data-testid="todo-rows"]').findAll('.todo-row')[0]
    await firstRow.get('.todo-check-btn').trigger('click')

    const rows = wrapper.get('[data-testid="todo-rows"]').findAll('.todo-row')
    expect(rows).toHaveLength(2)
    expect(wrapper.get('.ai-greeting').text()).toContain('4 to-dos')
  })

  it('renders the four catch-up topics', () => {
    const wrapper = mount(AIInboxView)
    const titles = wrapper.findAll('.topic-title').map((t) => t.text())
    expect(titles).toHaveLength(4)
    expect(titles[0]).toContain('Kitchen Renovation')
    expect(titles[1]).toContain('College Search')
    expect(titles[2]).toContain('Soccer Spring Season')
    expect(titles[3]).toContain('More Updates')
  })
})
