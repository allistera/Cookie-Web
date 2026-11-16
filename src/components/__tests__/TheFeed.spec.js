import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TheFeed from '../TheFeed.vue'
import EmailBody from '../EmailBody.vue'
import { useInboxStore } from '../../stores/inbox'
import { useSendersStore } from '../../stores/senders'
import { setAuth0Client } from '../../auth0-client'

setAuth0Client(null)

const newsletter = (id, extra = {}) => ({
  id,
  sender: 'Daily Bites',
  address: 'newsletter@example.com',
  subject: `Issue ${id}`,
  snippet: 'This week',
  date: '9:42 am',
  unread: false,
  isArchived: false,
  ...extra,
})

const body = (text) => ({ html: null, text, thread: [], attachments: [] })

let store
let lookup

function mountFeed(emails, showsImages = () => false) {
  return mount(TheFeed, {
    props: { emails, showsImages },
    slots: { default: '<p class="after-posts">After the posts</p>' },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  store = useInboxStore()
  lookup = vi.spyOn(useSendersStore(), 'lookup').mockResolvedValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('TheFeed', () => {
  it('shows each newsletter as a post with its content open', async () => {
    const fetchBody = vi
      .spyOn(store, 'fetchMessageBody')
      .mockImplementation(async (id) => body(`The whole of ${id}`))
    useSendersStore().known['known@example.com'] = 'accepted'
    const wrapper = mountFeed([
      newsletter('one', { unread: true }),
      newsletter('two', { isArchived: true, address: 'Known@Example.com' }),
    ])
    expect(wrapper.findAll('[role="status"]')).toHaveLength(2)
    await flushPromises()

    const posts = wrapper.findAll('.feed-post')
    expect(posts.map((post) => post.get('h2').text())).toEqual(['Issue one', 'Issue two'])
    expect(posts[0].get('.feed-post-meta').text()).toContain('Daily Bites')
    expect(posts[0].get('.feed-post-meta').text()).toContain('9:42 am')
    expect(posts[0].text()).toContain('The whole of one')
    expect(posts[1].text()).toContain('The whole of two')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(fetchBody.mock.calls).toEqual([['one'], ['two']])
    // Only a sender whose decision is not known yet is asked about.
    expect(lookup.mock.calls).toEqual([['newsletter@example.com']])

    // Unread and done show on the post; a done post offers no Done button.
    expect(posts[0].find('[aria-label="Unread"]').exists()).toBe(true)
    expect(posts[1].find('[aria-label="Unread"]').exists()).toBe(false)
    expect(posts[0].find('.feed-post-done').exists()).toBe(false)
    expect(posts[1].get('.feed-post-done').text()).toBe('Done')
    expect(posts[1].find('[title="Done"]').exists()).toBe(false)
    expect(wrapper.get('.after-posts').text()).toBe('After the posts')
  })

  it('opens a post in the reader from its title and marks it done', async () => {
    vi.spyOn(store, 'fetchMessageBody').mockResolvedValue(body('Text'))
    const emails = [newsletter('one')]
    const wrapper = mountFeed(emails)
    await flushPromises()

    await wrapper.get('.feed-post-open').trigger('click')
    expect(wrapper.emitted('open')).toEqual([[emails[0]]])
    await wrapper.get('[aria-label="Mark Issue one done"]').trigger('click')
    expect(wrapper.emitted('done')).toEqual([[emails[0]]])
  })

  it('applies the image rule per post and passes on keys pressed inside a body', async () => {
    vi.spyOn(store, 'fetchMessageBody').mockResolvedValue(body('Text'))
    const wrapper = mountFeed(
      [newsletter('trusted'), newsletter('unknown')],
      (email) => email.id === 'trusted',
    )
    await flushPromises()

    const bodies = wrapper.findAllComponents(EmailBody)
    expect(bodies.map((component) => component.props('showImages'))).toEqual([true, false])
    const press = new KeyboardEvent('keydown', { key: 'd' })
    bodies[0].vm.$emit('keydown', press)
    expect(wrapper.emitted('keydown')).toEqual([[press]])
  })

  it('offers to try again when a post fails to load', async () => {
    const fetchBody = vi.spyOn(store, 'fetchMessageBody').mockResolvedValueOnce(null)
    const wrapper = mountFeed([newsletter('one')])
    await flushPromises()
    expect(wrapper.get('.feed-post-status').text()).toContain("Couldn't load this newsletter.")

    fetchBody.mockResolvedValue(body('Second time lucky'))
    await wrapper.get('.feed-post-status button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.feed-post-status').exists()).toBe(false)
    expect(wrapper.text()).toContain('Second time lucky')
  })

  it('loads the posts a longer list adds, without asking again for the others', async () => {
    const fetchBody = vi
      .spyOn(store, 'fetchMessageBody')
      .mockImplementation(async (id) => body(`The whole of ${id}`))
    const wrapper = mountFeed([newsletter('one')])
    await flushPromises()

    await wrapper.setProps({ emails: [newsletter('one'), newsletter('two')] })
    await flushPromises()
    expect(fetchBody.mock.calls).toEqual([['one'], ['two']])
    expect(wrapper.text()).toContain('The whole of two')
  })

  it('loads a post only as it nears the visible part of the feed', async () => {
    let observer
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback, options) {
          this.callback = callback
          this.options = options
          this.observed = []
          observer = this
        }
        observe(element) {
          this.observed.push(element)
        }
        unobserve(element) {
          this.observed = this.observed.filter((candidate) => candidate !== element)
        }
        disconnect() {
          this.observed = []
        }
      },
    )
    const fetchBody = vi
      .spyOn(store, 'fetchMessageBody')
      .mockImplementation(async (id) => body(`The whole of ${id}`))
    const wrapper = mountFeed([newsletter('one'), newsletter('two')])
    await flushPromises()
    expect(fetchBody).not.toHaveBeenCalled()
    expect(observer.options.root).toBe(wrapper.element)
    expect(observer.observed.map((element) => element.dataset.postId)).toEqual(['one', 'two'])

    observer.callback([
      { isIntersecting: true, target: observer.observed[0] },
      { isIntersecting: false, target: observer.observed[1] },
    ])
    await flushPromises()
    expect(fetchBody.mock.calls).toEqual([['one']])
    expect(observer.observed.map((element) => element.dataset.postId)).toEqual(['two'])
    expect(wrapper.findAll('.feed-post')[0].text()).toContain('The whole of one')
    expect(wrapper.findAll('[role="status"]')).toHaveLength(1)
  })
})
