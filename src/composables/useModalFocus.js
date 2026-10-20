import { nextTick, onBeforeUnmount, onMounted } from 'vue'

const FOCUSABLE = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[tabindex]',
  '[contenteditable="true"]',
].join(',')

// Dialog contents may change while open (templates arrive, Advanced opens,
// buttons become disabled). Recalculate the tab order for each key press.
export function useModalFocus(dialog, { initialFocus } = {}) {
  let opener
  let mounted = false
  const focusable = () =>
    [...(dialog.value?.querySelectorAll(FOCUSABLE) ?? [])].filter(
      (node) =>
        node.tabIndex >= 0 &&
        !node.matches(':disabled') &&
        !node.closest('[hidden], [inert], [aria-hidden="true"]') &&
        getComputedStyle(node).display !== 'none' &&
        getComputedStyle(node).visibility !== 'hidden',
    )
  function onKeydown(event) {
    if (event.key !== 'Tab') return
    const nodes = focusable()
    const first = nodes[0]
    const last = nodes.at(-1)
    if (!first) {
      event.preventDefault()
      dialog.value?.focus()
    } else if (
      event.shiftKey &&
      (document.activeElement === first || !nodes.includes(document.activeElement))
    ) {
      event.preventDefault()
      last.focus()
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || !nodes.includes(document.activeElement))
    ) {
      event.preventDefault()
      first.focus()
    }
  }
  onMounted(async () => {
    mounted = true
    opener = document.activeElement
    dialog.value?.addEventListener('keydown', onKeydown)
    await nextTick()
    if (mounted) (initialFocus?.value ?? focusable()[0] ?? dialog.value)?.focus()
  })
  onBeforeUnmount(() => {
    mounted = false
    dialog.value?.removeEventListener('keydown', onKeydown)
    if (opener?.isConnected) opener.focus()
  })
}
