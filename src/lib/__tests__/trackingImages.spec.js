import { describe, expect, it } from 'vitest'

import { stripTrackingImages } from '../trackingImages'

const LOGO = '<img src="https://news.example/logo.png" width="600" height="120" alt="News">'

describe('stripTrackingImages', () => {
  it('removes a remote image declared one pixel square and counts it', () => {
    const out = stripTrackingImages(
      `<p>Hello</p>${LOGO}<img src="https://news.example/o.gif" width="1" height="1" alt="">`,
    )
    expect(out.blocked).toBe(1)
    expect(out.html).toBe(`<p>Hello</p>${LOGO}`)
  })

  it('removes pixels declared through their inline style, zero sizes included', () => {
    const out = stripTrackingImages(
      '<img src="https://t.example/a" style="width:1px !important;height:1px !important;border:0">' +
        '<img src="https://t.example/b" width="0" height="0" style="display:flex">' +
        '<img src="https://t.example/c" style="width:0px; max-height:0px; overflow:hidden">' +
        '<p>Body</p>',
    )
    expect(out.blocked).toBe(3)
    expect(out.html).toBe('<p>Body</p>')
  })

  it('keeps images with a visible size, a spacer one pixel wide included', () => {
    const html =
      `${LOGO}<img src="https://news.example/spacer.gif" width="1" height="20">` +
      '<img src="https://news.example/hero.jpg" width="100%">' +
      '<img src="https://news.example/photo.jpg" style="max-width:100%">'
    expect(stripTrackingImages(html)).toEqual({ html, blocked: 0 })
  })

  it('keeps a remote image that declares no size and matches no tracking address', () => {
    const html = '<img src="https://news.example/photo.jpg" alt="Photo">'
    expect(stripTrackingImages(html)).toEqual({ html, blocked: 0 })
  })

  it('keeps tiny embedded images, which make no request', () => {
    const html =
      '<img src="cid:line@mail" width="1" height="1">' +
      '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="1" height="1">'
    expect(stripTrackingImages(html)).toEqual({ html, blocked: 0 })
  })

  it('removes an image with an open-tracking address even when it declares no size', () => {
    const out = stripTrackingImages(
      `${LOGO}<img src="https://news.us1.list-manage.com/track/open.php?u=1&amp;id=2&amp;e=3" alt="">` +
        '<img src="https://u123.ct.sendgrid.net/wf/open?upn=abc">' +
        '<img src="https://Track.HubSpot.com/__ptq.gif?a=1">',
    )
    expect(out.blocked).toBe(3)
    expect(out.html).toBe(LOGO)
  })

  it('keeps a style sheet that opens the content', () => {
    const out = stripTrackingImages(
      '<style>.a{color:red}</style><p class="a">hi</p>' +
        '<img src="https://t.example/o.gif" width="1" height="1">',
    )
    expect(out.html).toBe('<style>.a{color:red}</style><p class="a">hi</p>')
    expect(out.blocked).toBe(1)
  })

  it('returns the input itself when there is no remote image to inspect', () => {
    const html = '<p>No images, just <a href="https://example.com">a link</a>.</p>'
    expect(stripTrackingImages(html)).toEqual({ html, blocked: 0 })
    expect(stripTrackingImages('')).toEqual({ html: '', blocked: 0 })
    expect(stripTrackingImages(null)).toEqual({ html: '', blocked: 0 })
  })
})
