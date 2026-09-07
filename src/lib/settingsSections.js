// Settings navigation, shared by SettingsView and the command palette so a
// section added here is reachable from both.
export const settingsSectionGroups = [
  {
    label: 'General',
    sections: [
      { id: 'account', label: 'Account', icon: 'person' },
      { id: 'appearance', label: 'Appearance', icon: 'palette' },
      { id: 'notifications', label: 'Notifications', icon: 'notifications' },
      { id: 'personalisation', label: 'Personalisation', icon: 'interests' },
    ],
  },
  {
    label: 'Email',
    sections: [
      { id: 'signature', label: 'Signature', icon: 'draw' },
      { id: 'snippets', label: 'Snippets', icon: 'bookmark' },
      { id: 'labels', label: 'Labels', icon: 'label' },
      { id: 'rules', label: 'Rules', icon: 'rule' },
      { id: 'auto-archive', label: 'Auto Archive', icon: 'archive' },
      { id: 'spam', label: 'Spam', icon: 'report' },
    ],
  },
  {
    label: 'Calendar',
    sections: [{ id: 'calendar', label: 'Calendars', icon: 'calendar_month' }],
  },
  {
    label: 'Documents',
    sections: [
      { id: 'document-templates', label: 'Templates', icon: 'description' },
      { id: 'daily-notes', label: 'Time Management', icon: 'today' },
    ],
  },
]

export const settingsSections = settingsSectionGroups.flatMap((group) => group.sections)
