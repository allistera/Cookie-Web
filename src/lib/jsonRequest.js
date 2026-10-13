import { isNetworkError, noteNetworkFailure, noteNetworkSuccess } from './connectivity'
import { startTiming } from './performance'
// HTTP mechanics shared by stores; domain state and rollback stay with callers.
// A failure at the network layer (as opposed to an HTTP error) marks the app
// offline for the banner and the outbox; any response marks it back online.
export async function jsonRequest(url, { method = 'GET', body, headers = {}, signal } = {}) {
  const resource = new URL(url, 'http://localhost').pathname.split('/')[1]
  const completeTiming = startTiming(
    `${['documents', 'task-items'].includes(resource) ? resource : 'request'}:${method.toLowerCase()}`,
  )
  try {
    const options = { method, headers }
    if (signal) options.signal = signal
    if (body !== undefined) options.body = JSON.stringify(body)
    let response
    try {
      response = await fetch(url, options)
    } catch (error) {
      if (isNetworkError(error)) noteNetworkFailure()
      throw error
    }
    noteNetworkSuccess()
    if (!response.ok) {
      const error = new Error(
        `${method} ${new URL(url, 'http://localhost').pathname} responded ${response.status}`,
      )
      error.status = response.status
      try {
        const data = await response.json()
        const message = String(data?.error ?? '').trim()
        if (message) {
          error.message = message
          error.userMessage = message
        }
      } catch {
        // Preserve the HTTP failure when the response is not JSON.
      }
      throw error
    }
    return response.status === 204 ? null : await response.json()
  } finally {
    completeTiming()
  }
}
