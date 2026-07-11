import { watch, onScopeDispose } from 'vue'

// Gmail-style tab badge: while the tab is hidden, prefixes the document title
// with the number of unread emails that arrived since the tab was last
// visible — "(2) Cookie AI Inbox - Workspace Intelligence" — and restores the
// plain title when the user returns. The count is a delta against the unread
// count snapshotted when the tab went hidden, so messages read on another
// device while away shrink the badge instead of leaving it stale.
export function useTitleUnreadBadge(store) {
  const baseTitle = document.title
  // Unread count at the moment the tab went hidden; null while visible.
  let hiddenBaseline = document.hidden ? store.unreadInboxCount : null

  function render() {
    const newCount =
      hiddenBaseline === null ? 0 : Math.max(0, store.unreadInboxCount - hiddenBaseline)
    document.title = newCount > 0 ? `(${newCount}) ${baseTitle}` : baseTitle
  }

  function onVisibilityChange() {
    hiddenBaseline = document.hidden ? store.unreadInboxCount : null
    render()
  }

  document.addEventListener('visibilitychange', onVisibilityChange)

  watch(
    () => store.unreadInboxCount,
    () => render(),
  )

  onScopeDispose(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    document.title = baseTitle
  })
}
