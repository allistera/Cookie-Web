import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useInboxStore } from '../stores/inbox'

// Command registry for the Cmd+K palette. Commands are declarative:
// { id, title, icon, keyHint?, comingSoon?, run() }. Email-context commands
// only appear while an email is open in the reading panel; keyHints are
// display-only (no global single-key shortcuts).
export function useCommands() {
  const store = useInboxStore()
  const router = useRouter()
  const route = useRoute()

  const commands = computed(() => {
    const email = store.openEmail
    const list = [
      {
        id: 'calendar-create-event',
        title: 'Create Event',
        icon: 'add',
        visible: route.name === 'calendar',
        run: () => store.requestCalendarNewEvent(),
      },
      {
        id: 'mark-done',
        title: 'Mark Done',
        icon: 'check_box',
        keyHint: 'E',
        visible: !!email,
        run: () => store.archiveEmail(email),
      },
      {
        id: 'snooze',
        title: 'Snooze',
        icon: 'schedule',
        keyHint: 'H',
        visible: !!email,
        comingSoon: true,
      },
      {
        id: 'star',
        title: email?.starred ? 'Unstar' : 'Star',
        icon: 'star',
        keyHint: 'S',
        visible: !!email,
        run: () => store.toggleStar(email),
      },
      {
        id: 'move',
        title: 'Move to…',
        icon: 'drive_file_move',
        keyHint: 'V',
        visible: !!email,
        comingSoon: true,
      },
      {
        id: 'label',
        title: 'Add Label…',
        icon: 'sell',
        keyHint: 'L',
        visible: !!email,
        comingSoon: true,
      },
      {
        id: 'toggle-read',
        title: email?.unread ? 'Mark Read' : 'Mark Unread',
        icon: email?.unread ? 'mark_email_read' : 'mark_email_unread',
        visible: !!email,
        run: () => store.setUnread(email, !email.unread),
      },
      {
        id: 'compose',
        title: 'Compose',
        icon: 'edit_square',
        keyHint: 'C',
        run: () => store.openComposer(),
      },
      {
        id: 'go-inbox',
        title: 'Go to Inbox',
        icon: 'inbox',
        run: () => router.push('/inbox'),
      },
      {
        id: 'go-starred',
        title: 'Go to Starred',
        icon: 'star',
        run: () => router.push({ path: '/inbox', query: { filter: 'starred' } }),
      },
      {
        id: 'go-snoozed',
        title: 'Go to Snoozed',
        icon: 'schedule',
        run: () => router.push({ path: '/inbox', query: { filter: 'snoozed' } }),
      },
      {
        id: 'go-scheduled',
        title: 'Go to Scheduled',
        icon: 'upcoming',
        run: () => router.push({ path: '/scheduled' }),
      },
      {
        id: 'go-done',
        title: 'Go to Done',
        icon: 'task_alt',
        run: () => router.push({ path: '/inbox', query: { filter: 'done' } }),
      },
      {
        id: 'go-sent',
        title: 'Go to Sent',
        icon: 'send',
        run: () => router.push({ path: '/inbox', query: { filter: 'sent' } }),
      },
      {
        id: 'go-spam',
        title: 'Go to Spam',
        icon: 'report',
        run: () => router.push({ path: '/inbox', query: { filter: 'spam' } }),
      },
      ...store.allLabels.map((label) => ({
        id: `go-label-${label.name}`,
        title: `Go to label ${label.name}`,
        icon: 'sell',
        iconColor: label.color,
        run: () =>
          router.push({ path: '/inbox', query: { filter: 'label', label: label.name } }),
      })),
      {
        id: 'open-settings',
        title: 'Open Settings',
        icon: 'settings',
        run: () => router.push({ name: 'settings', params: { section: 'account' } }),
      },
    ]
    return list.filter((c) => c.visible !== false)
  })

  // Substring matches rank above in-order subsequence matches; among
  // substring matches, an earlier position ranks higher. Non-matches drop.
  function filterCommands(list, query) {
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list
      .map((cmd) => {
        const title = cmd.title.toLowerCase()
        const idx = title.indexOf(q)
        if (idx !== -1) return { cmd, score: 100 - idx }
        let ti = 0
        for (const ch of q) {
          ti = title.indexOf(ch, ti)
          if (ti === -1) return null
          ti++
        }
        return { cmd, score: 0 }
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.cmd)
  }

  return { commands, filterCommands }
}
