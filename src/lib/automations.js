// The Automations app's pages, in sidebar order. The first is the app's home
// (/automations); the others sit at /automations/<id>.
export const AUTOMATION_SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid_view' },
  { id: 'connections', label: 'Connections', icon: 'link' },
  { id: 'templates', label: 'Templates', icon: 'content_copy' },
  { id: 'chat', label: 'Chat', icon: 'chat_bubble' },
]

// Reached from the sidebar's Create Automation button rather than a nav row.
export const NEW_AUTOMATION_SECTION = { id: 'new', label: 'Create Automation' }

const HOME = AUTOMATION_SECTIONS[0]

// The page a route's :section names; anything unknown is the home page.
export function automationSection(id) {
  return (
    [...AUTOMATION_SECTIONS, NEW_AUTOMATION_SECTION].find((section) => section.id === id) ?? HOME
  )
}

export function automationRoute(section) {
  return section.id === HOME.id ? '/automations' : `/automations/${section.id}`
}
