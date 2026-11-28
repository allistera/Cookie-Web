// A star keeps a draft: Cookie-Worker deletes a draft that is not starred 30
// days after its last save.
import { DRAFTS_API_URL } from './apiWorkers'
import { jsonRequest } from './jsonRequest'

export const DRAFT_RETENTION_DAYS = 30

export function saveDraftStar(headers, draftId, starred) {
  return jsonRequest(`${DRAFTS_API_URL}/drafts/${encodeURIComponent(draftId)}/star`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: { starred },
  })
}
