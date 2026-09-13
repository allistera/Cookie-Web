// An editor keeps its original snapshot until activated. Once activated it
// remains mounted until document teardown so scrolling never discards edits.
export function deferEditorMount(wrapper, preview, mount) {
  let disposed = false
  let started = false
  let observer
  const activate = () => {
    if (disposed || started || !wrapper.isConnected) return
    started = true
    observer?.disconnect()
    wrapper.removeEventListener('focusin', activate)
    preview.removeEventListener('click', activate)
    void mount(preview)
  }
  preview.addEventListener('click', activate)
  wrapper.addEventListener('focusin', activate)
  if (globalThis.IntersectionObserver) {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) activate()
      },
      { rootMargin: '200px' },
    )
    observer.observe(wrapper)
  }
  // Browsers without IntersectionObserver retain an accessible click-to-edit
  // preview rather than eagerly creating every editor in a long document.
  return () => {
    disposed = true
    observer?.disconnect()
    wrapper.removeEventListener('focusin', activate)
    preview.removeEventListener('click', activate)
  }
}

export function editorPreview(label, lines = []) {
  const preview = document.createElement('button')
  preview.type = 'button'
  preview.className = 'document-block-preview'
  const title = document.createElement('strong')
  title.textContent = label
  preview.append(title)
  for (const line of lines.slice(0, 4)) {
    const row = document.createElement('span')
    row.textContent = String(line).slice(0, 160)
    preview.append(row)
  }
  const hint = document.createElement('span')
  hint.textContent = 'Click to edit'
  preview.append(hint)
  return preview
}
