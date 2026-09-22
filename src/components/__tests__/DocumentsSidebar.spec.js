import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import DocumentsSidebar from '../DocumentsSidebar.vue'
import { useDocumentsStore } from '../../stores/documents'
import { useInboxStore } from '../../stores/inbox'

let router
let push

const FOLDERS = [
  { id: 'f-projects', parent_id: null, title: 'Projects', emoji: '📁' },
  { id: 'f-kitchen', parent_id: 'f-projects', title: 'Kitchen', emoji: '📁' },
]
const DOCS = [
  {
    id: 'd-plan',
    folder_id: 'f-kitchen',
    title: 'Plan',
    emoji: '💡',
    starred: true,
    tags: ['home', 'project'],
    updated_at: 't0',
  },
  {
    id: 'd-scratch',
    folder_id: null,
    title: 'Scratch',
    emoji: '🔹',
    starred: false,
    tags: ['home'],
    updated_at: 't0',
  },
]

function mountSidebar() {
  return mount(DocumentsSidebar, { global: { plugins: [router] } })
}

beforeEach(async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/documents/:id?', name: 'documents', component: { template: '<div />' } }],
  })
  await router.push({ name: 'documents' })
  await router.isReady()
  push = vi.spyOn(router, 'push').mockResolvedValue()
  setActivePinia(createPinia())
  const store = useDocumentsStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
  vi.stubGlobal('confirm', vi.fn())
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options = {}) => {
      const method = options.method || 'GET'
      if (method === 'GET') {
        if (String(url).includes('templates')) {
          return { ok: true, json: async () => ({ templates: [] }) }
        }
        if (String(url).includes('daily-note-seed')) {
          return { ok: true, json: async () => ({ blocks: [] }) }
        }
        return {
          ok: true,
          json: async () => ({
            folders: structuredClone(FOLDERS),
            documents: structuredClone(DOCS),
          }),
        }
      }
      if (method === 'POST') {
        const body = JSON.parse(options.body)
        if (body.kind === 'folder') {
          return {
            ok: true,
            json: async () => ({
              folder: { id: 'f-new', parent_id: body.parentId, title: body.title, emoji: '📁' },
            }),
          }
        }
        return {
          ok: true,
          json: async () => ({
            document: {
              id: 'd-new',
              folder_id: body.folderId,
              title: '',
              emoji: '🔹',
              starred: false,
              updated_at: 't1',
            },
          }),
        }
      }
      return { ok: true, json: async () => ({ ok: true }) }
    }),
  )
})

