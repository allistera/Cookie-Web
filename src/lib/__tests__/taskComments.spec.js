import { describe, expect, it } from 'vitest'

import {
  MAX_ATTACHMENT_BYTES,
  MAX_COMMENT_LENGTH,
  canRemoveAttachment,
  canSubmitComment,
  commentAuthorLabel,
  commentDraftProblem,
  formatCommentTime,
} from '../taskComments'

describe('formatCommentTime', () => {
  it('formats a stamp as a medium date and short time in a fixed locale', () => {
    const text = formatCommentTime('2026-10-15T09:42:00Z')
    expect(text).toMatch(/^15 Oct 2026, \d{2}:\d{2}$/)
  })

  it('returns nothing for a missing or unreadable stamp', () => {
    expect(formatCommentTime(null)).toBe('')
    expect(formatCommentTime('not a date')).toBe('')
  })
})

describe('canSubmitComment', () => {
  it('needs text once trimmed, or a file', () => {
    expect(canSubmitComment({ body: '   ' })).toBe(false)
    expect(canSubmitComment({ body: ' hi ' })).toBe(true)
    expect(canSubmitComment({ body: '', file: { size: 1 } })).toBe(true)
    expect(canSubmitComment()).toBe(false)
  })
})

describe('commentDraftProblem', () => {
  it('names an oversized text or file, and nothing otherwise', () => {
    expect(commentDraftProblem({ body: 'x'.repeat(MAX_COMMENT_LENGTH) })).toBeNull()
    expect(commentDraftProblem({ body: 'x'.repeat(MAX_COMMENT_LENGTH + 1) })).toMatch(/10,000/)
    expect(commentDraftProblem({ file: { size: MAX_ATTACHMENT_BYTES } })).toBeNull()
    expect(commentDraftProblem({ file: { size: MAX_ATTACHMENT_BYTES + 1 } })).toMatch(/25 MB/)
  })
})

describe('commentAuthorLabel', () => {
  it('names the caller own entries "You"', () => {
    expect(commentAuthorLabel({ mine: true })).toBe('You')
    expect(commentAuthorLabel({ mine: false })).toBe('Collaborator')
  })
})

describe('canRemoveAttachment', () => {
  it('allows taking the file off an own entry that keeps its text', () => {
    const attachment = { name: 'a.pdf' }
    expect(canRemoveAttachment({ mine: true, attachment, body: 'Keep' })).toBe(true)
    expect(canRemoveAttachment({ mine: true, attachment, body: ' ' })).toBe(false)
    expect(canRemoveAttachment({ mine: false, attachment, body: 'Keep' })).toBe(false)
    expect(canRemoveAttachment({ mine: true, attachment: null, body: 'Keep' })).toBe(false)
  })
})
