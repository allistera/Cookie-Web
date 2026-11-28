import { MCP_API_URL } from './apiWorkers'

// What an MCP client needs to reach Cookie's MCP server, shown on Automations >
// Connections.
// Keep aligned with Cookie-Worker README's "Connect a client" instructions.
export const MCP_ENDPOINT = `${MCP_API_URL}/mcp`

// Public OAuth application identifier; not a secret.
export const MCP_CLIENT_ID = 'rTBvArPhtT8s9dGwT8mODMphNrngYlHb'

// The callback ports registered in Auth0 for each command-line client.
export const CLAUDE_CODE_CALLBACK_PORT = 8765
export const CODEX_CALLBACK_PORT = 8766

export const CLAUDE_CODE_ADD_COMMAND = `claude mcp add --transport http --scope user --client-id ${MCP_CLIENT_ID} --callback-port ${CLAUDE_CODE_CALLBACK_PORT} cookie ${MCP_ENDPOINT}`
export const CODEX_CALLBACK_SETTING = `mcp_oauth_callback_port = ${CODEX_CALLBACK_PORT}`
export const CODEX_ADD_COMMAND = `codex mcp add cookie --url ${MCP_ENDPOINT} --oauth-client-id ${MCP_CLIENT_ID}`
export const CODEX_LOGIN_COMMAND = 'codex mcp login cookie'
