import { onBeforeUnmount, onMounted, ref } from 'vue'

import { localToday } from '../lib/localDate'

// Refresh at local midnight and when returning to a suspended tab.
export function useLocalToday() {
  const today = ref(localToday())
  let timer

  function refresh() {
    today.value = localToday()
    clearTimeout(timer)
    const now = new Date()
    const midnight = new Date(now)
    midnight.setHours(24, 0, 0, 0)
    timer = setTimeout(refresh, midnight.getTime() - now.getTime())
  }

  onMounted(() => {
    refresh()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
  })
  onBeforeUnmount(() => {
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', refresh)
    window.removeEventListener('focus', refresh)
  })

  return today
}
