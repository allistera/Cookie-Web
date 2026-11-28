// The automation ideas shown on Automations > Templates. Hard-coded for now:
// nothing here runs yet, and a card only leads to Create Automation.

// The Cookie apps a template touches, shown as the icons on its card.
export const TEMPLATE_APPS = {
  email: { label: 'Email', icon: 'mail' },
  calendar: { label: 'Calendar', icon: 'calendar_month' },
  tasks: { label: 'Tasks', icon: 'task_alt' },
  documents: { label: 'Documents', icon: 'description' },
  notifications: { label: 'Notifications', icon: 'notifications' },
}

/** @internal */
export const TEMPLATE_GROUPS = [
  {
    id: 'staff-picks',
    title: 'Staff picks',
    description: 'Handpicked favourites: the automations people reach for first.',
    templates: [
      {
        id: 'morning-digest',
        title: 'Morning Digest of Mail and Calendar',
        description:
          'Every morning, gathers the mail that arrived overnight, today’s calendar events and the tasks due today, then writes them up as one short briefing.',
        apps: ['email', 'calendar', 'tasks'],
      },
      {
        id: 'time-block-tasks',
        title: 'Time Block Tasks by Calendar Availability',
        description:
          'Each morning, checks today’s tasks against your calendar and slots them into the free blocks, using each task’s estimate for its length.',
        apps: ['calendar', 'tasks'],
      },
      {
        id: 'reschedule-overdue',
        title: 'Reschedule Overdue Tasks to Today',
        description:
          'At midnight, moves every overdue task to today so each day starts with a clean slate, leaving repeating schedules as they are.',
        apps: ['tasks'],
      },
      {
        id: 'starred-mail-to-tasks',
        title: 'Starred Emails to Tasks',
        description:
          'Turns each email you star into a task with a link back to the message and a due date read from what it asks for.',
        apps: ['email', 'tasks'],
      },
    ],
  },
  {
    id: 'notifications',
    title: 'Push Notifications',
    description: '',
    templates: [
      {
        id: 'eye-break',
        title: '20/20/20: Eye Break Reminder',
        description:
          'Sends a push notification every 20 minutes on weekdays to step away from the screen and rest your eyes.',
        apps: ['notifications'],
      },
      {
        id: 'important-sender',
        title: 'Alert Me When Someone Important Writes',
        description:
          'Sends a push notification as soon as mail arrives from a sender you have marked as important, and stays quiet for everything else.',
        apps: ['email', 'notifications'],
      },
    ],
  },
  {
    id: 'email',
    title: 'Email',
    description: 'Keep the inbox moving without opening it.',
    templates: [
      {
        id: 'follow-up-unanswered',
        title: 'Follow Up on Unanswered Sent Mail',
        description:
          'Three days after you send an email that asks a question, checks for a reply and, without one, adds a task to chase it.',
        apps: ['email', 'tasks'],
      },
      {
        id: 'newsletter-roundup',
        title: 'Weekly Newsletter Round-Up',
        description:
          'Every Friday, collects the week’s newsletters into one document of headlines and summaries, then marks the originals done.',
        apps: ['email', 'documents'],
      },
      {
        id: 'receipts-to-document',
        title: 'File Receipts in a Monthly Document',
        description:
          'When a receipt or invoice arrives, adds its sender, amount and date to that month’s expenses document.',
        apps: ['email', 'documents'],
      },
    ],
  },
  {
    id: 'calendar',
    title: 'Calendar',
    description: 'Get ready for what is coming up.',
    templates: [
      {
        id: 'meeting-prep',
        title: 'Meeting Prep Notes',
        description:
          'An hour before each meeting, gathers recent mail from the people attending into a notes document linked from the event.',
        apps: ['calendar', 'email', 'documents'],
      },
      {
        id: 'week-ahead',
        title: 'Week Ahead Briefing',
        description:
          'Every Sunday evening, lists the coming week’s events and deadlines and flags the days that are already full.',
        apps: ['calendar', 'tasks'],
      },
    ],
  },
  {
    id: 'tasks',
    title: 'Tasks',
    description: 'Keep the list honest.',
    templates: [
      {
        id: 'weekly-review',
        title: 'Weekly Review Document',
        description:
          'Every Friday afternoon, writes up what you completed this week and what slipped, as a document to read before planning the next.',
        apps: ['tasks', 'documents'],
      },
      {
        id: 'stale-task-sweep',
        title: 'Sweep Stale Tasks to Someday',
        description:
          'Once a month, finds tasks untouched for sixty days and puts them off to Someday, so the list shows what you still mean to do.',
        apps: ['tasks'],
      },
    ],
  },
]

// The groups a search leaves: each keeps only the templates whose title or
// description holds every word typed, and a group with none left is dropped.
export function searchTemplateGroups(query, groups = TEMPLATE_GROUPS) {
  const words = String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return groups
  return groups
    .map((group) => ({
      ...group,
      templates: group.templates.filter((template) => {
        const text = `${template.title} ${template.description}`.toLowerCase()
        return words.every((word) => text.includes(word))
      }),
    }))
    .filter((group) => group.templates.length > 0)
}
