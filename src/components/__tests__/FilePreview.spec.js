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

  it('ignores a stale load that finishes after the file changed', async () => {
    const pending = {}
    vi.spyOn(store, 'loadFile').mockImplementation(async (id) => ({
      id,
      name: `${id}.png`,
      mime_type: 'image/png',
    }))
    vi.spyOn(store, 'fetchFileBlob').mockImplementation(
      (id) => new Promise((resolve) => (pending[id] = resolve)),
    )
    URL.createObjectURL.mockImplementation((blob) => `blob:${blob.size}`)
    const wrapper = mount(FilePreview, { props: { fileId: 'old' }, global: { plugins: [router] } })
    await flushPromises()
    await wrapper.setProps({ fileId: 'new' })
    await flushPromises()

    pending.new(new Blob(['new!']))
    await flushPromises()
    pending.old(new Blob(['o']))
    await flushPromises()

    expect(wrapper.find('h1').text()).toBe('new.png')
    expect(wrapper.find('img').attributes('src')).toBe('blob:4')
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.spinner').exists()).toBe(false)
  })

  it('does not download a file whose load finishes after unmount', async () => {
    let finish
    vi.spyOn(store, 'loadFile').mockResolvedValue({
      id: 'x-4',
      name: 'a.zip',
      mime_type: 'application/zip',
    })
    vi.spyOn(store, 'fetchFileBlob').mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    )
    const wrapper = mount(FilePreview, { props: { fileId: 'x-4' }, global: { plugins: [router] } })
    await flushPromises()
    wrapper.unmount()
    finish(new Blob(['x']))
    await flushPromises()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})
