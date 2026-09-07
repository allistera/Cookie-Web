export const autoArchiveCategories = [
  {
    key: 'marketing',
    label: 'Marketing',
    description: 'Promotions, sales offers and bulk newsletters.',
  },
  {
    key: 'coldPitches',
    label: 'Cold pitches',
    description: 'Unsolicited sales or service outreach, not ongoing conversations.',
  },
  {
    key: 'socialNoise',
    label: 'Social noise',
    description: 'Likes, follows and activity digests, not direct messages or security alerts.',
  },
]

export function parseAutoArchive(payload) {
  const settings = payload?.autoArchive
  if (
    !settings ||
    !autoArchiveCategories.every(({ key }) => [true, false].includes(settings[key]))
  ) {
    throw new Error('Invalid auto archive settings response')
  }
  return Object.fromEntries(autoArchiveCategories.map(({ key }) => [key, settings[key]]))
}
