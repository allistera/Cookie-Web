const MINUTE = 60_000
const SLOT_STEP_MINUTES = 15
const dateFormatters = new Map()
const wallFormatters = new Map()
const slotFormatters = new Map()

function cachedFormatter(cache, timeZone, factory) {
  let formatter = cache.get(timeZone)
  if (!formatter) {
    formatter = factory(timeZone)
    if (cache.size >= 32) cache.delete(cache.keys().next().value)
    cache.set(timeZone, formatter)
  }
  return formatter
}

export function validAvailabilityZone(zone) {
  if (!zone) return false
  if (dateFormatters.has(zone)) return true
  try {
    cachedFormatter(
      dateFormatters,
      zone,
      (tz) =>
        new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }),
    ).format()
    return true
  } catch {
    return false
  }
}

export function availabilityDate(instant, timeZone) {
  const parts = cachedFormatter(
    dateFormatters,
    timeZone,
    (tz) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
  ).formatToParts(instant)
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
  const durationMinutes = Number(duration)
  if (![15, 30, 45, 60, 90, 120].includes(durationMinutes) || workStart >= workEnd) return []
  if (
    data.busy.some((b) => !Number.isFinite(b.start) || !Number.isFinite(b.end) || b.end <= b.start)
  )
    return []
  const formatter = cachedFormatter(
    wallFormatters,
    timeZone,
    (tz) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
  )
  const wall = (instant) => {
    const parts = formatter.formatToParts(instant)
    const part = (type) => parts.find((p) => p.type === type)?.value
    return {
      date: `${part('year')}-${part('month')}-${part('day')}`,
      time: `${part('hour')}:${part('minute')}`,
    }
  }
  // Merge busy intervals once so overlap checks run in linear time via a cursor.
  const sortedBusy = [...data.busy].sort((a, b) => a.start - b.start || a.end - b.end)
  const mergedBusy = []
  for (const interval of sortedBusy) {
    const prev = mergedBusy[mergedBusy.length - 1]
    if (prev && interval.start <= prev.end) prev.end = Math.max(prev.end, interval.end)
    else mergedBusy.push({ start: interval.start, end: interval.end })
  }
  const occurrences = new Map()
  const candidates = []
  for (let instant = start; instant <= end; instant += SLOT_STEP_MINUTES * MINUTE) {
    const value = { instant, ...wall(instant) }
    const key = `${value.date}T${value.time}`
    occurrences.set(key, (occurrences.get(key) || 0) + 1)
    candidates.push(value)
  }
  const slots = []
  const durationMs = durationMinutes * MINUTE
  const stepSlots = durationMinutes / SLOT_STEP_MINUTES
  let previousEnd = 0
  let busyIndex = 0
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i]
    const slotEnd = candidate.instant + durationMs
    if (candidate.instant < now || candidate.instant < previousEnd || slotEnd > end) continue
    const last = candidates[i + stepSlots] ?? wall(slotEnd)
    if (candidate.date !== last.date || candidate.time < workStart || last.time > workEnd) continue
    if (
      occurrences.get(`${candidate.date}T${candidate.time}`) !== 1 ||
      occurrences.get(`${last.date}T${last.time}`) !== 1
    )
      continue
    if (
      new Date(`${last.date}T${last.time}:00Z`) -
        new Date(`${candidate.date}T${candidate.time}:00Z`) !==
      durationMs
    )
      continue
    while (busyIndex < mergedBusy.length && mergedBusy[busyIndex].end <= candidate.instant) {
      busyIndex += 1
    }
    if (busyIndex < mergedBusy.length && mergedBusy[busyIndex].start < slotEnd) continue
    slots.push({ start: candidate.instant, end: slotEnd })
    previousEnd = slotEnd
    if (slots.length === 100) break
  }
  return slots
}

export function formatAvailabilitySlot(slot, timeZone) {
  const { date, time } = cachedFormatter(slotFormatters, timeZone, (tz) => ({
    date: new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }),
    time: new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'shortOffset',
      hourCycle: 'h23',
    }),
  }))
  return `${date.format(slot.start)}, ${time.format(slot.start)} – ${time.format(slot.end)}`
}

export function availabilityProposal(slots, timeZone, duration) {
  return `Proposed meeting times (${duration} minutes each; timezone: ${timeZone}):\n\n${slots.map((slot) => `• ${formatAvailabilitySlot(slot, timeZone)}`).join('\n')}\n\nThese are proposals only, not reserved times. Please let me know which works for you.`
}
