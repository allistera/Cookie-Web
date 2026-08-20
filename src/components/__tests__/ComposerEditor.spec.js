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
      props: {
        snippets: [
          { id: 'hello', name: 'hello-world', html: '<p>Hello <strong>world</strong></p>' },
        ],
      },
    })
    const editor = wrapper.find('.composer-editor')
    editor.element.textContent = '/hello-world'
    editor.element.focus()
    setCaret(editor.element.firstChild, '/hello-world'.length)

    await editor.trigger('input')
    expect(wrapper.find('.composer-slash-menu').text()).toContain('hello-world')
    await editor.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('update:modelValue').at(-1)[0]).toContain(
      '<p>Hello <strong>world</strong></p>',
    )
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

describe('ComposerEditor paste and input sanitization', () => {
  function paste(editor, { html, text }) {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: (type) => {
          if (type === 'text/html') return html ?? ''
          if (type === 'text/plain') return text ?? ''
          return ''
        },
      },
    })
    editor.element.dispatchEvent(event)
  }

  it('inserts sanitized clipboard HTML on paste', async () => {
    const wrapper = mount(ComposerEditor, { attachTo: document.body })
    const editor = wrapper.find('.composer-editor')
    editor.element.focus()

    paste(editor, { html: '<p>Hi</p><script>window.evil = 1</script><img src=x onerror=alert(1)>' })
    await wrapper.vm.$nextTick()

    const html = wrapper.emitted('update:modelValue').at(-1)[0]
    expect(html).toContain('<p>Hi</p>')
    expect(html.toLowerCase()).not.toContain('<script')
    expect(html.toLowerCase()).not.toContain('onerror')
  })

  it('inserts escaped plain text with line breaks on paste', async () => {
    const wrapper = mount(ComposerEditor, { attachTo: document.body })
    const editor = wrapper.find('.composer-editor')
    editor.element.focus()

    paste(editor, { text: 'a <b>\nc' })
    await wrapper.vm.$nextTick()

    const html = wrapper.emitted('update:modelValue').at(-1)[0]
    expect(html).toContain('a &lt;b&gt;<br>c')
  })

  it('sanitizes dangerous markup on input', async () => {
    const wrapper = mount(ComposerEditor, { attachTo: document.body })
    const editor = wrapper.find('.composer-editor')
    editor.element.innerHTML = 'Hello<script>alert(1)</script>'
    await editor.trigger('input')

    const html = wrapper.emitted('update:modelValue').at(-1)[0]
    expect(html).toContain('Hello')
    expect(html.toLowerCase()).not.toContain('<script')
  })
})