describe('DocumentsSidebar', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders root folders closed by default, with starred docs and tags visible', async () => {
    const wrapper = mountSidebar()
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('Starred')
    expect(text).toContain('Projects')
    expect(text).toContain('Scratch')
    expect(text).toContain('Tags')
    expect(wrapper.findAll('.document-tag-item').map((node) => node.text())).toEqual([
      '#home2',
      '#project1',
    ])

    // Kitchen and Plan are nested under the (closed) Projects root folder.
    // Plan still appears once, in the separate Starred section above.
    const treeText = wrapper.find('.documents-tree').text()
    expect(treeText).not.toContain('Kitchen')
    expect(treeText).not.toContain('Plan')
  })

  it('expanding a folder reveals nested docs, collapsing hides them again', async () => {
    const wrapper = mountSidebar()
    await flushPromises()

    const projects = wrapper
      .findAll('.folder-item')
      .find((node) => node.text().includes('Projects'))
    await projects.trigger('click')

    expect(wrapper.find('.documents-tree').text()).toContain('Kitchen')

    // Kitchen is nested one level under Projects.
    const kitchen = wrapper.findAll('.folder-item').find((node) => node.text().includes('Kitchen'))
    expect(kitchen.attributes('style')).toContain('padding-left: 24px')

    await kitchen.trigger('click')
    expect(wrapper.find('.documents-tree').text()).toContain('Plan')

    await projects.trigger('click')
    expect(wrapper.find('.documents-tree').text()).not.toContain('Kitchen')
  })

  it('persists expanded folders to localStorage and restores them on remount', async () => {
    const wrapper = mountSidebar()
    await flushPromises()

    const projects = wrapper
      .findAll('.folder-item')
      .find((node) => node.text().includes('Projects'))
    await projects.trigger('click')

    expect(JSON.parse(localStorage.getItem('cookie-documents-expanded-folders'))).toEqual([
      'f-projects',
    ])

    const remounted = mountSidebar()
    await flushPromises()

    expect(remounted.find('.documents-tree').text()).toContain('Kitchen')
  })

  it('opens the folder shown in the browser and its ancestors on mount', async () => {
    await router.replace({ path: '/documents', query: { folder: 'f-kitchen' } })
    const wrapper = mountSidebar()
    await flushPromises()

    const treeText = wrapper.find('.documents-tree').text()
    expect(treeText).toContain('Kitchen')
    expect(treeText).toContain('Plan')
    expect(JSON.parse(localStorage.getItem('cookie-documents-expanded-folders'))).toEqual([
      'f-projects',
      'f-kitchen',
    ])
  })

  it('follows the browser into a folder, then into a document, without collapsing anything', async () => {
    const wrapper = mountSidebar()
    await flushPromises()
    expect(wrapper.find('.documents-tree').text()).not.toContain('Kitchen')

    await router.replace({ path: '/documents', query: { folder: 'f-projects' } })
    await flushPromises()
    expect(wrapper.find('.documents-tree').text()).toContain('Kitchen')
    expect(wrapper.find('.documents-tree').text()).not.toContain('Plan')

    // Opening a document reveals the folder chain that contains it.
    await router.replace('/documents/d-plan')
    await flushPromises()
    expect(wrapper.find('.documents-tree').text()).toContain('Plan')

    // Going back up to the root leaves the tree as it was.
    await router.replace({ path: '/documents' })
    await flushPromises()
    expect(wrapper.find('.documents-tree').text()).toContain('Plan')
  })

  it('drops a document onto the tree, the label or a root row to move it to the root', async () => {
    const wrapper = mountSidebar()
    await flushPromises()
    const store = useDocumentsStore()
    const move = vi.spyOn(store, 'moveDocument').mockResolvedValue()
    const dataTransfer = { effectAllowed: null, dropEffect: null, setData: vi.fn() }
    // Starred lists Plan too, but only tree rows are draggable.
    const rowFor = (title) =>
      wrapper
        .find('.documents-tree')
        .findAll('.doc-item')
        .find((node) => node.text().includes(title))

    // Reveal Plan, which lives in Projects/Kitchen.
    await wrapper
      .findAll('.folder-item')
      .find((node) => node.text().includes('Projects'))
      .trigger('click')
    await wrapper
      .findAll('.folder-item')
      .find((node) => node.text().includes('Kitchen'))
      .trigger('click')

    await rowFor('Plan').trigger('dragstart', { dataTransfer })
    const tree = wrapper.find('.documents-tree')
    await tree.trigger('dragover', { dataTransfer })
    expect(tree.classes()).toContain('drop-target')
    expect(wrapper.find('.documents-root-label').classes()).toContain('drop-target')
    await tree.trigger('drop')
    expect(move).toHaveBeenCalledWith('d-plan', null)

    // A root-level document row is part of the root zone too.
    await rowFor('Plan').trigger('dragstart', { dataTransfer })
    await rowFor('Scratch').trigger('dragover', { dataTransfer })
    expect(tree.classes()).toContain('drop-target')
    await rowFor('Scratch').trigger('drop')
    expect(move).toHaveBeenLastCalledWith('d-plan', null)

    // A document row inside a folder targets that folder instead.
    await rowFor('Scratch').trigger('dragstart', { dataTransfer })
    await rowFor('Plan').trigger('dragover', { dataTransfer })
    expect(tree.classes()).not.toContain('drop-target')
    const kitchen = wrapper.findAll('.folder-item').find((node) => node.text().includes('Kitchen'))
    expect(kitchen.classes()).toContain('drop-target')
    await rowFor('Plan').trigger('drop')
    expect(move).toHaveBeenLastCalledWith('d-scratch', 'f-kitchen')

    // Dropping where the document already lives is a no-op.
    move.mockClear()
    await rowFor('Scratch').trigger('dragstart', { dataTransfer })
    await tree.trigger('dragover', { dataTransfer })
    await tree.trigger('drop')
    expect(move).not.toHaveBeenCalled()
    expect(tree.classes()).not.toContain('drop-target')
  })

  it('opens the new document picker', async () => {
    const wrapper = mountSidebar()
    await flushPromises()

    await wrapper.find('.compose-btn').trigger('click')
    await flushPromises()

    expect(useDocumentsStore().newDocumentDialogOpen).toBe(true)
    expect(push).not.toHaveBeenCalled()
  })

  it('shows Time Management above Documents and opens today’s note on click', async () => {
    const wrapper = mountSidebar()
    await flushPromises()

    expect(wrapper.text().indexOf('Time Management')).toBeLessThan(
      wrapper.text().indexOf('Documents'),
    )

    await wrapper.find('.time-management-nav .nav-item').trigger('click')
    await flushPromises()

    expect(push).toHaveBeenCalledWith('/documents/d-new')
  })

  it('creates a root folder through the inline input', async () => {
    const wrapper = mountSidebar()
    await flushPromises()

    expect(wrapper.find('.documents-root-label .new-folder-btn').exists()).toBe(true)
    expect(wrapper.find('.documents-tree > .new-folder-btn').exists()).toBe(false)

    await wrapper.find('.new-folder-btn').trigger('click')
    const input = wrapper.find('.new-folder-row input')
    await input.setValue('Reading list')
    // jsdom does not synthesize a submit from Enter; fire it directly.
    await wrapper.find('.new-folder-row').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Reading list')
  })

  it('requires confirmation before deleting a document', async () => {
    const wrapper = mountSidebar()
    await flushPromises()
    const store = useDocumentsStore()
    const deleteDocument = vi.spyOn(store, 'deleteDocument').mockResolvedValue(true)
    const deleteButton = wrapper.get('[aria-label="Delete Scratch"]')

    confirm.mockReturnValueOnce(false)
    await deleteButton.trigger('click')
    expect(confirm).toHaveBeenCalledWith(
      'Delete document "Scratch"?\n\nThis action cannot be undone.',
    )
    expect(deleteDocument).not.toHaveBeenCalled()

    confirm.mockReturnValueOnce(true)
    await deleteButton.trigger('click')
    expect(deleteDocument).toHaveBeenCalledWith('d-scratch')
  })

  it('explains the consequences and requires confirmation before deleting a folder', async () => {
    const wrapper = mountSidebar()
    await flushPromises()
    const store = useDocumentsStore()
    const deleteFolder = vi.spyOn(store, 'deleteFolder').mockResolvedValue()
    const deleteButton = wrapper.get('[aria-label="Delete Projects"]')

    confirm.mockReturnValueOnce(false)
    await deleteButton.trigger('click')
    expect(confirm).toHaveBeenCalledWith(
      'Delete folder "Projects" and its subfolders?\n\nDocuments inside will be moved to Documents. This action cannot be undone.',
    )
    expect(deleteFolder).not.toHaveBeenCalled()

    confirm.mockReturnValueOnce(true)
    await deleteButton.trigger('click')
    expect(deleteFolder).toHaveBeenCalledWith('f-projects')
  })

  it('navigates the browser to a folder when its row is clicked', async () => {
    const wrapper = mountSidebar()
    await flushPromises()
    await wrapper.find('.folder-item').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/documents', query: { folder: 'f-projects' } })
  })

  it('accepts a file dragged from the browser onto a folder row', async () => {
    const wrapper = mountSidebar()
    await flushPromises()
    const store = useDocumentsStore()
    const moveFile = vi.spyOn(store, 'moveFile').mockResolvedValue()
    await wrapper.find('.folder-item').trigger('drop', {
      dataTransfer: { types: ['text/plain'], getData: () => 'file:x-1' },
    })
    expect(moveFile).toHaveBeenCalledWith('x-1', 'f-projects')
  })
})
