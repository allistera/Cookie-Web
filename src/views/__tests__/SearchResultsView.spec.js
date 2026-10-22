import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SearchResultsView from '../SearchResultsView.vue'
import EmailRow from '../../components/EmailRow.vue'
import { useSearchStore } from '../../stores/search'
import { useInboxStore } from '../../stores/inbox'
import { useSavedViewsStore } from '../../stores/savedViews'
import { savedViewRoute } from '../../lib/savedViews'

let store
let savedViews
let wrapper
let router
const button = (name) => wrapper.findAll('button').find((entry) => entry.text() === name)
beforeEach(() => {
  setActivePinia(createPinia())
  store = useSearchStore()
  savedViews = useSavedViewsStore()
  savedViews.ownerSub = 'account'
  savedViews.loaded = true
  vi.spyOn(store, 'search').mockResolvedValue()
  vi.spyOn(store, 'clear')
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/search', name: 'search', component: { template: '<div />' } },
      { path: '/:pathMatch(.*)*', component: { template: '<div />' } },
    ],
  })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(query = { q: 'work' }) {
  await router.push({ name: 'search', query })
  wrapper = mount(SearchResultsView, { global: { plugins: [router], stubs: { EmailRow: true } } })
}

describe('search results page', () => {
  it('uses route query, scope and page for searches and clears on unmount', async () => {
    await render({ q: [' work ', 'ignored'], scope: 'invalid', page: '2' })
    expect(store.search).toHaveBeenCalledWith('work', {
      scope: 'all',
      mode: undefined,
      limit: 20,
      offset: 40,
      verifiedPagination: false,
    })
    await button('Mail').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.scope).toBe('mail')
    expect(router.currentRoute.value.query.page).toBeUndefined()
    wrapper.unmount()
    wrapper = null
    expect(store.clear).toHaveBeenCalled()
  })

  it('clears missing queries and avoids searching without an account', async () => {
    await render({})
    expect(wrapper.text()).toContain('Type a search above')
    expect(store.search).not.toHaveBeenCalled()
    savedViews.ownerSub = null
    await router.replace({ name: 'search', query: { q: 'work' } })
    await flushPromises()
    expect(store.search).not.toHaveBeenCalled()
    expect(store.clear).toHaveBeenCalled()
  })

  it.each([
    ['unavailable', 'Search is temporarily unavailable.'],
    ['invalid', 'Enter a longer search term.'],
    ['failed', 'Search failed. Please try again.'],
  ])('shows %s errors', async (error, message) => {
    store.error = error
    await render()
    expect(wrapper.text()).toContain(message)
  })

  it('shows loading, empty results, and the verified scan limit warning', async () => {
    store.loading = true
    await render()
    expect(wrapper.find('.spinner').exists()).toBe(true)
    store.loading = false
    await nextTick()
    expect(wrapper.text()).toContain('No results for')
    store.scanLimitReached = true
    await nextTick()
    expect(wrapper.text()).toContain('No live messages found within the verified scan limit.')
    expect(wrapper.get('[role=alert]').text()).toContain('not a confirmed end of results')
  })

  it('opens the assistant and pre-fills a saved view from an ad-hoc mail search', async () => {
    const ask = vi.spyOn(useInboxStore(), 'askAssistant').mockImplementation(() => {})
    await render({ q: 'invoice in:sent', scope: 'mail' })
    await wrapper.get('.search-results-ask').trigger('click')
    expect(ask).toHaveBeenCalledWith('invoice in:sent')
    await button('Save as view').trigger('click')
    expect(savedViews.editor).toMatchObject({ mode: 'create', query: 'invoice', folder: 'sent' })
  })

  it('moves through regular search pages', async () => {
    store.results = [{ type: 'task', id: 'task-1', content: 'Work' }]
    store.estimatedTotalHits = 30
    await render()
    expect(button('Previous').element.disabled).toBe(true)
    await button('Next').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.page).toBe('1')
    expect(store.search).toHaveBeenLastCalledWith('work', expect.objectContaining({ offset: 20 }))
    await button('Previous').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.page).toBeUndefined()
  })

  it('uses verified cursors for saved views and opens their editor', async () => {
    const view = { id: 'view-1', name: 'Work', query: 'work', folder: 'inbox' }
    savedViews.views = [view]
    store.results = [{ type: 'task', id: 'task-1', content: 'Work' }]
    store.verifiedPagination = true
    store.nextOffset = 30
    await render(savedViewRoute(view).query)
    expect(wrapper.get('h1').text()).toBe('Work')
    expect(store.search).toHaveBeenCalledWith(
      'work in:inbox',
      expect.objectContaining({ verifiedPagination: true, offset: 0 }),
    )
    await button('Edit view').trigger('click')
    expect(savedViews.editor).toMatchObject({ mode: 'edit', id: view.id })
    await button('Next').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.cursor).toBe('30')
    await button('Previous').trigger('click')
    await flushPromises()
    expect(store.search).toHaveBeenLastCalledWith(
      'work in:inbox',
      expect.objectContaining({ offset: 0 }),
    )
  })

  it('opens mail results through the inbox reader', async () => {
    const row = {
      type: 'email',
      id: 'mail-1',
      subject: 'Hello',
      from_address: 'sender@example.com',
      sent_at: '2026-10-21T12:00:00Z',
    }
    store.results = [row]
    const open = vi.spyOn(useInboxStore(), 'openEmailFromSearch').mockImplementation(() => {})
    await render()
    wrapper.findComponent(EmailRow).vm.$emit('open')
    await flushPromises()
    expect(open).toHaveBeenCalledWith(row)
    expect(router.currentRoute.value.path).toBe('/inbox')
  })

  it.each([null, 'project-1'])('opens a task in its project: %s', async (projectId) => {
    store.results = [
      {
        type: 'task',
        id: 'task-1',
        content: 'Plan',
        description: 'Details',
        dueDate: '2026-10-21',
        projectId,
      },
    ]
    await render()
    expect(wrapper.text()).toContain('Due 21 Oct')
    await wrapper.get('.search-result-task').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({
      project: projectId ?? 'inbox',
      task: 'task-1',
    })
  })

  it('renders document metadata safely and opens the selected document', async () => {
    store.results = [
      {
        type: 'document',
        id: 'doc-1',
        title: 'Notes',
        starred: true,
        tags: ['work'],
        updated_at: Date.parse('2026-10-21T12:00:00Z'),
      },
      { type: 'document', id: 'doc-2', title: '', tags: [], updated_at: 'invalid' },
    ]
    await render()
    expect(wrapper.text()).toContain('#work')
    expect(wrapper.find('.search-result-doc-star').exists()).toBe(true)
    expect(wrapper.text()).toContain('21 Oct')
    await wrapper.get('.search-result-doc').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/documents/doc-1')
  })
})
