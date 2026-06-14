import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import { beforeEach, describe, expect, it } from 'vitest'
import FeedItem from '../FeedItem.vue'

const router = createRouter({ history: createWebHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })

const replyItem = {
  id: 'test-reply',
  kind: 'reply',
  from: 'Maya Chen',
  org: 'Acme Co',
  source: 'Gmail',
  subject: 'Re: Acme renewal',
  time: '9:41 AM',
  points: ['Point one.', 'Point two.'],
  draft: 'Hi Maya…',
  rules: ['Warm tone'],
}

const digestItem = {
  id: 'test-digest',
  kind: 'digest',
  from: 'Q3 Roadmap',
  org: 'Notion',
  source: 'Notion',
  subject: 'Q3 Roadmap — 6 edits',
  time: '8:20 AM',
  points: ['Change one.', 'Change two.', 'Change three.'],
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('FeedItem', () => {
  it('renders a reply item with "Reply ready" badge', () => {
    const wrapper = mount(FeedItem, {
      props: { item: replyItem },
      global: { plugins: [router] },
    })
    expect(wrapper.text()).toContain('Maya Chen')
    expect(wrapper.text()).toContain('Reply ready')
    expect(wrapper.text()).toContain('Review reply')
  })

  it('renders a digest item with key-points count badge', () => {
    const wrapper = mount(FeedItem, {
      props: { item: digestItem },
      global: { plugins: [router] },
    })
    expect(wrapper.text()).toContain('Q3 Roadmap')
    expect(wrapper.text()).toContain('3 key points')
    expect(wrapper.text()).toContain('Mark read')
  })

  it('shows the correct number of bullet points', () => {
    const wrapper = mount(FeedItem, {
      props: { item: digestItem },
      global: { plugins: [router] },
    })
    const points = wrapper.findAll('.points li')
    expect(points).toHaveLength(3)
  })
})
