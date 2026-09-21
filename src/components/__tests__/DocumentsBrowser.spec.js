import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import DocumentsBrowser from '../DocumentsBrowser.vue'
import { useDocumentsStore } from '../../stores/documents'
import { useInboxStore } from '../../stores/inbox'

let router
let push
let store

const FOLDERS = [
  { id: 'f-work', parent_id: null, title: 'Work', emoji: '📁' },
  { id: 'f-2026', parent_id: 'f-work', title: '2026', emoji: '📁' },
]
const DOCS = [
  {
    id: 'd-root',
    folder_id: null,
    title: 'Scratch',
    emoji: '🔹',
    starred: false,
    tags: [],
    updated_at: '2026-09-01T10:00:00Z',
  },
  {
    id: 'd-work',
    folder_id: 'f-work',
    title: 'Plan',
    emoji: '💡',
    starred: true,
    tags: [],
    updated_at: '2026-09-01T10:00:00Z',
  },
]
const FILE = {
  id: 'x-1',
  folder_id: null,
  name: 'brief.pdf',
  mime_type: 'application/pdf',
  size_bytes: 2048,
  created_at: 't0',
  updated_at: 't0',
}

function mountBrowser(folderId = null) {
  return mount(DocumentsBrowser, { props: { folderId }, global: { plugins: [router] } })
}

