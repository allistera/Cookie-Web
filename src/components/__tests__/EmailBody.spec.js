import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

import EmailBody from '../EmailBody.vue'

const HOSTILE = `
  <h1>Title</h1>
  <p>Body <strong>text</strong></p>
  <script>window.evil = 1</script>
  <img src="x" onerror="alert(1)">
  <a href="https://example.com/p">link</a>`

describe('EmailBody', () => {
  it('renders untrusted HTML inside a no-script sandboxed iframe', () => {
    const wrapper = mount(EmailBody, { props: { html: HOSTILE, text: 'fallback', sender: 'Ada' } })

    const frame = wrapper.find('iframe')
    expect(frame.exists()).toBe(true)

    // Layer 2: sandbox must NOT grant script execution.
    const sandbox = frame.attributes('sandbox')
    expect(sandbox).toBeDefined()
    expect(sandbox).not.toContain('allow-scripts')

    // Layer 1: the srcdoc the frame renders is already sanitized.
    const srcdoc = frame.attributes('srcdoc')
    expect(srcdoc.toLowerCase()).not.toContain('<script')
    expect(srcdoc).not.toContain('window.evil')
    expect(srcdoc.toLowerCase()).not.toContain('onerror')
    // Benign content survives, and links are forced to a safe new tab.
    expect(srcdoc).toContain('<strong>text</strong>')
    expect(srcdoc).toContain('target="_blank"')
    expect(srcdoc).toContain('rel="noopener noreferrer"')
  })

  it('falls back to plain-text paragraphs when there is no HTML body', () => {
    const wrapper = mount(EmailBody, {
      props: { html: null, text: 'First para.\n\nSecond para.', sender: 'Ada' },
    })

    expect(wrapper.find('iframe').exists()).toBe(false)
    const paras = wrapper.findAll('.ni-email-body p')
    expect(paras[0].text()).toBe('First para.')
    expect(paras[1].text()).toBe('Second para.')
    expect(wrapper.find('.ni-email-signoff').text()).toContain('Ada')
  })

  it('falls back to text when the HTML sanitizes down to nothing', () => {
    const wrapper = mount(EmailBody, {
      props: { html: '<script>bad()</script>', text: 'plain', sender: 'Ada' },
    })
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.find('.ni-email-body').exists()).toBe(true)
  })

  it('shows a spinner (not text, not iframe) while an HTML body is loading', () => {
    const wrapper = mount(EmailBody, {
      props: { html: null, text: 'plain fallback', sender: 'Ada', hasHtmlBody: true, loading: true },
    })

    const spinner = wrapper.find('[role="status"]')
    expect(spinner.exists()).toBe(true)
    expect(spinner.find('.spinner').exists()).toBe(true)
    // Neither the text fallback nor the iframe render during the fetch window.
    expect(wrapper.find('.ni-email-body').exists()).toBe(false)
    expect(wrapper.find('iframe').exists()).toBe(false)
  })

  it('renders text instantly with no spinner for a text-only email, regardless of loading', () => {
    const wrapper = mount(EmailBody, {
      props: { html: null, text: 'plain body', sender: 'Ada', hasHtmlBody: false, loading: true },
    })

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.find('.ni-email-body p').text()).toBe('plain body')
  })

  it('renders the iframe once HTML is present, regardless of the loading prop', () => {
    const wrapper = mount(EmailBody, {
      props: { html: HOSTILE, text: 'fallback', sender: 'Ada', hasHtmlBody: true, loading: true },
    })

    expect(wrapper.find('iframe').exists()).toBe(true)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.find('.ni-email-body').exists()).toBe(false)
  })
})
