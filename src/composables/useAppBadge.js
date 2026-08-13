import { watch, onScopeDispose } from 'vue'
import { clearAppBadge, setAppBadge } from '../lib/appBadge'

// Badges the installed app's icon with the total unread inbox count —
// distinct from useTitleUnreadBadge's tab-title badge, which only counts
// mail that arrived while the tab was hidden. The Dock/taskbar icon has no
// such "while backgrounded" concept, so it always reflects the live count.
export function useAppBadge(store, { set = setAppBadge, clear = clearAppBadge } = {}) {
  watch(
    () => store.unreadInboxCount,
    (count) => set(count),
    { immediate: true },
  )

  onScopeDispose(() => clear())
}
