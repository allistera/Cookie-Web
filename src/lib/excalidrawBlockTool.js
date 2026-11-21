import { deferEditorMount, editorPreview } from './deferredEditor'
import {
  excalidrawDrawingLabel,
  normalizeExcalidrawScene,
  serializeExcalidrawScene,
} from './excalidrawScene'

const TOOLBOX_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 17.5 14.8 6.7a2.1 2.1 0 0 1 3 3L7 20.5H4v-3Z"/>
    <path d="m13.5 8 3 3"/>
    <path d="M4 13c2-2 4-2 6 0s4 2 6 0 3-2 4-1"/>
  </svg>`

const GUARDED_KEYS = new Set(['Backspace', 'Delete', 'Enter'])

export class ExcalidrawBlockTool {
  static get toolbox() {
    return { title: 'Excalidraw', icon: TOOLBOX_ICON }
  }

  static get enableLineBreaks() {
    return true
  }

  constructor({ data, config }) {
    this.data = normalizeExcalidrawScene(data)
    this.config = config ?? {}
    this.root = null
    this.wrapper = null
    this.mountNode = null
    this.pendingScene = null
    this.changeFrame = null
  }

  render() {
    this.wrapper = document.createElement('div')
    this.wrapper.className = 'excalidraw-block'
    this.wrapper.setAttribute('role', 'region')
    this.wrapper.addEventListener('keydown', (event) => {
      if (GUARDED_KEYS.has(event.key)) event.stopPropagation()
    })
    this.updateLabel()

    const loading = editorPreview(excalidrawDrawingLabel(this.data))
    this.mountNode = loading
    this.wrapper.append(loading)
    this.cancelDeferredMount = deferEditorMount(this.wrapper, loading, (preview) =>
      this.mountExcalidraw(preview),
    )
    return this.wrapper
  }

  async mountExcalidraw(loading) {
    try {
      const [{ createElement }, { createRoot }, excalidraw] = await Promise.all([
        import('react'),
        import('react-dom/client'),
        import('@excalidraw/excalidraw'),
        import('@excalidraw/excalidraw/index.css'),
      ])
      if (!this.wrapper?.isConnected) return

      const { Excalidraw, getSceneVersion, serializeAsJSON } = excalidraw
      let sceneVersion = getSceneVersion(this.data.elements)
      const onChange = (elements, appState, files) => {
        const nextVersion = getSceneVersion(elements)
        if (nextVersion === sceneVersion) return
        sceneVersion = nextVersion
        this.pendingScene = { elements, appState, files, serializeAsJSON }
        this.updateLabel(elements)
        this.scheduleDocumentSave()
      }

      const canvas = document.createElement('div')
      canvas.className = 'excalidraw-block__canvas'
      loading.replaceWith(canvas)
      this.mountNode = canvas
      this.root = createRoot(canvas)
      this.root.render(
        createElement(Excalidraw, {
          initialData: { ...this.data, scrollToContent: true },
          onChange,
          theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
          name: 'Document drawing',
          autoFocus: false,
          detectScroll: true,
          handleKeyboardGlobally: false,
          // Hides the "Text to diagram" / mermaid conversion entry points,
          // which otherwise pull cytoscape and katex (~1MB+) into a hand
          // drawing tool that never uses them.
          aiEnabled: false,
          UIOptions: {
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
              toggleTheme: false,
            },
          },
        }),
      )
    } catch (error) {
      console.error('Loading Excalidraw failed:', error)
      const errorNode = this.mountNode?.isConnected ? this.mountNode : this.wrapper
      if (errorNode) {
        errorNode.classList.add('error')
        errorNode.textContent = 'Excalidraw could not be loaded.'
      }
    }
  }

  scheduleDocumentSave() {
    if (this.changeFrame !== null) return
    this.changeFrame = requestAnimationFrame(() => {
      this.changeFrame = null
      this.config.onChange?.()
    })
  }

  updateLabel(elements = this.data.elements) {
    this.wrapper?.setAttribute('aria-label', excalidrawDrawingLabel({ elements }))
  }

  save() {
    if (this.pendingScene) {
      const { elements, appState, files, serializeAsJSON } = this.pendingScene
      this.data = serializeExcalidrawScene(elements, appState, files, serializeAsJSON)
      this.pendingScene = null
    }
    return this.data
  }

  destroy() {
    this.cancelDeferredMount?.()
    if (this.changeFrame !== null) cancelAnimationFrame(this.changeFrame)
    this.changeFrame = null
    this.pendingScene = null
    this.root?.unmount()
    this.root = null
    this.mountNode = null
    this.wrapper = null
  }

  removed() {
    this.destroy()
  }
}
