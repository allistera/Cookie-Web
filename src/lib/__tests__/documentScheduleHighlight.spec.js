import { describe, expect, it } from 'vitest'

import {
  highlightScheduleLines,
  SCHEDULE_CHECKBOX_CLASS,
  SCHEDULE_LINE_CLASS,
} from '../documentScheduleHighlight'

function checklistItem(text) {
  return `
    <li class="cdx-list__item">
      <div class="cdx-list__checkbox"><span class="cdx-list__checkbox-check"></span></div>
      <div class="cdx-list__item-content">${text}</div>
    </li>
  `
}

function mount(html) {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)
  return root
}

describe('highlightScheduleLines', () => {
  it('highlights a matching paragraph block and leaves a non-matching one alone', () => {
    const root = mount(`
      <div class="ce-block"><div class="ce-block__content">
        <div class="ce-paragraph">10:00 - 11:00 - Team sync</div>
      </div></div>
      <div class="ce-block"><div class="ce-block__content">
        <div class="ce-paragraph">Just a regular note</div>
      </div></div>
    `)
    highlightScheduleLines(root)

    const paragraphs = root.querySelectorAll('.ce-paragraph')
    expect(paragraphs[0].classList.contains(SCHEDULE_LINE_CLASS)).toBe(true)
    expect(paragraphs[1].classList.contains(SCHEDULE_LINE_CLASS)).toBe(false)
  })

  it('highlights only the matching items in a flat checklist', () => {
    const root = mount(`
      <div class="ce-block"><div class="ce-block__content">
        <ol class="cdx-list cdx-list-checklist">
          ${checklistItem('09:00 - Standup')}
          ${checklistItem('Plain task')}
          ${checklistItem('10:00 - 10:30 - Design review')}
        </ol>
      </div></div>
    `)
    highlightScheduleLines(root)

    const items = root.querySelectorAll('.cdx-list__item-content')
    expect(items[0].classList.contains(SCHEDULE_LINE_CLASS)).toBe(true)
    expect(items[1].classList.contains(SCHEDULE_LINE_CLASS)).toBe(false)
    expect(items[2].classList.contains(SCHEDULE_LINE_CLASS)).toBe(true)
  })

  it("rounds a matching checklist item's checkbox into a circle, and leaves a plain one square", () => {
    const root = mount(`
      <div class="ce-block"><div class="ce-block__content">
        <ol class="cdx-list cdx-list-checklist">
          ${checklistItem('09:00 - Standup')}
          ${checklistItem('Plain task')}
        </ol>
      </div></div>
    `)
    highlightScheduleLines(root)

    const checkboxes = root.querySelectorAll('.cdx-list__checkbox-check')
    expect(checkboxes[0].classList.contains(SCHEDULE_CHECKBOX_CLASS)).toBe(true)
    expect(checkboxes[1].classList.contains(SCHEDULE_CHECKBOX_CLASS)).toBe(false)
  })

  it('does not touch a checkbox in an unrelated unordered/ordered list (they have none)', () => {
    const root = mount(`
      <div class="ce-block"><div class="ce-block__content">
        <ul class="cdx-list cdx-list-unordered">
          <li class="cdx-list__item"><div class="cdx-list__item-content">09:00 - Standup</div></li>
        </ul>
      </div></div>
    `)
    expect(() => highlightScheduleLines(root)).not.toThrow()
    expect(root.querySelectorAll(`.${SCHEDULE_CHECKBOX_CLASS}`)).toHaveLength(0)
  })

  it('recurses into nested sub-items', () => {
    const root = mount(`
      <div class="ce-block"><div class="ce-block__content">
        <ul class="cdx-list cdx-list-unordered">
          <li class="cdx-list__item">
            <div class="cdx-list__item-content">Morning</div>
            <ul class="cdx-list__item-children">
              <li class="cdx-list__item"><div class="cdx-list__item-content">09:00 - Standup</div></li>
            </ul>
          </li>
        </ul>
      </div></div>
    `)
    highlightScheduleLines(root)

    const nested = root.querySelector('.cdx-list__item-children .cdx-list__item-content')
    expect(nested.classList.contains(SCHEDULE_LINE_CLASS)).toBe(true)
  })

  it('un-highlights a line that no longer matches after being edited', () => {
    const root = mount(`
      <div class="ce-block"><div class="ce-block__content">
        <div class="ce-paragraph">10:00 - 11:00 - Team sync</div>
      </div></div>
    `)
    highlightScheduleLines(root)
    const paragraph = root.querySelector('.ce-paragraph')
    expect(paragraph.classList.contains(SCHEDULE_LINE_CLASS)).toBe(true)

    paragraph.textContent = 'Team sync moved, no time yet'
    highlightScheduleLines(root)
    expect(paragraph.classList.contains(SCHEDULE_LINE_CLASS)).toBe(false)
  })

  it('ignores block types with neither a paragraph nor a list', () => {
    const root = mount(`
      <div class="ce-block"><div class="ce-block__content">
        <h2 class="ce-header">10:00 - 11:00 - Not scheduled from a header</h2>
      </div></div>
    `)
    expect(() => highlightScheduleLines(root)).not.toThrow()
    expect(root.querySelectorAll(`.${SCHEDULE_LINE_CLASS}`)).toHaveLength(0)
  })

  it('does nothing for a null root', () => {
    expect(() => highlightScheduleLines(null)).not.toThrow()
  })
})
