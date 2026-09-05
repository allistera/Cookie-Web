import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import NewDocumentDialog from '../NewDocumentDialog.vue'
import { useDocumentsStore } from '../../stores/documents'
import { useInboxStore } from '../../stores/inbox'
import { AI_API_URL } from '../../lib/apiWorkers'

const GENERATED = {
  title: 'Kitchen plan',
  blocks: [{ type: 'header', data: { text: 'Steps', level: 2 } }],
}

let router
let push
let store
let fetchMock

function mountDialog() {
  return mount(NewDocumentDialog, { attachTo: document.body, global: { plugins: [router] } })
}

beforeEach(async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/documents/:id?', name: 'documents', component: { template: '<div />' } },
      { path: '/settings/:section?', name: 'settings', component: { template: '<div />' } },
    ],
  })
  await router.push({ name: 'documents' })
  await router.isReady()
  push = vi.spyOn(router, 'push').mockResolvedValue()
  setActivePinia(createPinia())
  store = useDocumentsStore()
  store.newDocumentDialogOpen = true
  store.newDocumentFolderId = 'f-1'
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
  fetchMock = vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET'
    if (String(url).startsWith(AI_API_URL)) {
      return { ok: true, json: async () => ({ document: GENERATED }) }
    }
    if (method === 'GET') return { ok: true, json: async () => ({ templates: [] }) }
    if (method === 'POST') {
      const body = JSON.parse(options.body)
      return {
        ok: true,
        json: async () => ({
          document: { id: 'd-ai', folder_id: body.folderId, title: body.title, starred: false },
        }),
      }
    }
    return { ok: true, json: async () => ({ document: { id: 'd-ai', updated_at: 't1' } }) }
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('NewDocumentDialog AI document', () => {
  it('lists the AI option under Blank document and swaps it for a prompt when chosen', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    const options = wrapper.findAll('.new-document-option').map((node) => node.text())
    expect(options[0]).toContain('Blank document')
    expect(options[1]).toContain('AI document')
    expect(wrapper.find('.new-document-ai-prompt').exists()).toBe(false)

    await wrapper.get('.new-document-ai-option').trigger('click')

    expect(wrapper.find('.new-document-ai-option').exists()).toBe(false)
    const input = wrapper.get('.new-document-ai-input')
    expect(document.activeElement).toBe(input.element)

    await input.trigger('keydown', { key: 'Escape' })

    expect(wrapper.find('.new-document-ai-prompt').exists()).toBe(false)
    expect(wrapper.find('.new-document-ai-option').exists()).toBe(true)
    expect(store.newDocumentDialogOpen).toBe(true)
    wrapper.unmount()
  })

  it('generates, creates and opens the document when Enter is pressed', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await wrapper.get('.new-document-ai-option').trigger('click')
    const input = wrapper.get('.new-document-ai-input')

    await input.setValue('Plan a kitchen renovation')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    const [aiUrl, aiOptions] = fetchMock.mock.calls.find(([url]) =>
      String(url).startsWith(AI_API_URL),
    )
    expect(aiUrl).toBe(`${AI_API_URL}/document`)
    expect(JSON.parse(aiOptions.body)).toEqual({ instruction: 'Plan a kitchen renovation' })
    const create = fetchMock.mock.calls.find(
      ([, options]) => options?.method === 'POST' && !String(options.body).includes('instruction'),
    )
    expect(JSON.parse(create[1].body)).toMatchObject({
      kind: 'document',
      folderId: 'f-1',
      title: 'Kitchen plan',
    })
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH')
    expect(JSON.parse(patch[1].body)).toEqual({ id: 'd-ai', blocks: GENERATED.blocks })
    expect(store.documents[0].id).toBe('d-ai')
    expect(store.newDocumentDialogOpen).toBe(false)
    expect(push).toHaveBeenCalledWith('/documents/d-ai')
    wrapper.unmount()
  })

  it('ignores Enter on an empty prompt', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await wrapper.get('.new-document-ai-option').trigger('click')

    await wrapper.get('.new-document-ai-input').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith(AI_API_URL))).toBe(false)
    expect(store.newDocumentDialogOpen).toBe(true)
    wrapper.unmount()
  })
})
