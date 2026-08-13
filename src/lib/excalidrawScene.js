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

export function serializeExcalidrawScene(elements, appState, files, serializeAsJSON) {
  const serialized = serializeAsJSON(elements, appState, files, 'database')
  return normalizeExcalidrawScene(JSON.parse(serialized))
}

export function excalidrawDrawingLabel(scene) {
  const count = normalizeExcalidrawScene(scene).elements.filter((element) => !element?.isDeleted).length
  if (count === 0) return 'Excalidraw drawing, empty'
  return `Excalidraw drawing, ${count} element${count === 1 ? '' : 's'}`
}
