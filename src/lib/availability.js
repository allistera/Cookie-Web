const MINUTE = 60_000

export function validAvailabilityZone(zone) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format()
    return Boolean(zone)
  } catch {
    return false
  }
}

export function availabilityDate(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const part = (type) => parts.find((p) => p.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

// Enumerate real instants, then filter by working hours in the chosen output
// zone. Missing hours never occur; repeated wall times are removed. We also
// exclude slots crossing an offset change so their displayed duration is clear.
export function suggestAvailability(
  data,
  { timeZone, duration, workStart, workEnd },
  now = Date.now(),
) {
  if (!data?.complete || !Array.isArray(data.busy) || !validAvailabilityZone(timeZone)) return []
  const start = data.window?.start
  const end = data.window?.end
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 32 * 86_400_000
  )
    return []
  if (![15, 30, 45, 60, 90, 120].includes(Number(duration)) || workStart >= workEnd) return []
  if (
    data.busy.some((b) => !Number.isFinite(b.start) || !Number.isFinite(b.end) || b.end <= b.start)
  )
    return []
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const wall = (instant) => {
    const parts = formatter.formatToParts(instant)
    const part = (type) => parts.find((p) => p.type === type)?.value
    return {
      date: `${part('year')}-${part('month')}-${part('day')}`,
      time: `${part('hour')}:${part('minute')}`,
    }
  }
  const occurrences = new Map()
  const candidates = []
  for (let instant = start; instant <= end; instant += 15 * MINUTE) {
    const value = { instant, ...wall(instant) }
    const key = `${value.date}T${value.time}`
    occurrences.set(key, (occurrences.get(key) || 0) + 1)
    candidates.push(value)
  }
  const slots = []
  let previousEnd = 0
  for (const candidate of candidates) {
    const slotEnd = candidate.instant + Number(duration) * MINUTE
    if (candidate.instant < now || candidate.instant < previousEnd || slotEnd > end) continue
    const last = wall(slotEnd)
    if (candidate.date !== last.date || candidate.time < workStart || last.time > workEnd) continue
    if (
      occurrences.get(`${candidate.date}T${candidate.time}`) !== 1 ||
      occurrences.get(`${last.date}T${last.time}`) !== 1
    )
      continue
    if (
      new Date(`${last.date}T${last.time}:00Z`) -
        new Date(`${candidate.date}T${candidate.time}:00Z`) !==
      Number(duration) * MINUTE
    )
      continue
    if (data.busy.some((busy) => candidate.instant < busy.end && slotEnd > busy.start)) continue
    slots.push({ start: candidate.instant, end: slotEnd })
    previousEnd = slotEnd
    if (slots.length === 100) break
  }
  return slots
}

export function formatAvailabilitySlot(slot, timeZone) {
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(slot.start)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'shortOffset',
    hourCycle: 'h23',
  })
  return `${date}, ${time.format(slot.start)} – ${time.format(slot.end)}`
}

export function availabilityProposal(slots, timeZone, duration) {
  return `Proposed meeting times (${duration} minutes each; timezone: ${timeZone}):\n\n${slots.map((slot) => `• ${formatAvailabilitySlot(slot, timeZone)}`).join('\n')}\n\nThese are proposals only, not reserved times. Please let me know which works for you.`
}
