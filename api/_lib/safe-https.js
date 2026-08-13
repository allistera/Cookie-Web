import dns from 'node:dns/promises'
import https from 'node:https'
import { BlockList, isIPv4, isIPv6 } from 'node:net'
import { Buffer } from 'node:buffer'

const PRIVATE_IPV4_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

const BLOCKED_IPV6 = new BlockList()
BLOCKED_IPV6.addSubnet('2001::', 23, 'ipv6')
BLOCKED_IPV6.addSubnet('2001:db8::', 32, 'ipv6')
BLOCKED_IPV6.addSubnet('2002::', 16, 'ipv6')
BLOCKED_IPV6.addSubnet('3fff::', 20, 'ipv6')

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
}

function isPublicIPv4(ip) {
  const int = ipv4ToInt(ip)
  return !PRIVATE_IPV4_RANGES.some(([base, bits]) => {
    const mask = (~0 << (32 - bits)) >>> 0
    return (int & mask) === (ipv4ToInt(base) & mask)
  })
}

function isPublicIPv6(ip) {
  const normalized = ip.toLowerCase().split('%')[0]
  // Globally routable unicast addresses currently occupy 2000::/3. Restricting
  // the egress boundary to that range fails closed for loopback, unspecified,
  // link-local, unique-local, multicast, documentation, and mapped IPv4 forms.
  const first = Number.parseInt(normalized.split(':')[0] || '0', 16)
  if (first < 0x2000 || first > 0x3fff) return false
  return !BLOCKED_IPV6.check(normalized, 'ipv6')
}

export function isPublicIpAddress(address) {
  if (isIPv4(address)) return isPublicIPv4(address)
  if (isIPv6(address)) return isPublicIPv6(address)
  return false
}

export async function resolvePublicHttpsUrl(rawUrl, lookup = dns.lookup) {
  const url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Only credential-free HTTPS URLs are allowed')
  }

  let addresses
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true })
  } catch {
    throw new Error('Could not resolve the remote URL')
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error('Could not resolve the remote URL')
  }
  if (addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error('The remote URL points to a disallowed address')
  }

  const { address, family } = addresses[0]
  return { url, address, family }
}

export async function requestPublicHttps(
  rawUrl,
  { method = 'GET', headers = {}, body = null, timeoutMs = 10_000, maxResponseBytes = 0 } = {},
  { lookup = dns.lookup, request = https.request } = {},
) {
  return new Promise((resolve, reject) => {
    let settled = false
    let req
    let response
    let deadlineTimer
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(deadlineTimer)
      fn(value)
    }

    const timeoutError = new Error('The remote request timed out')
    deadlineTimer = setTimeout(() => {
      finish(reject, timeoutError)
      response?.destroy(timeoutError)
      req?.destroy(timeoutError)
    }, timeoutMs)

    resolvePublicHttpsUrl(rawUrl, lookup)
      .then((target) => {
        if (settled) return
        const pinnedLookup = (_hostname, options, callback) => {
          if (options?.all) {
            callback(null, [{ address: target.address, family: target.family }])
          } else {
            callback(null, target.address, target.family)
          }
        }
        req = request(
          target.url,
          { method, headers, lookup: pinnedLookup },
          (incoming) => {
            response = incoming
            if (settled) {
              response.destroy()
              return
            }

            const status = response.statusCode || 0
            if (maxResponseBytes <= 0) {
              finish(resolve, { status, headers: response.headers, body: Buffer.alloc(0) })
              response.destroy()
              return
            }

            const chunks = []
            let bytes = 0
            response.on('data', (chunk) => {
              bytes += chunk.length
              if (bytes > maxResponseBytes) {
                const error = new Error('The remote response is too large')
                finish(reject, error)
                response.destroy(error)
                return
              }
              chunks.push(chunk)
            })
            response.on('end', () => {
              finish(resolve, { status, headers: response.headers, body: Buffer.concat(chunks) })
            })
            response.on('error', (error) => finish(reject, error))
          },
        )
        req.on('error', (error) => finish(reject, error))
        req.end(body ?? undefined)
      })
      .catch((error) => finish(reject, error))
  })
}
