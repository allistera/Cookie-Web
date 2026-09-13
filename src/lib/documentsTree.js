// Flattens the Documents sidebar's folder/document forest into the ordered,
// depth-annotated rows the tree renders — recursion stays here, in a pure
// function, instead of in a recursive component. Rows inside collapsed
// folders are omitted. A folder whose parent_id no longer resolves (or sits
// in a cycle) is treated as a root so its subtree never silently vanishes.
export function flattenDocumentsTree(folders, documents, expandedIds, pageFor = () => null) {
  const byParent = new Map([[null, []]])
  const ids = new Set(folders.map((folder) => folder.id))
  for (const folder of folders) {
    const parent = folder.parent_id !== null && ids.has(folder.parent_id) ? folder.parent_id : null
    if (!byParent.has(parent)) byParent.set(parent, [])
    byParent.get(parent).push(folder)
  }

  const docsByFolder = new Map()
  for (const doc of documents) {
    const folder = doc.folder_id !== null && ids.has(doc.folder_id) ? doc.folder_id : null
    if (!docsByFolder.has(folder)) docsByFolder.set(folder, [])
    docsByFolder.get(folder).push(doc)
  }

  // Reachability is computed ignoring expansion: a folder inside a collapsed
  // parent is hidden, not orphaned. Only members of a parent cycle (reachable
  // from no root at all) get pulled up to the top level below.
  const reachable = new Set()
  const mark = (parentId) => {
    for (const child of byParent.get(parentId) ?? []) {
      if (reachable.has(child.id)) continue
      reachable.add(child.id)
      mark(child.id)
    }
  }
  mark(null)
  for (const orphan of folders) {
    if (!reachable.has(orphan.id)) {
      reachable.add(orphan.id)
      byParent.get(null).push(orphan)
      // Break the cycle so the render walk terminates at this new root.
      const siblings = byParent.get(orphan.parent_id) ?? []
      const at = siblings.indexOf(orphan)
      if (at !== -1) siblings.splice(at, 1)
      mark(orphan.id)
    }
  }

  const rows = []
  const appendMore = (folderId, depth) => {
    const page = pageFor(folderId ?? 'root')
    if (page && (!page.loaded || page.nextCursor))
      rows.push({
        kind: 'more',
        item: { id: folderId ?? 'root' },
        depth,
        loading: page.loading,
      })
  }
  const walk = (parentId, depth) => {
    for (const folder of byParent.get(parentId) ?? []) {
      const expanded = expandedIds.has(folder.id)
      rows.push({ kind: 'folder', item: folder, depth, expanded })
      if (!expanded) continue
      walk(folder.id, depth + 1)
      for (const doc of docsByFolder.get(folder.id) ?? []) {
        rows.push({ kind: 'document', item: doc, depth: depth + 1 })
      }
      appendMore(folder.id, depth + 1)
    }
  }
  walk(null, 0)
  for (const doc of docsByFolder.get(null) ?? []) {
    rows.push({ kind: 'document', item: doc, depth: 0 })
  }
  appendMore(null, 0)
  return rows
}
