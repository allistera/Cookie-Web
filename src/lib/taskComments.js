// Pure helpers for a task's discussion thread (TaskComments.vue and the
// taskComments store). No store, no DOM.

import { MAX_UPLOAD_BYTES } from './documentFiles'

// Mirrors cookie-web-tasks/src/taskComments.js: the same text cap as a task
// description and the same 25 MB file cap as a Documents upload.
export const MAX_COMMENT_LENGTH = 10000
export const MAX_ATTACHMENT_BYTES = MAX_UPLOAD_BYTES

const STAMP = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

// "15 Oct 2026, 09:42" for the entry header; '' for a stamp that is missing
// or unreadable, so a bad row never throws the thread off screen.
export function formatCommentTime(iso) {
  const date = new Date(iso ?? '')
  return Number.isNaN(date.getTime()) ? '' : STAMP.format(date)
}

// Whether a draft is worth sending: text once trimmed, or a file. The
// server refuses an entry with neither.
export function canSubmitComment({ body = '', file = null } = {}) {
  return Boolean(String(body ?? '').trim()) || Boolean(file)
}

// A client-side read of the limits the Worker enforces, so an oversized
// choice is named before the bytes are sent. Null when the draft is fine.
export function commentDraftProblem({ body = '', file = null } = {}) {
  if (String(body ?? '').length > MAX_COMMENT_LENGTH) {
    return `Comments are limited to ${MAX_COMMENT_LENGTH.toLocaleString('en-GB')} characters.`
  }
  if (file && file.size > MAX_ATTACHMENT_BYTES) return 'Attachments are limited to 25 MB.'
  return null
}

// Who wrote the entry, as the header names them. The thread is the task
// owner's today, so an entry is almost always the person's own name (or
// "You" when the session has none); the fallback covers a row written by
// another account should the task ever be shared.
export function commentAuthorLabel(comment, ownName = '') {
  return comment?.mine ? String(ownName ?? '').trim() || 'You' : 'Collaborator'
}

// Whether the attachment can be taken off the entry on its own. An entry
// with no text is its attachment, so removing it would leave nothing — the
// server refuses that, and the UI offers Delete instead.
export function canRemoveAttachment(comment) {
  return Boolean(comment?.mine && comment?.attachment && String(comment.body ?? '').trim())
}
