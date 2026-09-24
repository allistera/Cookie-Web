import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('inserts an older snippet with unrelated braces without opening a preview', async () => {
    const wrapper = mount(ComposerEditor, {
      attachTo: document.body,
      props: { snippets: [{ id: 'old', name: 'old', html: '<p>Use {date} and {{other}}</p>' }] },
    })
    const editor = wrapper.find('.composer-editor')
    editor.element.textContent = '/old'
    editor.element.focus()
    setCaret(editor.element.firstChild, '/old'.length)

    await editor.trigger('input')
    await editor.trigger('keydown', { key: 'Enter' })

    expect(editor.html()).toContain('<p>Use {date} and {{other}}</p>')
    expect(document.querySelector('.snippet-preview-dialog')).toBeNull()
    wrapper.unmount()
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

  it('previews recipient variables, fills a missing field, and restores the insertion caret', async () => {
    const wrapper = mount(ComposerEditor, {
      attachTo: document.body,
      props: {
        recipientValues: { 'recipient.first_name': 'Ada' },
        snippets: [
          {
            id: 'intro',
            name: 'intro',
            html: '<p>Hi {{recipient.first_name}}, {{fill:topic}}</p>',
          },
        ],
      },
    })
    const editor = wrapper.find('.composer-editor')
    editor.element.textContent = 'Before /intro after'
    editor.element.focus()
    setCaret(editor.element.firstChild, 'Before /intro'.length)

    await editor.trigger('input')
    await editor.trigger('keydown', { key: 'Enter' })

    const dialog = document.querySelector('.snippet-preview-dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Preview /intro')
    expect(dialog.querySelector('h3').textContent).toBe('Preview /intro')
    expect(dialog.textContent).toContain('Hi Ada, {{fill:topic}}')
    expect(dialog.textContent).toContain('Missing: topic')
    expect(editor.text()).toContain('/intro')

    const inputs = dialog.querySelectorAll('input')
    expect(inputs[0].value).toBe('Ada')
    inputs[1].value = 'release <plan>'
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(dialog.textContent).not.toContain('Missing: topic')
    dialog.querySelector('button[type="submit"]').click()
    await wrapper.vm.$nextTick()

    expect(editor.html()).toContain('Before <p>Hi Ada, release &lt;plan&gt;</p> after')
    wrapper.vm.insertText('!')
    expect(editor.html()).toContain('</p>! after')
    wrapper.unmount()
  })

  it('appends reviewed availability as editable escaped text and updates both models', () => {
    const wrapper = mount(ComposerEditor, { props: { modelValue: '<p>Existing draft</p>' } })
    wrapper.vm.insertAvailability(
      'Proposed times (30 minutes; UTC)\n\n<reviewed text>\nNot reserved.',
    )
    expect(wrapper.get('.composer-editor').html()).toContain('Existing draft')
    expect(wrapper.get('.composer-editor').html()).toContain(
      '&lt;reviewed text&gt;<br>Not reserved.',
    )
    expect(wrapper.emitted('update:modelValue').at(-1)[0]).toContain('Proposed times')
    expect(wrapper.emitted('update:text').at(-1)[0]).toContain('Not reserved.')
    expect(wrapper.get('.composer-editor').attributes('contenteditable')).toBe('true')
    wrapper.unmount()
  })

  it('contains keyboard focus and restores the slash caret when preview is escaped or cancelled', async () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const wrapper = mount(ComposerEditor, {
      attachTo: document.body,
      props: {
        snippets: [{ id: 'intro', name: 'intro', html: '<p>Hi {{fill:topic}}</p>' }],
      },
    })
    const editor = wrapper.find('.composer-editor')

    async function openPreview() {
      editor.element.textContent = 'Before /intro after'
      editor.element.focus()
      setCaret(editor.element.firstChild, 'Before /intro'.length)
      await editor.trigger('input')
      await editor.trigger('keydown', { key: 'Enter' })
      return document.querySelector('.snippet-preview-dialog')
    }

    let dialog = await openPreview()
    const input = dialog.querySelector('input')
    const insert = dialog.querySelector('button[type="submit"]')
    expect(document.activeElement).toBe(input)
    expect(outside.hasAttribute('inert')).toBe(true)
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    )
    expect(document.activeElement).toBe(insert)
    insert.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    )
    expect(document.activeElement).toBe(input)
    outside.focus()
    expect(document.activeElement).toBe(input)

    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.snippet-preview-dialog')).toBeNull()
    expect(outside.hasAttribute('inert')).toBe(false)
    expect(editor.text()).toContain('/intro')
    wrapper.vm.insertText('!')
    expect(editor.text()).toContain('Before /intro! after')

    dialog = await openPreview()
    dialog.querySelector('button[type="button"]').click()
    await wrapper.vm.$nextTick()
    expect(editor.text()).toContain('/intro')
    expect(wrapper.emitted('previewState')).toEqual([[true], [false], [true], [false]])
    wrapper.unmount()
    outside.remove()
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

    paste(editor, { text: 'a <b> 😊\nc ❤️ 👍 🎉' })
    await wrapper.vm.$nextTick()

    const html = wrapper.emitted('update:modelValue').at(-1)[0]
    expect(html).toContain('a &lt;b&gt; :)<br>c &lt;3 +1 \\o/')
  })

  it('converts typed emoji in text nodes without flattening rich formatting', async () => {
    const wrapper = mount(ComposerEditor, { attachTo: document.body })
    const editor = wrapper.find('.composer-editor')
    editor.element.innerHTML = '<p>Hello <strong>😊</strong> 😢 😂 😮 🛸</p>'
    editor.element.focus()
    setCaret(editor.element.querySelector('p').lastChild, ' 😢 😂 😮 🛸'.length)

    await editor.trigger('input')

    const html = wrapper.emitted('update:modelValue').at(-1)[0]
    expect(html).toContain('<strong>:)</strong> :( :D :O 🛸')
    expect(editor.element.querySelector('strong').textContent).toBe(':)')
    expect(window.getSelection().isCollapsed).toBe(true)
  })

  it('normalizes emoji in externally inserted drafts', async () => {
    const wrapper = mount(ComposerEditor, {
      attachTo: document.body,
      props: { modelValue: '<p>Great news 🎉 ❤️</p>' },
    })

    await wrapper.vm.$nextTick()

    expect(wrapper.find('.composer-editor').html()).toContain('Great news \\o/ &lt;3')
    expect(wrapper.emitted('update:text').at(-1)[0]).toBe('Great news \\o/ <3')
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

describe('ComposerEditor code blocks', () => {
  afterEach(() => {
    delete document.execCommand
  })

  function pressEnter(editor) {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    editor.element.dispatchEvent(event)
    return event
  }

  it('turns the current line into a code block from the slash menu', async () => {
    document.execCommand = vi.fn()
    const wrapper = mount(ComposerEditor, { attachTo: document.body })
    const editor = wrapper.find('.composer-editor')
    editor.element.textContent = '/code'
    editor.element.focus()
    setCaret(editor.element.firstChild, '/code'.length)

    await editor.trigger('input')
    expect(wrapper.find('.composer-slash-menu').text()).toContain('Code block')
    await editor.trigger('keydown', { key: 'Enter' })

    expect(document.execCommand).toHaveBeenCalledWith('formatBlock', false, '<pre>')
    expect(editor.html()).not.toContain('/code')
  })

  it('keeps the caret on its own empty line after removing the trigger', async () => {
    document.execCommand = vi.fn()
    const wrapper = mount(ComposerEditor, { attachTo: document.body })
    const editor = wrapper.find('.composer-editor')
    editor.element.innerHTML = 'Hello,<div>/code</div>'
    editor.element.focus()
    const line = editor.element.querySelector('div')
    setCaret(line.firstChild, '/code'.length)

    await editor.trigger('input')
    await editor.trigger('keydown', { key: 'Enter' })

    expect(editor.element.innerHTML).toBe('Hello,<div><br></div>')
    const { anchorNode } = window.getSelection()
    expect(anchorNode === line || line.contains(anchorNode)).toBe(true)
  })

  it('inserts a line break inside a code block on Enter', async () => {
    const wrapper = mount(ComposerEditor, { attachTo: document.body })
    const editor = wrapper.find('.composer-editor')
    editor.element.innerHTML = '<pre>ab</pre>'
    editor.element.focus()
    setCaret(editor.element.querySelector('pre').firstChild, 1)

    const event = pressEnter(editor)
    await wrapper.vm.$nextTick()

    expect(event.defaultPrevented).toBe(true)
    expect(editor.element.querySelectorAll('pre')).toHaveLength(1)
    expect(editor.element.querySelector('pre').innerHTML).toBe('a<br>b')
    const pre = editor.element.querySelector('pre')
    expect(pre.contains(window.getSelection().anchorNode)).toBe(true)
    expect(wrapper.emitted('update:modelValue').at(-1)[0]).toContain('<pre>a<br>b</pre>')
  })

  it('leaves the code block on Enter from an empty trailing line', async () => {
    const wrapper = mount(ComposerEditor, { attachTo: document.body })
    const editor = wrapper.find('.composer-editor')
    editor.element.innerHTML = '<pre>code</pre>'
    editor.element.focus()
    setCaret(editor.element.querySelector('pre').firstChild, 'code'.length)

    pressEnter(editor)
    pressEnter(editor)
    await wrapper.vm.$nextTick()

    const pre = editor.element.querySelector('pre')
    expect(pre.innerHTML).toBe('code')
    expect(pre.nextSibling).not.toBeNull()
    expect(pre.contains(window.getSelection().anchorNode)).toBe(false)
    expect(editor.element.contains(window.getSelection().anchorNode)).toBe(true)
    expect(wrapper.emitted('update:modelValue').at(-1)[0]).toMatch(/^<pre>code<\/pre><div>/)
  })

  it('does not intercept Enter outside a code block', async () => {
    const wrapper = mount(ComposerEditor, { attachTo: document.body })
    const editor = wrapper.find('.composer-editor')
    editor.element.innerHTML = '<div>plain</div>'
    editor.element.focus()
    setCaret(editor.element.querySelector('div').firstChild, 'plain'.length)

    const event = pressEnter(editor)

    expect(event.defaultPrevented).toBe(false)
  })
})
