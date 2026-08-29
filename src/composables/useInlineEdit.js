import { nextTick, ref } from 'vue'

// Click-to-edit state for a single field: a draft, a focused input, and the
// guard that keeps one edit from being sent twice. Enter commits and unmounts
// the input, which fires blur and calls submit again; without `editing` as a
// latch, every rename would go to the server twice.
//
// `read` is called rather than captured so the draft always seeds from the
// current value, and `write` receives the trimmed draft only when it differs.
// `selectAll` is false where clicking in usually means appending rather than
// replacing — a description, say — so the caret lands at the end instead of
// putting the whole value one keystroke from gone.
export function useInlineEdit({ read, write, canEdit = () => true, selectAll = true }) {
  const editing = ref(false)
  const draft = ref('')
  const inputRef = ref(null)

  async function start() {
    if (!canEdit()) return
    draft.value = read() ?? ''
    editing.value = true
    await nextTick()
    inputRef.value?.focus()
    if (selectAll) inputRef.value?.select?.()
  }

  async function submit() {
    if (!editing.value) return
    const value = draft.value.trim()
    editing.value = false
    if (value === (read() ?? '')) return
    await write(value)
  }

  return { editing, draft, inputRef, start, submit }
}
