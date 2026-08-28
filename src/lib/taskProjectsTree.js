// Flattens the project forest into the ordered, depth-annotated rows the Tasks
// sidebar renders — recursion stays here, in a pure function, instead of in a
// recursive component. Rows inside collapsed projects are omitted.
//
// The two failure modes are the ones documentsTree.js already paid for: a
// project whose parentId no longer resolves (or which sits in a cycle) is
// treated as a root so its subtree never silently vanishes, and reachability
// is computed ignoring expansion, so a collapsed parent hides its children
// rather than orphaning them.
export function flattenProjectTree(projects, expandedIds) {
  const byParent = new Map([[null, []]])
  const ids = new Set(projects.map((project) => project.id))
  for (const project of projects) {
    const parent = project.parentId && ids.has(project.parentId) ? project.parentId : null
    if (!byParent.has(parent)) byParent.set(parent, [])
    byParent.get(parent).push(project)
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.name.localeCompare(b.name))
  }

  const reachable = new Set()
  const mark = (parentId) => {
    for (const child of byParent.get(parentId) ?? []) {
      if (reachable.has(child.id)) continue
      reachable.add(child.id)
      mark(child.id)
    }
  }
  mark(null)
  for (const orphan of projects) {
    if (reachable.has(orphan.id)) continue
    reachable.add(orphan.id)
    byParent.get(null).push(orphan)
    // Break the cycle so the render walk terminates at this new root.
    const siblings = byParent.get(orphan.parentId) ?? []
    const at = siblings.indexOf(orphan)
    if (at !== -1) siblings.splice(at, 1)
    mark(orphan.id)
  }

  const rows = []
  const walk = (parentId, depth) => {
    for (const project of byParent.get(parentId) ?? []) {
      const children = byParent.get(project.id) ?? []
      const expanded = expandedIds.has(project.id)
      rows.push({ item: project, depth, expanded, hasChildren: children.length > 0 })
      if (expanded) walk(project.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}
