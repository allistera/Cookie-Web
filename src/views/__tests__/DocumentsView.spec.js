import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'

import DocumentsView from '../DocumentsView.vue'
import { useDocumentsStore } from '../../stores/documents'

let router
let store

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

beforeEach(() => {
  setActivePinia(createPinia())
  store = useDocumentsStore()
  vi.spyOn(store, 'openDocument').mockResolvedValue()
  vi.spyOn(store, 'loadDocumentPage').mockResolvedValue()
  vi.spyOn(store, 'flushPendingSave').mockResolvedValue(true)
  // Both records render the same component, so RouterView reuses one
  // DocumentsView instance across them. onBeforeRouteUpdate binds to the
  // record matched at setup; RouterView carries the guards over to the next
  // record when it reuses the instance, which these tests pin down.
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/documents/file/:fileId', name: 'document-file', component: DocumentsView },
      { path: '/documents/:id?', name: 'documents', component: DocumentsView },
      { path: '/elsewhere', name: 'elsewhere', component: { template: '<div />' } },
    ],
  })
})

async function mountAt(path) {
  await router.push(path)
  await router.isReady()
  const wrapper = mount(RouterView, {
    global: {
      plugins: [router],
      stubs: {
        DocumentsBrowser: true,
        FilePreview: true,
        DocumentCalendarSidebar: true,
        NewDocumentDialog: true,
        DocumentEditor: true,
      },
    },
  })
  await flushPromises()
  return wrapper
}

describe('DocumentsView', () => {
  it.each([
    ['saving', 'Saving…'],
    ['saved', 'All changes saved'],
    ['offline', 'Saved on this device'],
    ['error', 'Save failed'],
  ])('shows %s save status', async (state, text) => {
    store.saveState = state
    const wrapper = await mountAt('/documents/doc-a')
    expect(wrapper.get('.save-status').text()).toContain(text)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(['saving', 'error'].includes(state))
    wrapper.unmount()
  })

  it('saves a conflicted document as a copy and navigates to it', async () => {
    store.saveState = 'error'
    store.saveConflict = true
    const copy = vi.spyOn(store, 'saveConflictAsCopy').mockResolvedValue({ id: 'copy' })
    const wrapper = await mountAt('/documents/doc-a')
    expect(wrapper.get('.save-status').text()).toContain('Changed elsewhere')
    expect(wrapper.findAll('.save-actions button')).toHaveLength(1)
    await wrapper.get('.save-actions button').trigger('click')
    await flushPromises()
    expect(copy).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.path).toBe('/documents/copy')
    wrapper.unmount()
  })

  it('reports a loading document when AI is requested before its editor is ready', async () => {
    store.isOpenDocLoading = true
    const wrapper = await mountAt('/documents/doc-a')
    await wrapper.get('[aria-label="Open document AI"]').trigger('click')
    await wrapper.get('textarea').setValue('Summarize this')
    await wrapper.get('[aria-label="Send message"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toBe('Wait for the document to finish loading.')
    expect(wrapper.get('textarea').element.value).toBe('Summarize this')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('#document-ai-panel').exists()).toBe(false)
    wrapper.unmount()
  })

  it('creates a document from a dashboard AI proposal', async () => {
    vi.spyOn(store, 'authHeaders').mockResolvedValue({})
    const create = vi.spyOn(store, 'createDocument').mockResolvedValue({ id: 'created' })
    const save = vi.spyOn(store, 'scheduleContentSave').mockImplementation(() => {})
    const proposal = { title: 'Plan', blocks: [], preview: 'An empty plan' }
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ reply: 'Here is a plan.', model: 'test-model', proposal }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = await mountAt('/documents')
    await wrapper.get('[aria-label="Open document AI"]').trigger('click')
    wrapper.get('[role=log]').element.scrollTo = vi.fn()
    await wrapper.get('textarea').setValue('Make a plan')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(fetchMock).not.toHaveBeenCalled()
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.get('.message-assistant').text()).toContain('Here is a plan.')
    expect(wrapper.get('textarea').element.value).toBe('')
    const request = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(request).toMatchObject({ instruction: 'Make a plan', document: null, history: [] })
    await wrapper.get('.message-assistant button').trigger('click')
    await flushPromises()
    expect(create).toHaveBeenCalledWith({ title: 'Plan' })
    expect(save).toHaveBeenCalledWith('created', { title: 'Plan', blocks: [] })
    expect(router.currentRoute.value.path).toBe('/documents/created')
    wrapper.unmount()
  })

  it('keeps the prompt after a failed AI request and removes the failed conversation entry', async () => {
    vi.spyOn(store, 'authHeaders').mockResolvedValue({})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection lost')))
    const wrapper = await mountAt('/documents')
    await wrapper.get('[aria-label="Open document AI"]').trigger('click')
    wrapper.get('[role=log]').element.scrollTo = vi.fn()
    await wrapper.get('textarea').setValue('Try this')
    await wrapper.get('[aria-label="Send message"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('Connection lost')
    expect(wrapper.find('.message-user').exists()).toBe(false)
    expect(wrapper.get('textarea').element.value).toBe('Try this')
    wrapper.unmount()
  })

  it('flushes pending edits on document switches after mounting on a file preview', async () => {
    const wrapper = await mountAt('/documents/file/file-1')
    await router.push('/documents/doc-a')
    await flushPromises()
    store.flushPendingSave.mockClear()

    await router.push('/documents/doc-b')
    expect(store.flushPendingSave).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('stops flushing once the view has unmounted', async () => {
    const wrapper = await mountAt('/documents/doc-a')
    wrapper.unmount()
    await flushPromises()
    store.flushPendingSave.mockClear()

    await router.push('/elsewhere')
    expect(store.flushPendingSave).not.toHaveBeenCalled()
  })
})
