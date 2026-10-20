// Guard the lazy boundary: a click made by one account must never start an
// action under a different account while its chunk is loading.
export async function invokeMailSettings(store, name, args) {
  const owner = store.composeOwnerSub
  const generation = store.composeGeneration
  const { mailSettingsActions } = await import('../stores/mailSettingsActions')
  if (owner !== store.composeOwnerSub || generation !== store.composeGeneration) return null
  return mailSettingsActions[name].apply(store, args)
}
