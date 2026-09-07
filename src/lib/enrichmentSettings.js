export const enrichmentModelOptions = [
  { value: 'gpt-5-nano', label: 'GPT-5 nano', hint: 'Lowest cost; recommended for frequent runs.' },
  {
    value: 'gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    hint: 'More capable, with a higher per-run cost.',
  },
  { value: 'gpt-4.1-nano', label: 'GPT-4.1 nano', hint: 'Low-cost alternative.' },
]

export const enrichmentDayOptions = [
  { value: 'mon', label: 'Mon' },
  { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri' },
  { value: 'sat', label: 'Sat' },
  { value: 'sun', label: 'Sun' },
]

export const enrichmentIntervalOptions = [1, 2, 3, 4, 6, 12]

export const defaultEnrichmentSettings = Object.freeze({
  model: 'gpt-5-nano',
  schedule: Object.freeze({
    enabled: true,
    days: Object.freeze(enrichmentDayOptions.map(({ value }) => value)),
    startHour: 9,
    endHour: 19,
    intervalHours: 1,
    timezone: 'Europe/London',
  }),
})

export function cloneEnrichmentSettings(settings = defaultEnrichmentSettings) {
  return {
    model: settings.model,
    schedule: { ...settings.schedule, days: [...settings.schedule.days] },
  }
}

export function parseEnrichmentSettings(payload) {
  const input = payload?.enrichmentSettings ?? payload
  const model = enrichmentModelOptions.some(({ value }) => value === input?.model)
    ? input.model
    : defaultEnrichmentSettings.model
  const schedule = input?.schedule
  const days = Array.isArray(schedule?.days)
    ? enrichmentDayOptions.map(({ value }) => value).filter((day) => schedule.days.includes(day))
    : []
  return {
    model,
    schedule: {
      enabled: [true, false].includes(schedule?.enabled)
        ? schedule.enabled
        : defaultEnrichmentSettings.schedule.enabled,
      days: days.length ? days : [...defaultEnrichmentSettings.schedule.days],
      startHour:
        Number.isInteger(schedule?.startHour) && schedule.startHour >= 0 && schedule.startHour <= 23
          ? schedule.startHour
          : defaultEnrichmentSettings.schedule.startHour,
      endHour:
        Number.isInteger(schedule?.endHour) && schedule.endHour >= 0 && schedule.endHour <= 23
          ? schedule.endHour
          : defaultEnrichmentSettings.schedule.endHour,
      intervalHours: enrichmentIntervalOptions.includes(schedule?.intervalHours)
        ? schedule.intervalHours
        : defaultEnrichmentSettings.schedule.intervalHours,
      timezone: 'Europe/London',
    },
  }
}
