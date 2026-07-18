import { describe, it, expect } from 'vitest'

import { filterContacts } from '../contactSuggest.js'

const CONTACTS = [
  { address: 'akhil.bangi@avanceservices.uk', name: 'Akhil Bangi' },
  { address: 'aleks@harperdb.io', name: 'Aleks Haugom' },
  { address: 'no-reply@algolia.com', name: 'Algolia' },
  { address: 'allan@seewillow.com', name: 'Allan Guo' },
]

describe('filterContacts', () => {
  it('returns nothing for an empty query', () => {
    expect(filterContacts(CONTACTS, '')).toEqual([])
    expect(filterContacts(CONTACTS, '   ')).toEqual([])
  })

  it('matches by display name (what a native datalist cannot do)', () => {
    const result = filterContacts(CONTACTS, 'akhil')
    expect(result).toHaveLength(1)
    expect(result[0].address).toBe('akhil.bangi@avanceservices.uk')
  })

  it('matches by address', () => {
    const result = filterContacts(CONTACTS, 'harperdb')
    expect(result.map((c) => c.address)).toEqual(['aleks@harperdb.io'])
  })

  it('is case-insensitive', () => {
    expect(filterContacts(CONTACTS, 'ALGOLIA')[0].name).toBe('Algolia')
  })

  it('ranks prefix matches above substring matches', () => {
    const data = [
      { address: 'a@b.com', name: 'Rajon Smith' }, // 'jon' is a substring
      { address: 'x@y.com', name: 'Jonathan Vance' }, // 'jon' is a prefix
    ]
    expect(filterContacts(data, 'jon').map((c) => c.name)).toEqual([
      'Jonathan Vance',
      'Rajon Smith',
    ])
  })

  it('drops an address that is already fully typed', () => {
    expect(filterContacts(CONTACTS, 'aleks@harperdb.io')).toEqual([])
  })

  it('caps the number of results', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ address: `user${i}@x.com`, name: `User ${i}` }))
    expect(filterContacts(many, 'user', 6)).toHaveLength(6)
  })
})
