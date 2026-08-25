// Base URLs for Cookie's own Cloudflare Workers (cookie-web-labels,
// cookie-web-messages, cookie-web-notifications, cookie-web-tasks, in the
// separate Cookie-Worker repo), called directly from the browser. Public
// identifiers, not secrets — same treatment as VITE_AUTH0_DOMAIN. Each
// Worker's CORS allowlist (Cookie-Worker's shared/cors.js) permits this
// app's production origin, any localhost port, and *.vercel.app preview
// deployments.
//
// Custom domains (each Worker's wrangler.jsonc routes) — update these lines
// together if a Worker's domain ever changes. Each Worker also still
// answers on its own workers.dev URL, kept for debugging.
export const LABELS_API_URL = 'https://labels-api.infinitywave.online'
export const MESSAGES_API_URL = 'https://messages-api.infinitywave.online'
export const NOTIFICATIONS_API_URL = 'https://notifications-api.infinitywave.online'
export const RECEIPTS_API_URL = 'https://receipts-api.infinitywave.online'
export const TASKS_API_URL = 'https://tasks-api.infinitywave.online'
