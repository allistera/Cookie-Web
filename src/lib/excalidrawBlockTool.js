import { excalidrawDrawingLabel, normalizeExcalidrawScene, serializeExcalidrawScene } from './excalidrawScene'

const TOOLBOX_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 17.5 14.8 6.7a2.1 2.1 0 0 1 3 3L7 20.5H4v-3Z"/>
    <path d="m13.5 8 3 3"/>
    <path d="M4 13c2-2 4-2 6 0s4 2 6 0 3-2 4-1"/>
  </svg>`

export class ExcalidrawBlockTool {
  static get toolbox() {
    return { title: 'Excalidraw', icon: TOOLBOX_ICON }
  }

  constructor({ data, config }) {
    this.data = normalizeExcalidrawScene(data)
    this.config = config ?? {}
    this.root = null
    this.wrapper = null
    this.changeFrame = null
  }

  render() {
    this.wrapper = document.createElement('div')
    this.wrapper.className = 'excalidraw-block'
    this.wrapper.setAttribute('role', 'region')
    this.updateLabel()

    const loading = document.createElement('div')
    loading.className = 'excalidraw-block__loading'
    loading.textContent = 'Loading Excalidraw…'
    this.wrapper.append(loading)
    this.mountExcalidraw(loading)
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
        this.data = serializeExcalidrawScene(elements, appState, files, serializeAsJSON)
        this.updateLabel()
        this.scheduleDocumentSave()
      }

      const canvas = document.createElement('div')
      canvas.className = 'excalidraw-block__canvas'
      loading.replaceWith(canvas)
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
      loading.classList.add('error')
      loading.textContent = 'Excalidraw could not be loaded.'
    }
  }

  scheduleDocumentSave() {
    if (this.changeFrame !== null) return
    this.changeFrame = requestAnimationFrame(() => {
      this.changeFrame = null
      this.config.onChange?.()
    })
  }

  updateLabel() {
    this.wrapper?.setAttribute('aria-label', excalidrawDrawingLabel(this.data))
  }

  save() {
    return this.data
  }

  destroy() {
    if (this.changeFrame !== null) cancelAnimationFrame(this.changeFrame)
    this.changeFrame = null
    this.root?.unmount()
    this.root = null
    this.wrapper = null
  }
}
