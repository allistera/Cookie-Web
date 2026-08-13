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
  { id: 'd-plan', folder_id: 'f-kitchen', title: 'Plan', emoji: '💡', starred: true, updated_at: 't0' },
  { id: 'd-scratch', folder_id: null, title: 'Scratch', emoji: '🔹', starred: false, updated_at: 't0' },
]

function mountSidebar() {
  return mount(DocumentsSidebar, { global: { plugins: [router] } })
}

beforeEach(async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/documents/:id?', name: 'documents', component: { template: '<div />' } },
    ],
  })
  await router.push({ name: 'documents' })
  await router.isReady()
  push = vi.spyOn(router, 'push').mockResolvedValue()
  setActivePinia(createPinia())
  const store = useDocumentsStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options = {}) => {
      const method = options.method || 'GET'
      if (method === 'GET') {
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
  it('renders the folder tree expanded with nested docs, starred first', async () => {
    const wrapper = mountSidebar()
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('Starred')
    expect(text).toContain('Projects')
    expect(text).toContain('Kitchen')
    expect(text).toContain('Plan')
    expect(text).toContain('Scratch')

    // Kitchen is nested one level under Projects; Plan one under Kitchen.
    const kitchen = wrapper.findAll('.folder-item').find((node) => node.text().includes('Kitchen'))
    expect(kitchen.attributes('style')).toContain('padding-left: 24px')
  })

  it('collapsing a folder hides its contents', async () => {
    const wrapper = mountSidebar()
    await flushPromises()

    const projects = wrapper
      .findAll('.folder-item')
      .find((node) => node.text().includes('Projects'))
    await projects.trigger('click')

    expect(wrapper.find('.documents-tree').text()).not.toContain('Kitchen')
  })

  it('creates a document and navigates to it', async () => {
    const wrapper = mountSidebar()
    await flushPromises()

    await wrapper.find('.compose-btn').trigger('click')
    await flushPromises()

    expect(push).toHaveBeenCalledWith('/documents/d-new')
  })

  it('creates a root folder through the inline input', async () => {
    const wrapper = mountSidebar()
    await flushPromises()

    await wrapper.find('.new-folder-btn').trigger('click')
    const input = wrapper.find('.new-folder-row input')
    await input.setValue('Reading list')
    // jsdom does not synthesize a submit from Enter; fire it directly.
    await wrapper.find('.new-folder-row').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Reading list')
  })
})
