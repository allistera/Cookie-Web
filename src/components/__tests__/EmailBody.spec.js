import { afterEach, describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import EmailBody from '../EmailBody.vue'

const HOSTILE = `
  <h1>Title</h1>
  <p>Body <strong>text</strong></p>
  <script>window.evil = 1</script>
  <img src="x" onerror="alert(1)">
  <a href="https://example.com/p">link</a>`

afterEach(() => vi.useRealTimers())

describe('EmailBody', () => {
  it('renders untrusted HTML inside a no-script sandboxed iframe', () => {
    const wrapper = mount(EmailBody, { props: { html: HOSTILE, text: 'fallback', sender: 'Ada' } })

    const frame = wrapper.find('iframe')
    expect(frame.exists()).toBe(true)

    // Layer 2: the fixed bridge may execute, but the frame stays on an opaque
    // origin so even a sanitizer bypass cannot reach parent DOM or storage.
    const sandbox = frame.attributes('sandbox')
    expect(sandbox).toBeDefined()
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).not.toContain('allow-same-origin')

    // Layer 1: the srcdoc the frame renders is already sanitized. Only the one
    // nonce-restricted, app-owned bridge script survives.
    const srcdoc = frame.attributes('srcdoc')
    expect(srcdoc.match(/<script/g)).toHaveLength(1)
    expect(srcdoc).not.toContain('<script type="module"')
    expect(srcdoc).toContain('data-bridge-source="cookie-email-body"')
    expect(srcdoc).toContain("script-src 'nonce-")
    expect(srcdoc).not.toContain('window.evil')
    expect(srcdoc.toLowerCase()).not.toContain('onerror')
    // Benign content survives, and links are forced to a safe new tab.
    expect(srcdoc).toContain('<strong>text</strong>')
    expect(srcdoc).toContain('target="_blank"')
    expect(srcdoc).toContain('rel="noopener noreferrer"')
  })

  it('blocks sender-controlled remote resources while preserving embedded content', () => {
    const wrapper = mount(EmailBody, {
      props: {
        html:
          '<img src="https://tracker.example/open.gif">' +
          '<img src="data:image/png;base64,iVBORw0KGgo=">' +
          '<p style="background-image:url(https://tracker.example/style.gif)">Body</p>',
      },
    })

    const srcdoc = wrapper.find('iframe').attributes('srcdoc')
    const csp = srcdoc.match(/Content-Security-Policy" content="([^"]+)/)?.[1]
    expect(csp).toBeDefined()
    expect(csp).not.toMatch(/(?:default|style|font)-src[^;]*https?:/)
    expect(csp).toContain('img-src data: cid:')
    expect(csp).toContain("style-src 'unsafe-inline'")
  })

  it('shows a "Show images" control only when remote images were actually blocked, and unblocks them on click', async () => {
    const withRemote = mount(EmailBody, {
      props: { html: '<img src="https://tracker.example/logo.png">' },
    })
    const notice = withRemote.find('.ni-email-images-notice')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('Show images')

    let csp = withRemote
      .find('iframe')
      .attributes('srcdoc')
      .match(/Content-Security-Policy" content="([^"]+)/)?.[1]
    expect(csp).toContain('img-src data: cid:')
    expect(csp).not.toContain('https:')

    // Regression guard: the reader closes on any document click that lands
    // outside .ni-reader (TraditionalInboxView's onDocumentClick), so this
    // button must never let its click bubble past the component.
    const onDocumentClick = vi.fn()
    document.addEventListener('click', onDocumentClick)
    await notice.find('button').trigger('click')
    document.removeEventListener('click', onDocumentClick)
    expect(onDocumentClick).not.toHaveBeenCalled()

    expect(withRemote.find('.ni-email-images-notice').exists()).toBe(false)
    csp = withRemote
      .find('iframe')
      .attributes('srcdoc')
      .match(/Content-Security-Policy" content="([^"]+)/)?.[1]
    expect(csp).toContain('img-src data: cid: https: http:')

    const withoutRemote = mount(EmailBody, {
      props: { html: '<p>No images here, just <a href="https://example.com">a link</a>.</p>' },
    })
    expect(withoutRemote.find('.ni-email-images-notice').exists()).toBe(false)

    const embeddedOnly = mount(EmailBody, {
      props: { html: '<img src="data:image/png;base64,iVBORw0KGgo=">' },
    })
    expect(embeddedOnly.find('.ni-email-images-notice').exists()).toBe(false)
  })

  it('forwards key presses from the iframe document to the reader', async () => {
    const wrapper = mount(EmailBody, {
      props: { html: '<p><a href="https://example.com">link</a></p>', text: 'fallback' },
    })
    const frame = wrapper.find('iframe')
    Object.defineProperty(frame.element, 'contentWindow', { value: window })
    const token = frame.attributes('data-bridge-token')

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: { source: 'cookie-email-body', token, type: 'keydown', key: 'd' },
      }),
    )

    const forwarded = wrapper.emitted('keydown')
    expect(forwarded).toHaveLength(1)
    expect(forwarded[0][0].key).toBe('d')

    wrapper.unmount()
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: { source: 'cookie-email-body', token, type: 'keydown', key: 'd' },
      }),
    )
    expect(forwarded).toHaveLength(1)
  })

  it('emits authoritative unsubscribe-link snapshots from the current iframe generation', () => {
    const wrapper = mount(EmailBody, {
      props: {
        html: '<a href="https://news.example/unsubscribe">Unsubscribe</a>',
        bodyResolved: true,
      },
    })
    const frame = wrapper.find('iframe')
    Object.defineProperty(frame.element, 'contentWindow', { value: window })
    const token = frame.attributes('data-bridge-token')
    const generation = frame.attributes('data-bridge-generation')
    const send = (revision, candidates) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: {
            source: 'cookie-email-body',
            token,
            type: 'unsubscribe-links',
            generation,
            revision,
            candidates,
          },
        }),
      )

    send(1, [{ href: 'https://news.example/unsubscribe', text: 'Unsubscribe' }])
    expect(wrapper.emitted('unsubscribe-link').at(-1)[0]?.url).toBe(
      'https://news.example/unsubscribe',
    )

    send(2, [])
    expect(wrapper.emitted('unsubscribe-link').at(-1)).toEqual([null])

    send(1, [{ href: 'https://stale.example/unsubscribe', text: 'Unsubscribe' }])
    expect(wrapper.emitted('unsubscribe-link').at(-1)).toEqual([null])
  })

  it('rate-limits and deduplicates resize bursts from hostile animated content', async () => {
    vi.useFakeTimers()
    const wrapper = mount(EmailBody, { props: { html: '<p>animated</p>' } })
    const frame = wrapper.find('iframe')
    Object.defineProperty(frame.element, 'contentWindow', { value: window })
    const token = frame.attributes('data-bridge-token')
    const sendResize = (height) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: { source: 'cookie-email-body', token, type: 'resize', height },
        }),
      )

    sendResize(100)
    sendResize(200)
    sendResize(300)
    await wrapper.vm.$nextTick()
    expect(frame.attributes('style')).toContain('height: 108px')

    await vi.advanceTimersByTimeAsync(250)
    await wrapper.vm.$nextTick()
    expect(frame.attributes('style')).toContain('height: 308px')

    sendResize(300)
    await vi.advanceTimersByTimeAsync(250)
    await wrapper.vm.$nextTick()
    expect(frame.attributes('style')).toContain('height: 308px')

    wrapper.unmount()
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
