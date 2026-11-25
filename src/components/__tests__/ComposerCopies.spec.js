import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

import ComposerCopies from '../ComposerCopies.vue'

const CONTACTS = [
  { name: 'Dana Ortiz', address: 'dana@example.com' },
  { name: 'Dan Field', address: 'dan@example.com' },
]

describe('ComposerCopies', () => {
  let wrapper

  // The lines are a v-model pair, so the test stands in for the parent.
  function mountCopies(props = {}) {
    wrapper = mount(ComposerCopies, {
      attachTo: document.body,
      props: {
        cc: '',
        bcc: '',
        contacts: CONTACTS,
        'onUpdate:cc': (value) => wrapper.setProps({ cc: value }),
        'onUpdate:bcc': (value) => wrapper.setProps({ bcc: value }),
        ...props,
      },
    })
    return wrapper
  }

  const line = (kind) => wrapper.find(`[data-copy="${kind}"] input`)
  const addLink = (label) => wrapper.find(`[aria-label="Add ${label}"]`)

  afterEach(() => wrapper?.unmount())

  it('offers both lines while editing and neither at rest', async () => {
    mountCopies({ editing: false })
    expect(wrapper.findAll('.composer-copy-add')).toHaveLength(0)
    expect(wrapper.find('.composer-copy-row').exists()).toBe(false)

    await wrapper.setProps({ editing: true })
    expect(wrapper.findAll('.composer-copy-add').map((link) => link.text())).toEqual([
      '+ cc',
      '+ bcc',
    ])
  })

  it('adds a line, focuses it, and keeps offering the other one', async () => {
    mountCopies()
    await addLink('Cc').trigger('click')
    await nextTick()

    expect(line('cc').exists()).toBe(true)
    expect(document.activeElement).toBe(line('cc').element)
    expect(addLink('Cc').exists()).toBe(false)
    expect(addLink('Bcc').exists()).toBe(true)
  })

  it('shows a line that holds an address without being asked, and no links at rest', () => {
    mountCopies({ cc: 'dana@example.com', bcc: 'finance@example.com', editing: false })
    expect(line('cc').element.value).toBe('dana@example.com')
    expect(line('bcc').element.value).toBe('finance@example.com')
    expect(wrapper.find('.composer-copy-add').exists()).toBe(false)
    expect(wrapper.find('.composer-copy-remove').exists()).toBe(false)
  })

  it('reports what is typed and completes a picked contact', async () => {
    mountCopies()
    await addLink('Cc').trigger('click')
    await nextTick()

    await line('cc').setValue('dan')
    expect(wrapper.props('cc')).toBe('dan')
    const suggestions = wrapper.findAll('.suggestion-item')
    expect(suggestions.map((item) => item.find('.composer-suggest-address').text())).toEqual([
      'dan@example.com',
      'dana@example.com',
    ])

    await line('cc').trigger('keydown', { key: 'ArrowDown' })
    await line('cc').trigger('keydown', { key: 'Enter' })
    expect(wrapper.props('cc')).toBe('dan@example.com, ')
    expect(wrapper.find('.suggestion-item').exists()).toBe(false)
  })

  it('removes a line and what it held', async () => {
    mountCopies({ cc: 'dana@example.com', bcc: 'finance@example.com' })
    await wrapper.get('[aria-label="Remove Cc"]').trigger('click')

    expect(wrapper.props('cc')).toBe('')
    expect(line('cc').exists()).toBe(false)
    expect(line('bcc').exists()).toBe(true)
    expect(addLink('Cc').exists()).toBe(true)
  })

  it('hands the focus back when the removed line was the only one', async () => {
    mountCopies()
    await addLink('Bcc').trigger('click')
    await nextTick()
    await wrapper.get('[aria-label="Remove Bcc"]').trigger('click')

    expect(wrapper.emitted('exit')).toEqual([['back']])
  })

  it('puts away lines that were added and left empty', async () => {
    mountCopies({ cc: 'dana@example.com' })
    await addLink('Bcc').trigger('click')
    await nextTick()
    expect(line('bcc').exists()).toBe(true)

    wrapper.vm.collapse()
    await nextTick()
    expect(line('bcc').exists()).toBe(false)
    expect(line('cc').exists()).toBe(true)
  })

  it('leaves forwards on Tab from the last line only', async () => {
    mountCopies({ cc: 'dana@example.com', bcc: 'finance@example.com' })
    await line('cc').trigger('keydown', { key: 'Tab' })
    expect(wrapper.emitted('exit')).toBeUndefined()

    await line('bcc').trigger('keydown', { key: 'Tab' })
    expect(wrapper.emitted('exit')).toEqual([['forward']])
  })

  it('focuses its first and last lines for the parent, or reports there are none', async () => {
    mountCopies()
    expect(wrapper.vm.focusFirst()).toBe(false)

    await wrapper.setProps({ cc: 'dana@example.com', bcc: 'finance@example.com' })
    expect(wrapper.vm.focusFirst()).toBe(true)
    expect(document.activeElement).toBe(line('cc').element)
    expect(wrapper.vm.focusLast()).toBe(true)
    expect(document.activeElement).toBe(line('bcc').element)
  })
})
