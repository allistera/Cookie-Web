import { describe, it, expect } from 'vitest'

import {
  appendRecipient,
  completedRecipients,
  currentRecipientToken,
  parseRecipients,
  recipientsValid,
} from '../recipients.js'

describe('parseRecipients', () => {
  it('splits a comma-separated list, trimming and dropping blanks', () => {
    expect(parseRecipients('a@b.com, c@d.com')).toEqual(['a@b.com', 'c@d.com'])
    expect(parseRecipients('  a@b.com ,, c@d.com , ')).toEqual(['a@b.com', 'c@d.com'])
    expect(parseRecipients('a@b.com')).toEqual(['a@b.com'])
    expect(parseRecipients('')).toEqual([])
  })
})

describe('recipientsValid', () => {
  it('requires at least one recipient, all address-like', () => {
    expect(recipientsValid('a@b.com')).toBe(true)
    expect(recipientsValid('a@b.com, c@d.com')).toBe(true)
    expect(recipientsValid('a@b.com, ')).toBe(true) // trailing comma is fine
    expect(recipientsValid('')).toBe(false)
    expect(recipientsValid('a@b.com, nope')).toBe(false) // one bad address fails
    expect(recipientsValid('nope')).toBe(false)
  })

  it('mirrors the server-side 20-recipient cap so Send disables up front', () => {
    const address = (i) => `person${i}@example.com`
    const twenty = Array.from({ length: 20 }, (_, i) => address(i)).join(', ')
    expect(recipientsValid(twenty)).toBe(true)
    expect(recipientsValid(`${twenty}, one-too-many@example.com`)).toBe(false)
  })
})

describe('currentRecipientToken', () => {
  it('returns the fragment after the last comma', () => {
    expect(currentRecipientToken('ak')).toBe('ak')
    expect(currentRecipientToken('a@b.com, ak')).toBe('ak')
    expect(currentRecipientToken('a@b.com, ')).toBe('')
  })
})

describe('completedRecipients', () => {
  it('returns addresses committed before the current token', () => {
    expect(completedRecipients('ak')).toEqual([])
    expect(completedRecipients('a@b.com, ak')).toEqual(['a@b.com'])
    expect(completedRecipients('a@b.com, c@d.com, ')).toEqual(['a@b.com', 'c@d.com'])
  })
})

describe('appendRecipient', () => {
  it('replaces the current token and readies the next', () => {
    expect(appendRecipient('', 'a@b.com')).toBe('a@b.com, ')
    expect(appendRecipient('ak', 'akhil@x.com')).toBe('akhil@x.com, ')
    expect(appendRecipient('a@b.com, ak', 'akhil@x.com')).toBe('a@b.com, akhil@x.com, ')
    expect(appendRecipient('a@b.com, ', 'c@d.com')).toBe('a@b.com, c@d.com, ')
  })
})
