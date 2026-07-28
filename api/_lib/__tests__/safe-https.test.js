import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import {
  isPublicIpAddress,
  requestPublicHttps,
  resolvePublicHttpsUrl,
} from '../safe-https.js'

describe('public HTTPS egress boundary', () => {
  it('rejects private, link-local, metadata, mapped, and documentation addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.169.254',
      '192.0.2.10',
      '::1',
      '::ffff:127.0.0.1',
      'fe80::1',
      'fd00::1',
      '2001:db8::1',
      '2001:0db8::1',
      '2002:7f00:1::1',
      '3fff::1',
    ]) {
      expect(isPublicIpAddress(address)).toBe(false)
    }
    expect(isPublicIpAddress('93.184.216.34')).toBe(true)
    expect(isPublicIpAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(true)
  })

  it('rejects a hostname when any selectable DNS answer is non-public', async () => {
    const lookup = vi.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])

    await expect(resolvePublicHttpsUrl('https://mixed.example/path', lookup)).rejects.toThrow(
      /disallowed address/i,
    )
    expect(lookup).toHaveBeenCalledWith('mixed.example', { all: true, verbatim: true })
  })

  it('pins the connection lookup to the validated address while preserving the URL hostname', async () => {
    const lookup = vi.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ])
    const request = vi.fn((url, options, callback) => {
      const req = new EventEmitter()
      req.setTimeout = vi.fn()
      req.end = vi.fn(() => {
        const response = Readable.from([Buffer.from('calendar')])
        response.statusCode = 200
        response.headers = { 'content-type': 'text/calendar' }
        callback(response)
      })
      req.destroy = vi.fn((error) => req.emit('error', error))
      return req
    })

    const response = await requestPublicHttps(
      'https://calendar.example/feed.ics',
      { maxResponseBytes: 1024 },
      { lookup, request },
    )

    expect(response.body.toString()).toBe('calendar')
    expect(request.mock.calls[0][0].hostname).toBe('calendar.example')
    const pinnedLookup = request.mock.calls[0][1].lookup
    await expect(
      new Promise((resolve, reject) => {
        pinnedLookup('calendar.example', {}, (error, address, family) => {
          if (error) reject(error)
          else resolve({ address, family })
        })
      }),
    ).resolves.toEqual({ address: '93.184.216.34', family: 4 })
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized responses before returning their body', async () => {
    const lookup = vi.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ])
    const request = vi.fn((_url, _options, callback) => {
      const req = new EventEmitter()
      req.setTimeout = vi.fn()
      req.end = vi.fn(() => {
        const response = Readable.from([Buffer.alloc(5), Buffer.alloc(5)])
        response.statusCode = 200
        response.headers = {}
        callback(response)
      })
      req.destroy = vi.fn((error) => req.emit('error', error))
      return req
    })

    await expect(
      requestPublicHttps('https://calendar.example/feed.ics', { maxResponseBytes: 8 }, { lookup, request }),
    ).rejects.toThrow(/too large/i)
  })
})
