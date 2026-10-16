import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TaskComments from '../TaskComments.vue'
import { useTaskCommentsStore } from '../../stores/taskComments'

const TASK = 't1'
const COMMENT = {
  id: 'c1',
  taskId: TASK,
  body: 'First thought',
  attachment: null,
  mine: true,
  editedAt: null,
  createdAt: '2026-10-15T09:00:00Z',
  updatedAt: '2026-10-15T09:00:00Z',
}
const WITH_FILE = {
  ...COMMENT,
  id: 'c2',
  body: 'See attached',
  attachment: { name: 'brief.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
}

let store

beforeEach(() => {
  setActivePinia(createPinia())
  store = useTaskCommentsStore()
  vi.spyOn(store, 'notify').mockImplementation(() => {})
})

function seed(comments = [COMMENT, WITH_FILE], extra = {}) {
  store.threads[TASK] = {
    comments,
    nextCursor: null,
    loaded: true,
    loading: false,
    error: null,
    ...extra,
  }
}

function mountThread() {
  return mount(TaskComments, { props: { taskId: TASK } })
}

describe('TaskComments', () => {
  it('refreshes the thread for its task on mount', async () => {
    const load = vi.spyOn(store, 'loadThread').mockResolvedValue()
    mountThread()
    await flushPromises()
    expect(load).toHaveBeenCalledWith(TASK, { force: true })
  })

  it('lists entries oldest first with author, time, text and attachment chip', async () => {
    vi.spyOn(store, 'loadThread').mockResolvedValue()
    seed()
    const wrapper = mountThread()
    await flushPromises()

    const rows = wrapper.findAll('.task-comment')
    expect(rows).toHaveLength(2)
    expect(rows[0].get('.task-comment-author').text()).toBe('You')
    expect(rows[0].get('.task-comment-time').text()).toMatch(/15 Oct 2026/)
    expect(rows[0].get('.task-comment-body').text()).toBe('First thought')
    expect(rows[0].find('.task-comment-file').exists()).toBe(false)
    expect(rows[1].get('.task-comment-file').text()).toContain('brief.pdf')
    expect(rows[1].get('.task-comment-file').text()).toContain('2.0 KB')
    expect(rows[0].get('.task-comment-avatar').text()).toBe('?')
  })

  it('signs own entries and the composer with the given name', async () => {
    vi.spyOn(store, 'loadThread').mockResolvedValue()
    seed([COMMENT, { ...COMMENT, id: 'c3', mine: false }])
    const wrapper = mount(TaskComments, { props: { taskId: TASK, authorName: 'Allister A.' } })
    await flushPromises()

    const rows = wrapper.findAll('.task-comment')
    expect(rows[0].get('.task-comment-author').text()).toBe('Allister A.')
    expect(rows[0].get('.task-comment-avatar').text()).toBe('A')
    expect(rows[1].get('.task-comment-author').text()).toBe('Collaborator')
    expect(rows[1].get('.task-comment-avatar').text()).toBe('C')
    expect(wrapper.get('.task-comment-composer .task-comment-avatar').text()).toBe('A')
  })

  it('inserts a chosen emoji at the caret of the draft', async () => {
    vi.spyOn(store, 'loadThread').mockResolvedValue()
    seed([])
    const wrapper = mountThread()
    await flushPromises()
    const textarea = wrapper.get('textarea[aria-label="Write a comment"]')
    await textarea.setValue('ab')
    textarea.element.setSelectionRange(1, 1)

    await wrapper.get('button[aria-label="Add emoji"]').trigger('click')
    await wrapper.get('.composer-emoji-popover .composer-emoji-item').trigger('click')
    await flushPromises()

    expect(textarea.element.value).toMatch(/^a.+b$/)
  })

  it('shows the empty state and the loading state', async () => {
    vi.spyOn(store, 'loadThread').mockResolvedValue()
    const wrapper = mountThread()
    await flushPromises()
    expect(wrapper.get('.task-comments-status').text()).toBe('Loading comments…')

    seed([])
    await flushPromises()
    expect(wrapper.get('.task-comments-status').text()).toBe('No comments yet.')
  })

  it('sends the draft and the chosen file, then clears the composer', async () => {
    vi.spyOn(store, 'loadThread').mockResolvedValue()
    seed([])
    const add = vi.spyOn(store, 'addComment').mockResolvedValue(COMMENT)
    const wrapper = mountThread()
    await flushPromises()

    const send = wrapper.get('button[type="submit"]')
    expect(send.attributes('disabled')).toBeDefined()
    await wrapper.get('textarea[aria-label="Write a comment"]').setValue('Hello')
    expect(send.attributes('disabled')).toBeUndefined()

    const file = new File(['%PDF'], 'brief.pdf', { type: 'application/pdf' })
    const input = wrapper.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    expect(wrapper.get('.task-comment-draft-file').text()).toContain('brief.pdf')

    await wrapper.get('form.task-comment-composer').trigger('submit')
    await flushPromises()

    expect(add).toHaveBeenCalledWith(TASK, { body: 'Hello', file })
    expect(wrapper.get('textarea[aria-label="Write a comment"]').element.value).toBe('')
    expect(wrapper.find('.task-comment-draft-file').exists()).toBe(false)
  })

  it('sends on Enter and keeps Shift+Enter as a newline', async () => {
    vi.spyOn(store, 'loadThread').mockResolvedValue()
    seed([])
    const add = vi.spyOn(store, 'addComment').mockResolvedValue(COMMENT)
    const wrapper = mountThread()
    await flushPromises()
    const textarea = wrapper.get('textarea[aria-label="Write a comment"]')
    await textarea.setValue('Line')

    await textarea.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(add).not.toHaveBeenCalled()
    await textarea.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('keeps the draft when the server refuses it', async () => {
    vi.spyOn(store, 'loadThread').mockResolvedValue()
    seed([])
    vi.spyOn(store, 'addComment').mockResolvedValue(null)
    const wrapper = mountThread()
    await flushPromises()
    await wrapper.get('textarea[aria-label="Write a comment"]').setValue('Keep me')
    await wrapper.get('form.task-comment-composer').trigger('submit')
    await flushPromises()
    expect(wrapper.get('textarea[aria-label="Write a comment"]').element.value).toBe('Keep me')
  })

  it('names an oversized file before sending and will not send it', async () => {
    vi.spyOn(store, 'loadThread').mockResolvedValue()
    seed([])
    const add = vi.spyOn(store, 'addComment')
    const wrapper = mountThread()
    await flushPromises()
    const input = wrapper.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', {
      value: [{ name: 'huge.bin', type: '', size: 26 * 1024 * 1024 }],
      configurable: true,
    })
    await input.trigger('change')
    expect(wrapper.get('.task-comment-problem').text()).toMatch(/25 MB/)
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.get('form.task-comment-composer').trigger('submit')
    expect(add).not.toHaveBeenCalled()
  })

  it('edits an own entry in place and saves the new text', async () => {
    vi.spyOn(store, 'loadThread').mockResolvedValue()
    seed()
    const edit = vi.spyOn(store, 'editComment').mockResolvedValue({ ...COMMENT, body: 'Second' })
    const wrapper = mountThread()
    await flushPromises()

    await wrapper.get('button[title="Edit comment"]').trigger('click')
    const textarea = wrapper.get('textarea[aria-label="Edit comment"]')
    expect(textarea.element.value).toBe('First thought')
    await textarea.setValue('Second')
    await wrapper.get('form.task-comment-edit').trigger('submit')
    await flushPromises()

    expect(edit).toHaveBeenCalledWith(TASK, 'c1', 'Second')
    expect(wrapper.find('textarea[aria-label="Edit comment"]').exists()).toBe(false)
  })

  it('leaves a newer edit open when an earlier save settles late', async () => {
    vi.spyOn(store, 'loadThread').mockResolvedValue()
    seed()
    let settle
    vi.spyOn(store, 'editComment').mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = () => resolve({ ...COMMENT, body: 'Second' })
        }),
    )
    const wrapper = mountThread()
    await flushPromises()

    const [first, second] = wrapper.findAll('button[title="Edit comment"]')
    await first.trigger('click')
    await wrapper.get('textarea[aria-label="Edit comment"]').setValue('Second')
    await wrapper.get('form.task-comment-edit').trigger('submit')
    // While the save is in flight, the other entry's edit is opened.
    await second.trigger('click')
    expect(wrapper.get('textarea[aria-label="Edit comment"]').element.value).toBe('See attached')
    settle()
    await flushPromises()

    expect(wrapper.find('textarea[aria-label="Edit comment"]').exists()).toBe(true)
    expect(wrapper.get('textarea[aria-label="Edit comment"]').element.value).toBe('See attached')
  })

  it('cancels an edit on Escape without touching the store', async () => {
    vi.spyOn(store, 'loadThread').mockResolvedValue()
    seed()
    const edit = vi.spyOn(store, 'editComment')
    const wrapper = mountThread()
    await flushPromises()

    await wrapper.get('button[title="Edit comment"]').trigger('click')
    const textarea = wrapper.get('textarea[aria-label="Edit comment"]')
    await textarea.setValue('Changed my mind')
    await textarea.trigger('keydown', { key: 'Escape' })

    expect(wrapper.find('textarea[aria-label="Edit comment"]').exists()).toBe(false)
    expect(edit).not.toHaveBeenCalled()
    expect(wrapper.findAll('.task-comment')[0].get('.task-comment-body').text()).toBe(
      'First thought',
    )
  })

  it('asks before deleting and removes through the store', async () => {
    vi.spyOn(store, 'loadThread').mockResolvedValue()
    seed()
    const remove = vi.spyOn(store, 'deleteComment').mockResolvedValue(true)
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
    const wrapper = mountThread()
    await flushPromises()

    await wrapper.findAll('button[title="Delete comment"]')[0].trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith('Delete this comment?')
    expect(remove).toHaveBeenCalledWith(TASK, 'c1')
    vi.unstubAllGlobals()
  })

  it('offers to take the attachment off an entry that keeps its text', async () => {
    vi.spyOn(store, 'loadThread').mockResolvedValue()
    seed()
    const drop = vi.spyOn(store, 'removeAttachment').mockResolvedValue(COMMENT)
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
    const wrapper = mountThread()
    await flushPromises()

    await wrapper.get('button[title="Remove attachment"]').trigger('click')
    await flushPromises()
    expect(drop).toHaveBeenCalledWith(TASK, 'c2')

    // An entry that is only its attachment has no separate remove: Delete
    // is the way to take it away.
    seed([{ ...WITH_FILE, body: '' }])
    await flushPromises()
    expect(wrapper.find('button[title="Remove attachment"]').exists()).toBe(false)
    vi.unstubAllGlobals()
  })

  it('hides edit and delete on entries that are not the caller own', async () => {
    vi.spyOn(store, 'loadThread').mockResolvedValue()
    seed([{ ...COMMENT, mine: false }])
    const wrapper = mountThread()
    await flushPromises()
    expect(wrapper.get('.task-comment-author').text()).toBe('Collaborator')
    expect(wrapper.find('button[title="Edit comment"]').exists()).toBe(false)
    expect(wrapper.find('button[title="Delete comment"]').exists()).toBe(false)
  })

  it('opens a preview in a tab claimed before the bytes arrive', async () => {
    vi.spyOn(store, 'loadThread').mockResolvedValue()
    seed([WITH_FILE])
    let settle
    vi.spyOn(store, 'fetchAttachmentBlob').mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = () => resolve(new Blob(['%PDF']))
        }),
    )
    const tab = { opener: {}, closed: false, location: { href: '' }, close: vi.fn() }
    const open = vi.fn(() => tab)
    vi.stubGlobal('open', open)
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:pdf'),
      revokeObjectURL: vi.fn(),
    })
    const wrapper = mountThread()
    await flushPromises()

    await wrapper.get('.task-comment-file').trigger('click')
    expect(open).toHaveBeenCalledWith('about:blank', '_blank')
    expect(tab.opener).toBeNull()
    expect(tab.location.href).toBe('')
    settle()
    await flushPromises()

    expect(tab.location.href).toBe('blob:pdf')
    vi.unstubAllGlobals()
  })

  it('downloads an attachment through an object URL', async () => {
    vi.spyOn(store, 'loadThread').mockResolvedValue()
    seed([{ ...WITH_FILE, attachment: { ...WITH_FILE.attachment, mimeType: 'application/zip' } }])
    vi.spyOn(store, 'fetchAttachmentBlob').mockResolvedValue(new Blob(['zip']))
    const createObjectURL = vi.fn(() => 'blob:fake')
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const wrapper = mountThread()
    await flushPromises()

    await wrapper.get('.task-comment-file').trigger('click')
    await flushPromises()

    expect(store.fetchAttachmentBlob).toHaveBeenCalledWith('c2')
    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it('offers the next page while a cursor remains', async () => {
    const load = vi.spyOn(store, 'loadThread').mockResolvedValue()
    seed([COMMENT], { nextCursor: 'cur' })
    const wrapper = mountThread()
    await flushPromises()

    await wrapper.get('.task-comments-more').trigger('click')
    expect(load).toHaveBeenLastCalledWith(TASK, { more: true })
  })
})
