<script setup>
import { MCP_API_URL } from '../lib/apiWorkers'

const endpoint = `${MCP_API_URL}/mcp`
// Public OAuth application identifier and registered callback ports; not a secret.
// Keep aligned with Cookie-Worker README's "Connect a client" instructions.
const clientId = 'rTBvArPhtT8s9dGwT8mODMphNrngYlHb'
const claudeCommand = `claude mcp add --transport http --scope user --client-id ${clientId} --callback-port 8765 cookie ${endpoint}`
const codexCommand = `codex mcp add cookie --url ${endpoint} --oauth-client-id ${clientId}`
</script>

<template>
  <section class="settings-section mcp-settings">
    <h3 class="settings-section-title">MCP clients</h3>
    <p class="settings-section-hint">
      Connect your AI assistant to Cookie to work with email, calendar, tasks and documents. Sign in
      through your browser with the account that owns your Cookie mailbox. No API key or token is
      needed.
    </p>
    <p>Server URL (Streamable HTTP): <code>{{ endpoint }}</code></p>

    <h4>Claude Code</h4>
    <ol>
      <li>Run this command in your terminal:</li>
    </ol>
    <pre><code>{{ claudeCommand }}</code></pre>
    <p>
      Open Claude Code, run <code>/mcp</code>, select <code>cookie</code>, then choose
      <strong>Authenticate</strong> and complete browser sign-in. This adds Cookie to every project;
      omit <code>--scope user</code> to add it only to the current project.
    </p>

    <h4>Codex</h4>
    <ol>
      <li>
        In <code>~/.codex/config.toml</code>, add the following at the top level, before any
        <code>[section]</code> headings. If this setting already exists, update it:
        <pre><code>mcp_oauth_callback_port = 8766</code></pre>
      </li>
      <li>
        Add Cookie from your terminal:
        <pre><code>{{ codexCommand }}</code></pre>
      </li>
      <li>
        Complete browser sign-in when prompted. If you still need to sign in, run:
        <pre><code>codex mcp login cookie</code></pre>
      </li>
    </ol>
    <p>
      Restart an open Codex session to load the connection. On a machine without a browser, use
      <code>codex mcp login cookie --no-browser</code> and follow the displayed instructions.
    </p>

    <h4>Other MCP clients</h4>
    <p>
      Choose a remote HTTP server with OAuth, use the server URL above and, if requested, enter the
      public client ID <code>{{ clientId }}</code>. No client secret is needed. Additional clients
      may need their callback URL registered by the Cookie administrator.
    </p>

    <h4>Check your connection</h4>
    <p>
      Ask your assistant: “List my Cookie labels.” This uses <code>cookie_list_labels</code>
      without changing your data. Read access allows listing and searching; write access also allows
      changes, including sending email. Review the permissions you grant.
    </p>
    <p>
      If sign-in fails, confirm you used the full URL ending in <code>/mcp</code> and the registered
      callback port (8765 for Claude Code, 8766 for Codex). A forbidden (403) response can mean the
      signed-in account has no Cookie mailbox. If Cookie is already configured, check the existing
      entry before adding it again.
    </p>
  </section>
</template>

<style scoped>
.mcp-settings h4 {
  margin: 24px 0 8px;
}
.mcp-settings p,
.mcp-settings li {
  line-height: 1.6;
}
.mcp-settings code {
  overflow-wrap: anywhere;
}
.mcp-settings pre {
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-input);
  white-space: pre-wrap;
}
.mcp-settings ol {
  padding-left: 24px;
}
</style>
