import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { settingsSections } from '../lib/settingsSections'
import { getStoredTheme, resolveTheme, setTheme } from '../lib/theme'
import { useCalendars } from './useCalendars'
import {
  useInboxStore,
  inboxTabForCategory,
  isImportantCategory,
  PRIORITY_TAB,
  OTHER_TAB,
} from '../stores/inbox'
import { useTaskItemsStore } from '../stores/taskItems'
import { useDocumentsStore } from '../stores/documents'
import { useSavedViewsStore } from '../stores/savedViews'
import { savedViewRoute } from '../lib/savedViews'
import { scheduleChoices } from '../utils/schedule'

// Snooze presets offered as palette entries. Filtered against the live
// choices, so a day that scheduleChoices drops as a duplicate is not listed.
const SNOOZE_PRESETS = ['tomorrow', 'next-week']

// Command registry for the '/' palette. Commands are declarative:
// { id, title, icon, keyHint?, visible?, iconColor?, run() }.
// Email-context commands only appear while an email is open in the reading
// panel. keyHint names a real single-key shortcut bound elsewhere in the app.
export function useCommands() {
  const store = useInboxStore()
  const tasks = useTaskItemsStore()
  const documents = useDocumentsStore()
  const savedViews = useSavedViewsStore()
  const router = useRouter()
  const route = useRoute()
  const { subscribedCalendars, loadCalendars, syncCalendar } = useCalendars(
    (init) => store.authHeaders(init),
    (message, kind) => store.notify(message, kind),
  )

  // Pulls every subscribed feed; each failure is reported by name.
  async function syncSubscribedCalendars() {
    await loadCalendars()
    const targets = subscribedCalendars.value
    if (!targets.length) {
      store.notify('No subscribed calendars to sync.')
      return
    }
    const results = await Promise.all(
      targets.map((calendar) =>
        syncCalendar(calendar.id)
          .then((result) => ({ calendar, ...result }))
          .catch((error) => {
            console.error('Failed to sync calendar:', error)
            return { calendar, ok: false, errorMessage: null }
          }),
      ),
    )
    const failed = results.filter((result) => !result.ok)
    for (const { calendar, errorMessage } of failed) {
      store.notify(`Sync failed for ${calendar.name}: ${errorMessage || 'unknown error'}`, 'error')
    }
    if (failed.length < results.length) store.notify('Calendars synced.', 'success')
  }

  // Views own their dialogs, so a command raised from elsewhere first goes to
  // the route and only then raises the request; the target view consumes a
  // request that was pending when it mounted.
  async function goThen(target, isThere, request) {
    if (!isThere) await router.push(target)
    request()
  }

  function inboxTabCommand(id, name, iconColor) {
    return {
      id: `tab-${id}`,
      title: `Switch to ${name} tab`,
      icon: 'tab',
      iconColor,
      run: () => {
        store.setInboxTab(id)
        if (route.name !== 'traditional-inbox' || Object.keys(route.query).length) {
          router.push('/inbox')
        }
      },
    }
  }

  const commands = computed(() => {
    const email = store.openEmail
    const onInbox = route.name === 'traditional-inbox'
    const isDark = resolveTheme(getStoredTheme()) === 'dark'
    const onCalendar = route.name === 'calendar'
    const onTasks = route.name === 'tasks'
    const onTaskList = onTasks && !!route.query.project && route.query.project !== 'today'
    const documentOpen = route.name === 'documents' && !!route.params.id
    const snoozes = scheduleChoices().filter((choice) => SNOOZE_PRESETS.includes(choice.id))
    const list = [
      {
        id: 'mark-done',
        title: 'Mark Done',
        icon: 'check_box',
        keyHint: 'D',
        visible: !!email,
        run: () => store.archiveEmail(email),
      },
      {
        id: 'reply',
        title: 'Reply',
        icon: 'reply',
        visible: !!email,
        run: () => goThen('/inbox', onInbox, () => store.requestReaderAction('reply')),
      },
      {
        id: 'reply-all',
        title: 'Reply All',
        icon: 'reply_all',
        visible: !!email,
        run: () => goThen('/inbox', onInbox, () => store.requestReaderAction('reply-all')),
      },
      {
        id: 'forward',
        title: 'Forward',
        icon: 'forward',
        visible: !!email,
        run: () => goThen('/inbox', onInbox, () => store.requestReaderAction('forward')),
      },
      ...snoozes.map((choice) => ({
        id: `snooze-${choice.id}`,
        title: `Snooze until ${choice.label.toLowerCase()}`,
        icon: 'schedule',
        visible: !!email,
        // Through the reader so the panel advances to the next email as it
        // does for the Snooze menu.
        run: () => goThen('/inbox', onInbox, () => store.requestReaderAction('snooze', choice)),
      })),
      {
        id: 'star',
        title: email?.starred ? 'Unstar' : 'Star',
        icon: 'star',
        visible: !!email,
        run: () => store.toggleStar(email),
      },
      ...store.allLabels.map((label) => {
        const applied = (email?.labels || []).some((item) => item.name === label.name)
        return {
          id: `label-${label.name}`,
          title: applied ? `Remove label ${label.name}` : `Label as ${label.name}`,
          icon: 'sell',
          iconColor: label.color,
          visible: !!email,
          run: () => store.toggleMessageLabel(email, label),
        }
      }),
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
        run: () => store.openComposer(),
      },
      {
        id: 'calendar-create-event',
        title: 'Create Event',
        icon: 'add',
        run: () => goThen({ name: 'calendar' }, onCalendar, () => store.requestCalendarNewEvent()),
      },
      {
        id: 'calendar-today',
        title: 'Calendar: Go to Today',
        icon: 'today',
        visible: onCalendar,
        run: () => store.requestCalendarAction('today'),
      },
      ...['day', 'week', 'month'].map((mode) => ({
        id: `calendar-view-${mode}`,
        title: `Calendar: ${mode[0].toUpperCase()}${mode.slice(1)} view`,
        icon: 'calendar_month',
        visible: onCalendar,
        run: () => store.requestCalendarAction(`view:${mode}`),
      })),
      {
        id: 'calendar-previous',
        title: 'Calendar: Previous period',
        icon: 'arrow_back',
        visible: onCalendar,
        run: () => store.requestCalendarAction('previous'),
      },
      {
        id: 'calendar-next',
        title: 'Calendar: Next period',
        icon: 'arrow_forward',
        visible: onCalendar,
        run: () => store.requestCalendarAction('next'),
      },
      {
        id: 'calendar-sync',
        title: 'Sync Calendars Now',
        icon: 'sync',
        run: syncSubscribedCalendars,
      },
      {
        id: 'new-document',
        title: 'New Document',
        icon: 'note_add',
        run: () =>
          goThen({ name: 'documents' }, route.name === 'documents', () =>
            documents.openNewDocumentDialog(),
          ),
      },
      {
        id: 'open-daily-note',
        title: "Open Today's Daily Note",
        icon: 'today',
        run: async () => {
          const doc = await documents.openTodayNote()
          if (doc) router.push(`/documents/${doc.id}`)
        },
      },
      {
        id: 'new-folder',
        title: 'New Folder',
        icon: 'create_new_folder',
        run: () =>
          goThen({ name: 'documents' }, route.name === 'documents', () =>
            documents.requestViewAction('new-folder'),
          ),
      },
      {
        id: 'export-markdown',
        title: 'Export Document to Markdown',
        icon: 'download',
        visible: documentOpen,
        run: () => documents.requestViewAction('export-markdown'),
      },
      {
        id: 'export-pdf',
        title: 'Export Document to PDF',
        icon: 'picture_as_pdf',
        visible: documentOpen,
        run: () => documents.requestViewAction('export-pdf'),
      },
      {
        id: 'new-task',
        title: 'New Task',
        icon: 'add_task',
        // Today has no compose row, so a new task lands in the tasks Inbox.
        run: () =>
          goThen({ name: 'tasks', query: { project: 'inbox' } }, onTaskList, () =>
            tasks.requestViewAction('new-task'),
          ),
      },
      {
        id: 'new-project',
        title: 'New Project',
        icon: 'create_new_folder',
        run: () => goThen({ name: 'tasks' }, onTasks, () => tasks.requestViewAction('new-project')),
      },
      {
        id: 'add-divider',
        title: 'Add Divider',
        icon: 'horizontal_rule',
        visible: onTaskList,
        run: () => tasks.requestViewAction('add-divider'),
      },
      {
        id: 'theme-dark',
        title: 'Switch to dark theme',
        icon: 'dark_mode',
        visible: !isDark,
        run: () => setTheme('dark'),
      },
      {
        id: 'theme-light',
        title: 'Switch to light theme',
        icon: 'light_mode',
        visible: isDark,
        run: () => setTheme('light'),
      },
      {
        id: 'go-ai-today',
        title: 'Go to AI Today',
        icon: 'auto_awesome',
        run: () => router.push({ name: 'ai-inbox' }),
      },
      {
        id: 'go-inbox',
        title: 'Go to Inbox',
        icon: 'inbox',
        run: () => router.push('/inbox'),
      },
      ...savedViews.views.map((view) => ({
        id: `go-saved-view-${view.id}`,
        title: `Go to saved view ${view.name}`,
        icon: 'filter_alt',
        run: () => router.push(savedViewRoute(view)),
      })),
      {
        id: 'go-calendar',
        title: 'Go to Calendar',
        icon: 'calendar_month',
        run: () => router.push({ name: 'calendar' }),
      },
      {
        id: 'go-documents',
        title: 'Go to Documents',
        icon: 'description',
        run: () => router.push({ name: 'documents' }),
      },
      {
        id: 'go-tasks',
        title: 'Go to Tasks',
        icon: 'task_alt',
        run: () => router.push({ name: 'tasks' }),
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
        id: 'go-drafts',
        title: 'Go to Drafts',
        icon: 'draft',
        run: () => router.push({ name: 'drafts' }),
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
        run: () => router.push({ path: '/inbox', query: { filter: 'label', label: label.name } }),
      })),
      inboxTabCommand(PRIORITY_TAB, 'Important'),
      ...store.allCategories
        .filter((category) => !isImportantCategory(category))
        .map((category) =>
          inboxTabCommand(inboxTabForCategory(category.id), category.name, category.color),
        ),
      inboxTabCommand(OTHER_TAB, 'Other'),
      {
        id: 'open-settings',
        title: 'Open Settings',
        icon: 'settings',
        run: () => router.push({ name: 'settings', params: { section: 'account' } }),
      },
      ...settingsSections.map((section) => ({
        id: `settings-${section.id}`,
        title: `Settings: ${section.label}`,
        icon: section.icon,
        run: () => router.push({ name: 'settings', params: { section: section.id } }),
      })),
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
