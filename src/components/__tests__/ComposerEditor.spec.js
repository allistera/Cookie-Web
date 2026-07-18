import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import ComposerEditor from '../ComposerEditor.vue'

function setCaret(node, offset) {
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
}

describe('ComposerEditor snippets', () => {
  it('shows and inserts a matching snippet in place of its slash trigger', async () => {
    const wrapper = mount(ComposerEditor, {
      attachTo: document.body,
      props: { snippets: [{ id: 'hello', name: 'hello-world', html: '<p>Hello <strong>world</strong></p>' }] },
    })
    const editor = wrapper.find('.composer-editor')
    editor.element.textContent = '/hello-world'
    editor.element.focus()
    setCaret(editor.element.firstChild, '/hello-world'.length)

    await editor.trigger('input')
    expect(wrapper.find('.composer-slash-menu').text()).toContain('hello-world')
    await editor.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('update:modelValue').at(-1)[0]).toContain('<p>Hello <strong>world</strong></p>')
    expect(editor.html()).not.toContain('/hello-world')
  })

  it('replaces a trigger split across formatted text nodes', async () => {
    const wrapper = mount(ComposerEditor, {
      attachTo: document.body,
      props: { snippets: [{ id: 'hello', name: 'hello-world', html: '<p>Hello world</p>' }] },
    })
    const editor = wrapper.find('.composer-editor')
    editor.element.innerHTML = '<strong>/hello</strong>-world'
    editor.element.focus()
    setCaret(editor.element.lastChild, '-world'.length)

    await editor.trigger('input')
    await editor.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('update:modelValue').at(-1)[0]).toContain('<p>Hello world</p>')
    expect(editor.html()).not.toContain('/hello-world')
  })

  it('recognizes a trigger immediately after regular text', async () => {
    const wrapper = mount(ComposerEditor, {
      attachTo: document.body,
      props: { snippets: [{ id: 'hello', name: 'hello-world', html: '<p>Hello world</p>' }] },
    })
    const editor = wrapper.find('.composer-editor')
    editor.element.textContent = 'Thanks,/hello-world'
    editor.element.focus()
    setCaret(editor.element.firstChild, 'Thanks,/hello-world'.length)

    await editor.trigger('input')

    expect(wrapper.find('.composer-slash-menu').text()).toContain('hello-world')
    await editor.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue').at(-1)[0]).toContain('Thanks,<p>Hello world</p>')
  })
})
