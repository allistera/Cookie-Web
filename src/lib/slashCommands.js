// Slash-menu commands for the composer editor. Metadata only — the editor
// component maps each id to an action (formatting via document.execCommand, or
// emitting the AI "generate" event). Filtering is a pure function so it can be
// unit-tested without the DOM.
export const SLASH_COMMANDS = [
  {
    id: 'generate',
    title: 'Generate Message',
    hint: 'AI',
    icon: 'auto_awesome',
    keywords: 'ai generate write draft compose message',
  },
  {
    id: 'heading',
    title: 'Heading',
    hint: 'H',
    icon: 'title',
    keywords: 'heading title header h2',
  },
  {
    id: 'bullet',
    title: 'Bullet list',
    hint: '•',
    icon: 'format_list_bulleted',
    keywords: 'bullet unordered list',
  },
  {
    id: 'numbered',
    title: 'Numbered list',
    hint: '1.',
    icon: 'format_list_numbered',
    keywords: 'numbered ordered list',
  },
  { id: 'bold', title: 'Bold', hint: 'B', icon: 'format_bold', keywords: 'bold strong emphasis' },
  {
    id: 'quote',
    title: 'Quote',
    hint: '”',
    icon: 'format_quote',
    keywords: 'quote blockquote citation',
  },
  {
    id: 'divider',
    title: 'Divider',
    hint: '—',
    icon: 'horizontal_rule',
    keywords: 'divider rule line separator hr',
  },
]

// Filters commands by a query against the title and keyword aliases.
export function filterSlashCommands(query, snippets = []) {
  const q = (query || '').trim().toLowerCase()
  const commands = [...snippets, ...SLASH_COMMANDS]
  if (!q) return commands
  return commands.filter(
    (command) => command.title.toLowerCase().includes(q) || command.keywords.includes(q),
  )
}
