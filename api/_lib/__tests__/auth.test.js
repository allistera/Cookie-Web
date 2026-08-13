import process from 'node:process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { verifyAccessToken } from '../auth.js'

const req = {
  headers: { authorization: 'Bearer signed-token' },
}

describe('verifyAccessToken identity binding', () => {
  beforeEach(() => {
    process.env.VITE_AUTH0_DOMAIN = 'tenant.example.auth0.com'
    process.env.VITE_AUTH0_AUDIENCE = 'https://cookie-web/api'
  })

  afterEach(() => {
    delete process.env.VITE_AUTH0_DOMAIN
    delete process.env.VITE_AUTH0_AUDIENCE
  })

  it('returns the mailbox provisioned for the verified subject, ignoring email claims', async () => {
    const jwtVerify = vi.fn(async () => ({
      payload: {
        sub: 'auth0|stable-subject',
        email: 'attacker@example.com',
        'https://cookie-web/email': 'attacker@example.com',
      },
    }))
    const sql = vi.fn(async () => [
      { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' },
    ])

    await expect(
      verifyAccessToken(req, { jwks: {}, jwtVerify, sql }),
    ).resolves.toMatchObject({
      sub: 'auth0|stable-subject',
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'owner@example.com',
    })
    expect(sql.mock.calls[0][1]).toBe('auth0|stable-subject')
    expect(jwtVerify).toHaveBeenCalledWith(
      'signed-token',
      {},
      expect.objectContaining({
        issuer: 'https://tenant.example.auth0.com/',
        audience: 'https://cookie-web/api',
        algorithms: ['RS256'],
      }),
    )
  })

  it('rejects a valid tenant token whose subject is not provisioned', async () => {
    const jwtVerify = vi.fn(async () => ({
      payload: { sub: 'auth0|unknown', email: 'owner@example.com' },
    }))
    const sql = vi.fn(async () => [])

    await expect(
      verifyAccessToken(req, { jwks: {}, jwtVerify, sql }),
    ).rejects.toThrow(/not provisioned/i)
  })

  it('rejects a token without an immutable subject even if it has an email', async () => {
    const jwtVerify = vi.fn(async () => ({ payload: { email: 'owner@example.com' } }))
    const sql = vi.fn()

    await expect(
      verifyAccessToken(req, { jwks: {}, jwtVerify, sql }),
    ).rejects.toThrow(/no subject/i)
    expect(sql).not.toHaveBeenCalled()
  })
})