beforeEach(async () => {
  localStorage.clear()
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/documents/file/:fileId',
        name: 'document-file',
        component: { template: '<div />' },
      },
      { path: '/documents/:id?', name: 'documents', component: { template: '<div />' } },
    ],
  })
  await router.push('/documents')
  await router.isReady()
  push = vi.spyOn(router, 'push').mockResolvedValue()
  setActivePinia(createPinia())
  store = useDocumentsStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
  store.folders = FOLDERS
  store.documents = DOCS
  store.isLoaded = true
  vi.spyOn(store, 'loadDocumentPage').mockResolvedValue()
  vi.spyOn(store, 'loadFiles').mockImplementation(async (folderId) => {
    const key = folderId ?? 'root'
    if (key === 'root') store.files[FILE.id] = FILE
    store.filePages[key] = {
      ids: key === 'root' ? [FILE.id] : [],
      loaded: true,
      loading: false,
      error: null,
    }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('DocumentsBrowser', () => {
  it('shows the root as folder cards first, then documents and files, in a grid by default', async () => {
    const wrapper = mountBrowser(null)
    await flushPromises()
    const items = wrapper.findAll('.browser-item')
    expect(items.map((item) => item.attributes('data-kind'))).toEqual([
      'folder',
      'file',
      'document',
    ])
    expect(items[0].text()).toContain('Work')
    expect(items[1].text()).toContain('brief.pdf')
    expect(items[1].text()).toContain('PDF')
    expect(wrapper.find('.documents-browser').classes()).toContain('layout-grid')
    expect(store.loadFiles).toHaveBeenCalledWith(null, { force: false })
  })

  it('switches to the list layout and remembers it', async () => {
    const wrapper = mountBrowser(null)
    await flushPromises()
    await wrapper.find('[aria-label="List view"]').trigger('click')
    expect(wrapper.find('.documents-browser').classes()).toContain('layout-list')
    expect(localStorage.getItem('cookie-documents-layout')).toBe('list')
    expect(wrapper.find('.browser-item[data-kind="file"]').text()).toContain('2.0 KB')
  })

  it('renders the breadcrumb and navigates on folder open', async () => {
    const wrapper = mountBrowser('f-2026')
    await flushPromises()
    const crumb = wrapper.find('.browser-breadcrumb')
    expect(crumb.text()).toContain('Documents')
    expect(crumb.text()).toContain('Work')
    expect(crumb.text()).toContain('2026')
    await wrapper.findAll('.browser-breadcrumb a')[1].trigger('click')
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/documents', query: { folder: 'f-work' } }),
    )

    const root = mountBrowser(null)
    await flushPromises()
    await root.find('.browser-item[data-kind="folder"]').trigger('dblclick')
    expect(push).toHaveBeenCalledWith({ path: '/documents', query: { folder: 'f-work' } })
  })

  it('opens a document and previews a PDF', async () => {
    const wrapper = mountBrowser(null)
    await flushPromises()
    await wrapper.find('.browser-item[data-kind="document"]').trigger('dblclick')
    expect(push).toHaveBeenCalledWith('/documents/d-root')
    await wrapper.find('.browser-item[data-kind="file"]').trigger('dblclick')
    expect(push).toHaveBeenCalledWith('/documents/file/x-1')
  })

  it('downloads a non-previewable file instead of opening it', async () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:x'),
      revokeObjectURL: vi.fn(),
    })
    const fetchBlob = vi.spyOn(store, 'fetchFileBlob').mockResolvedValue(new Blob(['x']))
    const wrapper = mountBrowser(null)
    await flushPromises()
    store.files[FILE.id] = { ...FILE, mime_type: 'application/zip', name: 'a.zip' }
    await flushPromises()
    await wrapper.find('.browser-item[data-kind="file"]').trigger('dblclick')
    await flushPromises()
    expect(fetchBlob).toHaveBeenCalledWith('x-1')
    expect(push).not.toHaveBeenCalledWith('/documents/file/x-1')
  })

  it('uploads dropped files into the current folder', async () => {
    const upload = vi.spyOn(store, 'uploadFiles').mockResolvedValue()
    const wrapper = mountBrowser('f-work')
    await flushPromises()
    const file = new File(['x'], 'a.txt')
    await wrapper.find('.documents-browser').trigger('drop', {
      dataTransfer: { files: [file], types: ['Files'], getData: () => '' },
    })
    expect(upload).toHaveBeenCalledWith([file], 'f-work')
  })

  it('shows upload placeholders with their error', async () => {
    store.uploads = [
      {
        id: 'u-1',
        name: 'big.bin',
        folder_id: null,
        size_bytes: 1,
        status: 'error',
        error: 'File is larger than 25 MB.',
      },
    ]
    const wrapper = mountBrowser(null)
    await flushPromises()
    const placeholder = wrapper.find('.browser-item[data-kind="upload"]')
    expect(placeholder.text()).toContain('File is larger than 25 MB.')
    await placeholder.find('button').trigger('click')
    expect(store.uploads).toEqual([])
  })

  it('renames a file from the kebab menu', async () => {
    const rename = vi.spyOn(store, 'renameFile').mockResolvedValue()
    const wrapper = mountBrowser(null)
    await flushPromises()
    await wrapper.find('[aria-label="Actions for brief.pdf"]').trigger('click')
    await wrapper.find('.browser-menu button[data-action="rename"]').trigger('click')
    const input = wrapper.find('.browser-item[data-kind="file"] input')
    await input.setValue('brief-v2.pdf')
    await input.trigger('keydown.enter')
    expect(rename).toHaveBeenCalledWith('x-1', 'brief-v2.pdf')
  })

  it('deletes a document only after confirmation', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    const del = vi.spyOn(store, 'deleteDocument').mockResolvedValue()
    const wrapper = mountBrowser(null)
    await flushPromises()
    await wrapper.find('[aria-label="Actions for Scratch"]').trigger('click')
    await wrapper.find('.browser-menu button[data-action="delete"]').trigger('click')
    expect(del).not.toHaveBeenCalled()
  })

  it('moves a dragged document onto a folder card', async () => {
    const move = vi.spyOn(store, 'moveDocument').mockResolvedValue()
    const wrapper = mountBrowser(null)
    await flushPromises()
    const folderCard = wrapper.find('.browser-item[data-kind="folder"]')
    await folderCard.trigger('drop', {
      dataTransfer: { files: [], types: ['text/plain'], getData: () => 'document:d-root' },
    })
    expect(move).toHaveBeenCalledWith('d-root', 'f-work')
  })
})
