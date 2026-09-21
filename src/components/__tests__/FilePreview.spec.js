import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import FilePreview from '../FilePreview.vue'
import { useDocumentsStore } from '../../stores/documents'

let router
let store
const revoke = vi.fn()

beforeEach(async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/documents/:id?', name: 'documents', component: { template: '<div />' } }],
  })
  await router.push('/documents')
  await router.isReady()
  setActivePinia(createPinia())
  store = useDocumentsStore()
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:preview'),
    revokeObjectURL: revoke,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('FilePreview', () => {
  it('renders a PDF in an iframe and revokes the object URL on unmount', async () => {
    vi.spyOn(store, 'loadFile').mockResolvedValue({
      id: 'x-1',
      name: 'brief.pdf',
      mime_type: 'application/pdf',
    })
    vi.spyOn(store, 'fetchFileBlob').mockResolvedValue(new Blob(['x'], { type: 'application/pdf' }))
    const wrapper = mount(FilePreview, { props: { fileId: 'x-1' }, global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('h1').text()).toBe('brief.pdf')
    expect(wrapper.find('iframe').attributes('src')).toBe('blob:preview')
    wrapper.unmount()
    expect(revoke).toHaveBeenCalledWith('blob:preview')
  })

  it('renders an image in an img', async () => {
    vi.spyOn(store, 'loadFile').mockResolvedValue({
      id: 'x-2',
      name: 'a.png',
      mime_type: 'image/png',
    })
    vi.spyOn(store, 'fetchFileBlob').mockResolvedValue(new Blob(['x'], { type: 'image/png' }))
    const wrapper = mount(FilePreview, { props: { fileId: 'x-2' }, global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('img').attributes('src')).toBe('blob:preview')
  })

  it('shows an error when the file cannot be loaded', async () => {
    vi.spyOn(store, 'loadFile').mockRejectedValue(new Error('gone'))
    const wrapper = mount(FilePreview, { props: { fileId: 'x-3' }, global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('could not be loaded')
  })
})
