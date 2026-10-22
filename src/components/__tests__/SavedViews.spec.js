import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SavedViewsSidebar from '../SavedViewsSidebar.vue'
import SavedViewEditor from '../SavedViewEditor.vue'
import { useSavedViewsStore } from '../../stores/savedViews'
import { useInboxStore } from '../../stores/inbox'
import { setAuth0Client } from '../../auth0-client'
import { savedViewRoute } from '../../lib/savedViews'

let wrapper
let store
let router
const first = { id: 'view-1', name: 'Work', query: 'work', folder: 'inbox' }
const second = { id: 'view-2', name: 'Receipts', query: 'receipt', folder: 'all' }
const button = (text) => wrapper.findAll('button').find((entry) => entry.text() === text)

beforeEach(async () => {
  setActivePinia(createPinia())
  setAuth0Client(null)
  store = useSavedViewsStore()
  store.loaded = true
  store.views = [{ ...first }, { ...second }]
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/search', name: 'search', component: { template: '<div />' } }],
  })
  await router.push('/search')
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.open = true
    },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.open = false
    },
  })
  vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  wrapper?.unmount()
  delete HTMLDialogElement.prototype.showModal
  delete HTMLDialogElement.prototype.close
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function render(component) {
  wrapper = mount(component, { attachTo: document.body, global: { plugins: [router] } })
}

describe('saved views sidebar', () => {
  it('shows only populated views and highlights the matching route', async () => {
    await router.push(savedViewRoute(first))
    render(SavedViewsSidebar)
    expect(wrapper.findAll('nav a')).toHaveLength(2)
    expect(wrapper.get('nav a.active').text()).toContain('Work')
    store.views = []
    await nextTick()
    expect(wrapper.find('section').exists()).toBe(false)
  })

  it('opens new and edit forms and dismisses menus outside the row', async () => {
    render(SavedViewsSidebar)
    await wrapper.get('[aria-label="New saved view"]').trigger('click')
    expect(store.editor.mode).toBe('create')
    await wrapper.get('[aria-label="Actions for Work"]').trigger('click')
    await button('Edit').trigger('click')
    expect(store.editor).toMatchObject({ mode: 'edit', id: first.id, name: first.name })
    expect(wrapper.find('[role=menu]').exists()).toBe(false)
    await wrapper.get('[aria-label="Actions for Work"]').trigger('click')
    await wrapper.get('[aria-label="Actions for Work"]').trigger('click')
    expect(wrapper.find('[role=menu]').exists()).toBe(false)
    await wrapper.get('[aria-label="Actions for Work"]').trigger('click')
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await nextTick()
    expect(wrapper.find('[role=menu]').exists()).toBe(false)
    await wrapper.get('[aria-label="Actions for Work"]').trigger('click')
    await wrapper.get('.saved-view-row').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role=menu]').exists()).toBe(false)
  })

  it('renames and reorders a draft before saving', async () => {
    const save = vi.spyOn(store, 'save').mockResolvedValue(true)
    render(SavedViewsSidebar)
    await button('Manage').trigger('click')
    expect(wrapper.get('dialog').element.open).toBe(true)
    await wrapper.findAll('input')[0].setValue('  Important work  ')
    await button('Down').trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(save).toHaveBeenCalledWith([second, { ...first, name: 'Important work' }])
    expect(wrapper.get('dialog').element.open).toBe(false)
  })

  it('keeps failed edits open and can replace them with the latest views', async () => {
    vi.spyOn(store, 'save').mockResolvedValue(false)
    render(SavedViewsSidebar)
    await button('Manage').trigger('click')
    await wrapper.findAll('input')[0].setValue('Unsaved')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('dialog').element.open).toBe(true)
    store.views = [{ ...first, name: 'Server update' }]
    store.conflict = true
    store.error = 'Changed elsewhere'
    await nextTick()
    expect(wrapper.get('[role=alert]').text()).toBe('Changed elsewhere')
    await button('Use latest views').trigger('click')
    expect(wrapper.get('input').element.value).toBe('Server update')
    expect(store.conflict).toBe(false)
    await button('Cancel').trigger('click')
    expect(wrapper.get('dialog').element.open).toBe(false)
  })

  it('closes the manager and clears its draft when the account changes', async () => {
    render(SavedViewsSidebar)
    await button('Manage').trigger('click')
    store.ownerSub = 'different-account'
    await nextTick()
    expect(wrapper.get('dialog').element.open).toBe(false)
    expect(wrapper.findAll('input')).toHaveLength(0)
  })

  it('deletes the active view without leaving a stale route and offers undo', async () => {
    await router.push(savedViewRoute(first))
    const remove = vi.spyOn(store, 'deleteView').mockResolvedValue({ view: first, index: 0 })
    const restore = vi.spyOn(store, 'restoreView').mockResolvedValue(true)
    render(SavedViewsSidebar)
    await wrapper.get('[aria-label="Actions for Work"]').trigger('click')
    await button('Delete').trigger('click')
    await flushPromises()
    expect(remove).toHaveBeenCalledWith(first.id)
    expect(router.currentRoute.value.query.view).toBeUndefined()
    const notify = useInboxStore().notify
    expect(notify).toHaveBeenCalledWith(
      'Deleted saved view "Work".',
      'info',
      expect.objectContaining({ label: 'Undo' }),
    )
    await notify.mock.calls[0][2].run()
    expect(restore).toHaveBeenCalledWith(first, 0)
  })

  it('reports deletion failure without changing the route', async () => {
    await router.push(savedViewRoute(first))
    vi.spyOn(store, 'deleteView').mockResolvedValue(null)
    render(SavedViewsSidebar)
    await wrapper.get('[aria-label="Actions for Work"]').trigger('click')
    await button('Delete').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.view).toBe(first.id)
    expect(useInboxStore().notify).toHaveBeenCalledWith(
      'Could not delete the view. Please try again.',
      'error',
    )
  })
})

