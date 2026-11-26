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

  it('removes an image whose srcset holds a pixel or a tracking address', () => {
    const out = stripTrackingImages(
      `${LOGO}<img srcset="https://t.example/o.gif 1x, https://t.example/o2.gif 2x" width="1" height="1">` +
        '<img src="cid:logo@mail" srcset="https://news.us1.list-manage.com/track/open.php?u=1 2x">',
    )
    expect(out.blocked).toBe(2)
    expect(out.html).toBe(LOGO)
  })

  it('removes a picture source that tracks and keeps the picture image', () => {
    const out = stripTrackingImages(
      '<picture><source srcset="https://u1.ct.sendgrid.net/wf/open?upn=a" media="(min-width: 600px)">' +
        '<source srcset="https://t.example/p.gif" width="1" height="1">' +
        '<img src="https://news.example/hero.jpg" width="600"></picture>',
    )
    expect(out.blocked).toBe(2)
    expect(out.html).toBe(
      '<picture><img src="https://news.example/hero.jpg" width="600"></picture>',
    )
  })

  it('removes a tracking background attribute and keeps its cell', () => {
    const out = stripTrackingImages(
      '<table><tbody><tr><td background="https://news.example/bg.png">A</td>' +
        '<td background="https://pstmrk.it/open?m=1">B</td>' +
        '<td background="https://t.example/p.gif" width="1" height="1">C</td></tr></tbody></table>',
    )
    expect(out.blocked).toBe(2)
    expect(out.html).toBe(
      '<table><tbody><tr><td background="https://news.example/bg.png">A</td>' +
        '<td>B</td><td width="1" height="1">C</td></tr></tbody></table>',
    )
  })

  it('turns a tracking inline url() into none and keeps the rest of the style', () => {
    const out = stripTrackingImages(
      '<div style="background: url(\'https://news.us1.list-manage.com/track/open.php?u=1\') no-repeat; color: red">A</div>' +
        '<span style="width:1px;height:1px;background-image:url(https://t.example/p.gif)"></span>' +
        '<div style="background-image: url(https://news.example/bg.png)">B</div>',
    )
    expect(out.blocked).toBe(2)
    expect(out.html).toBe(
      '<div style="background: none no-repeat; color: red">A</div>' +
        '<span style="width:1px;height:1px;background-image:none"></span>' +
        '<div style="background-image: url(https://news.example/bg.png)">B</div>',
    )
  })

  it('keeps ordinary responsive images', () => {
    const html =
      '<img src="https://news.example/a.jpg" srcset="https://news.example/a.jpg 1x, https://news.example/a@2x.jpg 2x" width="600">' +
      '<img srcset="https://news.example/b-480.jpg 480w, https://news.example/b-960.jpg 960w" sizes="100vw" alt="B">' +
      '<picture><source srcset="https://news.example/c.webp" type="image/webp">' +
      '<img src="https://news.example/c.jpg" alt="C"></picture>'
    expect(stripTrackingImages(html)).toEqual({ html, blocked: 0 })
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
