// Filters the contact list for the composer "to" auto-suggest. Matches the
// query against BOTH the display name and the address (case-insensitive), so a
// user can type a person's name — unlike a native <datalist>, which only
// matches the address. Prefix matches rank above substring matches; an address
// the user has already typed in full is dropped (nothing left to suggest).
export function filterContacts(contacts, query, limit = 6) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return []

  const scored = []
  for (const contact of contacts) {
    const name = (contact.name || '').toLowerCase()
    const address = (contact.address || '').toLowerCase()
    if (address === q) continue // already fully entered
    const matches = name.includes(q) || address.includes(q)
    if (!matches) continue
    const startsWith = name.startsWith(q) || address.startsWith(q)
    scored.push({ contact, rank: startsWith ? 0 : 1 })
  }

  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.contact.name || a.contact.address).localeCompare(b.contact.name || b.contact.address),
  )
  return scored.slice(0, limit).map((s) => s.contact)
}