describe('saved view editor', () => {
  it('opens a new view after saving it and closes the dialog', async () => {
    const create = vi.spyOn(store, 'createView').mockResolvedValue(first)
    render(SavedViewEditor)
    store.openEditor({ draft: first })
    await flushPromises()
    expect(wrapper.get('dialog').element.open).toBe(true)
    expect(document.activeElement).toBe(wrapper.findAll('input')[0].element)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(create).toHaveBeenCalledWith({
      name: first.name,
      query: first.query,
      folder: first.folder,
    })
    expect(router.currentRoute.value.query.view).toBe(first.id)
    expect(wrapper.get('dialog').element.open).toBe(false)
  })

  it.each([true, false])(
    'updates an existing view; refreshes the route only when active: %s',
    async (active) => {
      await router.push(active ? savedViewRoute(first) : '/search')
      const updated = { ...first, query: 'new query' }
      const update = vi.spyOn(store, 'updateView').mockResolvedValue(updated)
      store.openEditor({ view: first })
      render(SavedViewEditor)
      await flushPromises()
      await wrapper.findAll('input')[1].setValue(updated.query)
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(update).toHaveBeenCalledWith(
        first.id,
        { name: first.name, query: updated.query, folder: first.folder },
        first,
      )
      expect(router.currentRoute.value.query.view).toBe(active ? first.id : undefined)
      expect(store.editor).toBeNull()
    },
  )

  it('can save an edited view as a new definition', async () => {
    const create = vi.spyOn(store, 'createView').mockResolvedValue(second)
    store.openEditor({ view: first })
    render(SavedViewEditor)
    await flushPromises()
    await button('Save as new view').trigger('click')
    await flushPromises()
    expect(create).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.query.view).toBe(second.id)
  })

  it('keeps edits after a failed save and closes on cancel', async () => {
    vi.spyOn(store, 'createView').mockResolvedValue(null)
    store.openEditor({ draft: first })
    render(SavedViewEditor)
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(store.editor.name).toBe(first.name)
    await wrapper.get('dialog').trigger('cancel')
    expect(store.editor).toBeNull()
  })

  it('previews only email hits and invalidates them when the query changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            { id: 'document', type: 'document' },
            { id: 'email', type: 'email', subject: '' },
          ],
          estimatedTotalHits: 10,
        }),
      }),
    )
    store.openEditor({ draft: first })
    render(SavedViewEditor)
    await flushPromises()
    await button('Preview').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role=status]').text()).toBe('About 10 matching emails. First 1:')
    expect(wrapper.get('.saved-view-preview-list').text()).toBe('(no subject)')
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('q')).toBe('work in:inbox')
    await wrapper.findAll('input')[1].setValue('changed')
    expect(wrapper.find('[role=status]').exists()).toBe(false)
  })

  it.each([
    { ok: true, json: async () => ({}) },
    { ok: false, status: 503 },
  ])('shows empty or failed previews: %j', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    store.openEditor({ draft: first })
    render(SavedViewEditor)
    await flushPromises()
    await button('Preview').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(
      response.ok ? 'No matching emails.' : 'Could not preview this search.',
    )
  })
})
