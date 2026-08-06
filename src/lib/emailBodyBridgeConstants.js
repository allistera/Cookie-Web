// Shared between EmailBody.vue (which listens) and emailBodyBridge.js (which
// sends) so the two can never drift out of sync on the postMessage protocol.
export const BRIDGE_SOURCE = 'cookie-email-body'
export const RESIZE_INTERVAL_MS = 250
