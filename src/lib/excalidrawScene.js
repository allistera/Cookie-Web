const EMPTY_SCENE = Object.freeze({ elements: [], appState: {}, files: {} })

function isRecord(value) {
  return value !== null && Object(value) === value && !Array.isArray(value)
}

export function normalizeExcalidrawScene(value) {
  if (!isRecord(value)) return { ...EMPTY_SCENE }
  return {
    elements: Array.isArray(value.elements) ? value.elements : [],
    appState: isRecord(value.appState) ? value.appState : {},
    files: isRecord(value.files) ? value.files : {},
  }
}

// Excalidraw's 'database' serialization deliberately drops `files` (it expects
// a separate file store), so the binary data for pasted images is kept from
// the onChange argument, limited to files still used by a visible image.
function referencedFiles(elements, files) {
  if (!isRecord(files)) return {}
  const kept = {}
  for (const element of elements) {
    const fileId = element?.type === 'image' && !element.isDeleted ? element.fileId : null
    if (fileId && isRecord(files[fileId])) kept[fileId] = files[fileId]
  }
  return kept
}

export function serializeExcalidrawScene(elements, appState, files, serializeAsJSON) {
  const scene = normalizeExcalidrawScene(
    JSON.parse(serializeAsJSON(elements, appState, files, 'database')),
  )
  return { ...scene, files: referencedFiles(scene.elements, files) }
}

export function excalidrawDrawingLabel(scene) {
  const count = normalizeExcalidrawScene(scene).elements.filter(
    (element) => !element?.isDeleted,
  ).length
  if (count === 0) return 'Excalidraw drawing, empty'
  return `Excalidraw drawing, ${count} element${count === 1 ? '' : 's'}`
}
