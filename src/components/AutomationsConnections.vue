<script setup>
import { ref } from 'vue'

import {
  CLAUDE_CODE_ADD_COMMAND,
  CLAUDE_CODE_CALLBACK_PORT,
  CODEX_ADD_COMMAND,
  CODEX_CALLBACK_PORT,
  CODEX_CALLBACK_SETTING,
  CODEX_LOGIN_COMMAND,
  MCP_CLIENT_ID,
  MCP_ENDPOINT,
} from '../lib/mcpClients'

// The text most recently copied, so its button can say so for a moment.
const copied = ref('')
let copiedTimer = null

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch (error) {
    // Clipboard access can be refused; the text stays selectable on the page.
    console.error('Copy failed:', error)
    return
  }
  copied.value = text
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copied.value = ''
  }, 2000)
}
</script>

<template>
  <div class="connections-page" data-testid="automations-connections">
    <header class="connections-header">
      <h1>Connections</h1>
      <p>
        Connect Claude or Codex to Cookie's MCP server so it can work with your email, calendar,
        tasks and documents. You sign in through your browser with the account that owns your Cookie
        mailbox; there is no API key or token to paste.
      </p>
    </header>

    <section class="connections-card" aria-labelledby="connections-server">
      <h2 id="connections-server">Server details</h2>
      <dl class="connections-details">
        <div>
          <dt>Server URL</dt>
          <dd>
            <code>{{ MCP_ENDPOINT }}</code>
            <button type="button" class="connections-copy" @click="copy(MCP_ENDPOINT)">
              <span class="material-symbols-outlined" aria-hidden="true">{{
                copied === MCP_ENDPOINT ? 'check' : 'content_copy'
              }}</span>
              {{ copied === MCP_ENDPOINT ? 'Copied' : 'Copy' }}
              <span class="visually-hidden">server URL</span>
            </button>
          </dd>
        </div>
        <div>
          <dt>OAuth client ID</dt>
          <dd>
            <code>{{ MCP_CLIENT_ID }}</code>
            <button type="button" class="connections-copy" @click="copy(MCP_CLIENT_ID)">
              <span class="material-symbols-outlined" aria-hidden="true">{{
                copied === MCP_CLIENT_ID ? 'check' : 'content_copy'
              }}</span>
              {{ copied === MCP_CLIENT_ID ? 'Copied' : 'Copy' }}
              <span class="visually-hidden">OAuth client ID</span>
            </button>
          </dd>
        </div>
        <div>
          <dt>Transport</dt>
          <dd>Streamable HTTP, with OAuth sign-in</dd>
        </div>
      </dl>
      <p class="connections-hint">
        The client ID is public, not a secret, and there is no client secret.
      </p>
    </section>

    <section class="connections-card" aria-labelledby="connections-claude-code">
      <h2 id="connections-claude-code">Claude Code</h2>
      <ol class="connections-steps">
        <li>
          Add Cookie from your terminal:
          <div class="connections-command">
            <pre><code>{{ CLAUDE_CODE_ADD_COMMAND }}</code></pre>
            <button type="button" class="connections-copy" @click="copy(CLAUDE_CODE_ADD_COMMAND)">
              <span class="material-symbols-outlined" aria-hidden="true">{{
                copied === CLAUDE_CODE_ADD_COMMAND ? 'check' : 'content_copy'
              }}</span>
              {{ copied === CLAUDE_CODE_ADD_COMMAND ? 'Copied' : 'Copy' }}
              <span class="visually-hidden">Claude Code command</span>
            </button>
          </div>
          <code>--scope user</code> adds Cookie to every project; leave it out to add it to the
          current project only. The client ID and port {{ CLAUDE_CODE_CALLBACK_PORT }} are the ones
          Cookie has registered, so keep both as they are.
        </li>
        <li>
          Open Claude Code and run <code>/mcp</code>, select <code>cookie</code>, then choose
          <strong>Authenticate</strong>.
        </li>
        <li>Sign in in the browser window that opens.</li>
        <li>
          Run <code>claude mcp list</code> to confirm <code>cookie</code> is connected. To remove it
          later, run <code>claude mcp remove cookie</code>.
        </li>
      </ol>
    </section>

    <section class="connections-card" aria-labelledby="connections-claude">
      <h2 id="connections-claude">Claude desktop app and claude.ai</h2>
      <p>
        These use a custom connector, added in the app and shared by claude.ai, the desktop app and
        the mobile apps on the same Claude account. There is no command to run, and
        <code>claude_desktop_config.json</code> is not used: that file is for servers running on
        your own machine.
      </p>
      <ol class="connections-steps">
        <li>
          Open <strong>Settings</strong>, then <strong>Connectors</strong>, and choose
          <strong>Add custom connector</strong>.
        </li>
        <li>
          Name it <code>Cookie</code> and enter the server URL <code>{{ MCP_ENDPOINT }}</code>.
        </li>
        <li>
          Open <strong>Advanced settings</strong> and enter the OAuth client ID
          <code>{{ MCP_CLIENT_ID }}</code>. Leave the client secret empty.
        </li>
        <li>Choose <strong>Add</strong>, then <strong>Connect</strong>, and sign in.</li>
      </ol>
    </section>

    <section class="connections-card" aria-labelledby="connections-codex">
      <h2 id="connections-codex">Codex</h2>
      <ol class="connections-steps">
        <li>
          In <code>~/.codex/config.toml</code>, add this line at the top level, before any
          <code>[section]</code> heading. If the setting is already there, change its value:
          <div class="connections-command">
            <pre><code>{{ CODEX_CALLBACK_SETTING }}</code></pre>
            <button type="button" class="connections-copy" @click="copy(CODEX_CALLBACK_SETTING)">
              <span class="material-symbols-outlined" aria-hidden="true">{{
                copied === CODEX_CALLBACK_SETTING ? 'check' : 'content_copy'
              }}</span>
              {{ copied === CODEX_CALLBACK_SETTING ? 'Copied' : 'Copy' }}
              <span class="visually-hidden">Codex setting</span>
            </button>
          </div>
          Cookie only accepts sign-ins that return on port {{ CODEX_CALLBACK_PORT }}.
        </li>
        <li>
          Add Cookie from your terminal:
          <div class="connections-command">
            <pre><code>{{ CODEX_ADD_COMMAND }}</code></pre>
            <button type="button" class="connections-copy" @click="copy(CODEX_ADD_COMMAND)">
              <span class="material-symbols-outlined" aria-hidden="true">{{
                copied === CODEX_ADD_COMMAND ? 'check' : 'content_copy'
              }}</span>
              {{ copied === CODEX_ADD_COMMAND ? 'Copied' : 'Copy' }}
              <span class="visually-hidden">Codex add command</span>
            </button>
          </div>
        </li>
        <li>
          Sign in when the browser opens. If it does not, or you need to sign in again, run:
          <div class="connections-command">
            <pre><code>{{ CODEX_LOGIN_COMMAND }}</code></pre>
            <button type="button" class="connections-copy" @click="copy(CODEX_LOGIN_COMMAND)">
              <span class="material-symbols-outlined" aria-hidden="true">{{
                copied === CODEX_LOGIN_COMMAND ? 'check' : 'content_copy'
              }}</span>
              {{ copied === CODEX_LOGIN_COMMAND ? 'Copied' : 'Copy' }}
              <span class="visually-hidden">Codex login command</span>
            </button>
          </div>
          On a machine without a browser, add <code>--no-browser</code> and follow what it prints.
        </li>
        <li>
          Run <code>codex mcp list</code> to confirm <code>cookie</code> is signed in, and restart
          any open Codex session so it loads the connection.
        </li>
      </ol>
    </section>

    <section class="connections-card" aria-labelledby="connections-check">
      <h2 id="connections-check">Check the connection</h2>
      <p>
        Ask the assistant: “List my Cookie labels.” It uses <code>cookie_list_labels</code>, which
        reads and changes nothing. Read access covers listing, reading and searching; write access
        also covers changes, sending email included, so review what you grant when you sign in.
      </p>
      <p>
        Before an assistant can send an email it needs a one-off send confirmation from you. Create
        one under
        <router-link to="/settings/mcp-clients">Settings, MCP clients</router-link>.
      </p>
    </section>

    <section class="connections-card" aria-labelledby="connections-trouble">
      <h2 id="connections-trouble">If sign-in fails</h2>
      <ul class="connections-steps">
        <li>Use the full server URL, ending in <code>/mcp</code>.</li>
        <li>
          Keep the registered callback port: {{ CLAUDE_CODE_CALLBACK_PORT }} for Claude Code and
          {{ CODEX_CALLBACK_PORT }} for Codex.
        </li>
        <li>
          A forbidden (403) answer can mean the account you signed in with has no Cookie mailbox.
        </li>
        <li>
          If <code>cookie</code> is already configured, check or remove the existing entry before
          adding it again.
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.connections-page {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 32px 24px 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  font-size: 14px;
  line-height: 1.6;
}

