export const MAX_DOCUMENT_TAGS = 20
export const MAX_DOCUMENT_TAG_LENGTH = 40

const DOCUMENT_TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u

export function normalizeDocumentTag(value) {
  if (!(value?.trim instanceof Function)) return null
  const tag = value.trim().replace(/^#+/, '').toLocaleLowerCase()
  if (!tag || tag.length > MAX_DOCUMENT_TAG_LENGTH || !DOCUMENT_TAG_RE.test(tag)) return null
  return tag
}

export function normalizeDocumentTags(value) {
  if (!Array.isArray(value)) return null
  const tags = []
  for (const candidate of value) {
    const tag = normalizeDocumentTag(candidate)
    if (!tag) return null
    if (!tags.includes(tag)) tags.push(tag)
    if (tags.length > MAX_DOCUMENT_TAGS) return null
  }
  return tags
}
