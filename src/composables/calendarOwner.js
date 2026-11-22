import { ref } from 'vue'

let owner = null
const ownerGeneration = ref(0)
const resetCallbacks = new Set()

export function registerCalendarReset(callback) {
  resetCallbacks.add(callback)
}

// App sets this synchronously at the authentication boundary. Outstanding
// reads and syncs from the previous account must never repopulate the cache.
export function setCalendarsOwner(sub) {
  if (owner === (sub || null)) return
  owner = sub || null
  ownerGeneration.value += 1
  for (const reset of resetCallbacks) reset()
}

export const calendarOwnerSession = () => ownerGeneration.value
