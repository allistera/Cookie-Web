import { matchTimeLine } from './dailyEventLines'

// Visually marks (font + color, via the .is-schedule-line CSS class — see
// DocumentEditor.vue's <style>) any paragraph or list-item line in the
// rendered Editor.js DOM that matches a scheduled-time line, so a Daily
// note's synced lines (api/_lib/dailyEventSync.js) are visible as such while
// typing. A checklist item's checkbox also switches from its default square
// to a circle (.is-schedule-checkbox) to read as "this is a calendar event,
// not a plain to-do" — unordered/ordered list items have no checkbox
// element at all, so they're untouched either way. Display-only: never
// reads or writes editor content, only toggles classes on the already-
// rendered nodes, so it's safe to call on every keystroke without
// disturbing the caret or undo history.
export const SCHEDULE_LINE_CLASS = 'is-schedule-line'
export const SCHEDULE_CHECKBOX_CLASS = 'is-schedule-checkbox'

function matches(el) {
  return Boolean(matchTimeLine(el.textContent ?? ''))
}

// @editorjs/list gives each item's text its own contenteditable
// (.cdx-list__item-content), and - checklist style only - its own checkbox
// (.cdx-list__checkbox-check, a sibling of the content div, inside a
// .cdx-list__checkbox container). Nested sub-items live in a sibling
// .cdx-list__item-children wrapper, recursed into the same way
// api/_lib/dailyEventSync.js's collectListItemLines walks the saved data.
function highlightListItems(container) {
  for (const item of container.children) {
    if (!item.classList?.contains('cdx-list__item')) continue
    const content = item.querySelector(':scope > .cdx-list__item-content')
    const isMatch = content ? matches(content) : false
    if (content) content.classList.toggle(SCHEDULE_LINE_CLASS, isMatch)
    const checkbox = item.querySelector(':scope > .cdx-list__checkbox > .cdx-list__checkbox-check')
    if (checkbox) checkbox.classList.toggle(SCHEDULE_CHECKBOX_CLASS, isMatch)
    const nested = item.querySelector(':scope > .cdx-list__item-children')
    if (nested) highlightListItems(nested)
  }
}

// @param {HTMLElement | null} root - the Editor.js holder element
export function highlightScheduleLines(root) {
  if (!root) return
  for (const block of root.querySelectorAll('.ce-block')) {
    const paragraph = block.querySelector('.ce-paragraph')
    if (paragraph) {
      paragraph.classList.toggle(SCHEDULE_LINE_CLASS, matches(paragraph))
      continue
    }
    const list = block.querySelector('.cdx-list')
    if (list) highlightListItems(list)
  }
}
