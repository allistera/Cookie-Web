// Base URLs for Cookie's own Cloudflare Workers (cookie-web-labels,
// cookie-web-messages, cookie-web-tasks, in the separate Cookie-Worker repo),
// called directly from the browser. Public identifiers, not secrets — same
// treatment as VITE_AUTH0_DOMAIN. Each Worker's CORS allowlist
// (Cookie-Worker's shared/cors.js) permits this app's production origin,
// any localhost port, and *.vercel.app preview deployments.
//
// Not on custom domains yet — each Worker's wrangler.jsonc sets
// workers_dev: true. Update these three lines (and each Worker's
// ALLOWED_ORIGIN var) together when they move.
export const LABELS_API_URL = 'https://cookie-web-labels.cloudflare-581.workers.dev'
export const MESSAGES_API_URL = 'https://cookie-web-messages.cloudflare-581.workers.dev'
export const TASKS_API_URL = 'https://cookie-web-tasks.cloudflare-581.workers.dev'
