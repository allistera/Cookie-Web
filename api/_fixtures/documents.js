// Fixture rows in the same shape as /api/tasks?resource=documents. Served by
// the local Vite middleware in e2e mode (and in dev when DATABASE_URL is
// unset) so the Documents workspace works without a database.

const folders = [
  { id: 'stub-folder-projects', parent_id: null, title: 'Projects', emoji: '📁' },
  { id: 'stub-folder-kitchen', parent_id: 'stub-folder-projects', title: 'Kitchen Renovation', emoji: '📁' },
]

const documents = [
  {
    id: 'stub-doc-floor-plan',
    folder_id: 'stub-folder-kitchen',
    title: 'Floor plan notes',
    emoji: '💡',
    starred: true,
    blocks: [
      { id: 'b-fp-1', type: 'paragraph', data: { text: 'Notes from the revised floor plan review.' } },
      { id: 'b-fp-2', type: 'header', data: { text: 'Open questions', level: 2 } },
      {
        id: 'b-fp-3',
        type: 'list',
        data: { style: 'unordered', items: ['Bay window dimensions', 'Framing crew start date'] },
      },
    ],
  },
  {
    id: 'stub-doc-scratchpad',
    folder_id: null,
    title: 'Scratchpad',
    emoji: '🔹',
    starred: false,
    blocks: [{ id: 'b-sp-1', type: 'paragraph', data: { text: 'Loose notes live here.' } }],
  },
]

export function fixtureDocumentFolders() {
  const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  return folders.map((row) => ({ ...row, created_at: createdAt }))
}

export function fixtureDocuments() {
  const createdAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  const updatedAt = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
  return documents.map((row) => ({
    ...row,
    blocks: structuredClone(row.blocks),
    created_at: createdAt,
    updated_at: updatedAt,
  }))
}

export function fixtureDocumentTemplates() {
  return []
}
