import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import EmailRow from '../EmailRow.vue'

const email = {
  id: 'm1',
  subject: 'Quarterly numbers',
  unread: true,
  starred: false,
  labels: [],
  sentAt: '2026-09-21T10:00:00Z',
}

function mountRow(props = {}) {
  return mount(EmailRow, { props: { email, sender: 'Ada Lovelace', ...props } })
}

describe('EmailRow', () => {
  // The row is the only way to read an email, so it must be reachable and
  // activatable from the keyboard like the checkbox inside it already is.
  it('exposes the row as a focusable button named after the message', () => {
    const row = mountRow().get('.ni-row')
    expect(row.attributes('role')).toBe('button')
    expect(row.attributes('tabindex')).toBe('0')
    expect(row.attributes('aria-label')).toContain('Ada Lovelace')
    expect(row.attributes('aria-label')).toContain('Quarterly numbers')
  })

  it('opens on Enter and Space', async () => {
    const wrapper = mountRow()
    await wrapper.get('.ni-row').trigger('keydown', { key: 'Enter' })
    await wrapper.get('.ni-row').trigger('keydown', { key: ' ' })
    expect(wrapper.emitted('open')).toHaveLength(2)
    expect(wrapper.emitted('open')[0]).toEqual([email])
  })

  it('does not open when Enter is used on the select checkbox', async () => {
    const wrapper = mountRow()
    await wrapper.get('.ni-checkbox').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('toggle-select')).toHaveLength(1)
    expect(wrapper.emitted('open')).toBeUndefined()
  })
})
