import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'

import DocumentsView from '../DocumentsView.vue'
import { useDocumentsStore } from '../../stores/documents'

let router
let store

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
