// A full-page navigation away from Cookie (the Google consent screen, for
// one). Components take it through inject() under NAVIGATE_TO so a test can
// provide a stand-in: jsdom neither performs navigations nor lets
// window.location be stubbed.
export const NAVIGATE_TO = 'navigateTo'

export function navigateTo(url) {
  globalThis.location.assign(url)
}