.connections-header h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
}

.connections-header p,
.connections-card p {
  margin: 0;
  color: var(--text-secondary);
}

.connections-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
}

.connections-card h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.connections-card a {
  color: var(--text-blue);
}

.connections-details {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.connections-details > div {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
}

.connections-details dt {
  flex: 0 0 120px;
  color: var(--text-secondary);
}

.connections-details dd {
  margin: 0;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.connections-page code {
  padding: 1px 5px;
  border-radius: 4px;
  background-color: var(--bg-input);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.connections-steps {
  margin: 0;
  padding-left: 22px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* A command sits in its own block with Copy at its top right. */
.connections-command {
  position: relative;
  margin: 8px 0;
}

.connections-command pre {
  margin: 0;
  padding: 12px 92px 12px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background-color: var(--bg-input);
  white-space: pre-wrap;
}

.connections-command pre code {
  padding: 0;
  background: none;
}

.connections-command .connections-copy {
  position: absolute;
  top: 8px;
  right: 8px;
}

.connections-copy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background-color: var(--bg-card);
  color: var(--text-primary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.connections-copy:hover,
.connections-copy:focus-visible {
  background-color: var(--bg-hover);
}

.connections-copy .material-symbols-outlined {
  font-size: 14px;
  color: var(--text-secondary);
}

.connections-hint {
  font-size: 13px;
}
</style>
