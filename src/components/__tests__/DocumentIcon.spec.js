import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import DocumentIcon from '../DocumentIcon.vue'

describe('DocumentIcon', () => {
  it('renders an emoji as decorative text', () => {
    const wrapper = mount(DocumentIcon, { props: { value: '💡' } })
    expect(wrapper.text()).toBe('💡')
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('.material-symbols-outlined').exists()).toBe(false)
  })

  it('renders an ms: value as a Material Symbols glyph', () => {
    const wrapper = mount(DocumentIcon, { props: { value: 'ms:rocket_launch' } })
    expect(wrapper.get('.material-symbols-outlined').text()).toBe('rocket_launch')
    expect(wrapper.text()).not.toContain('ms:')
  })

  it('uses the fallback for empty or malformed values', () => {
    expect(mount(DocumentIcon, { props: { fallback: '📄' } }).text()).toBe('📄')
    expect(mount(DocumentIcon, { props: { value: 'ms:Bad Name', fallback: '📄' } }).text()).toBe(
      '📄',
    )
    expect(mount(DocumentIcon, { props: { value: 'ms:Bad Name' } }).text()).toBe('')
  })
})
