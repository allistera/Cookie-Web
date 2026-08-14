import { matchTimeLine } from './dailyEventLines'

// Visually marks (font + color, via the .is-schedule-line CSS class — see
// DocumentEditor.vue's <style>) any paragraph or list-item line in the
// rendered Editor.js DOM that matches a scheduled-time line, so a Daily
// note's synced lines (api/_lib/dailyEventSync.js) are visible as such while
// typing. Display-only: never reads or writes editor content, only toggles
// a class on the already-rendered nodes, so it's safe to call on every
// keystroke without disturbing the caret or undo history.
export const SCHEDULE_LINE_CLASS = 'is-schedule-line'

function applyHighlight(el) {
  el.classList.toggle(SCHEDULE_LINE_CLASS, Boolean(matchTimeLine(el.textContent ?? '')))
}

// @editorjs/list gives each item's text its own contenteditable
// (.cdx-list__item-content); nested sub-items live in a sibling
// .cdx-list__item-children wrapper, recursed into the same way
// api/_lib/dailyEventSync.js's collectListItemLines walks the saved data.
function highlightListItems(container) {
  for (const item of container.children) {
    if (!item.classList?.contains('cdx-list__item')) continue
    const content = item.querySelector(':scope > .cdx-list__item-content')
    if (content) applyHighlight(content)
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
      applyHighlight(paragraph)
      continue
    }
    const list = block.querySelector('.cdx-list')
    if (list) highlightListItems(list)
  }
}
