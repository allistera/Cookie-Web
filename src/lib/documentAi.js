import { AI_API_URL } from './apiWorkers'
import { jsonRequest } from './jsonRequest'

// Ignore Editor.js-generated IDs when checking whether the content changed.
export function documentContentKey(document) {
  if (!document) return 'null'
  return JSON.stringify({
    title: document.title,
    blocks: document.blocks.map(({ type, data, tunes }) => ({ type, data, tunes })),
  })
}

export async function requestDocumentChat(store, { instruction, document, history, signal }) {
  const body = { instruction, document, history }
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 1024 * 1024) {
    throw new Error('This document is too large to send to AI chat.')
  }
  const result = await jsonRequest(`${AI_API_URL}/document-chat`, {
    method: 'POST',
    headers: await store.authHeaders({ 'Content-Type': 'application/json' }),
    body,
    signal: AbortSignal.any([signal, AbortSignal.timeout(100_000)]),
  })
  if (
    !(result?.reply?.trim instanceof Function) ||
    (result.proposal !== null &&
      (!result.proposal ||
        !(result.proposal.title?.trim instanceof Function) ||
        !Array.isArray(result.proposal.blocks)))
  ) {
    throw new Error('AI returned an invalid response. Please try again.')
  }
  return result
}
