# October 2026 review remediation

These changes address findings F01–F12 across Cookie-Web, Cookie-Worker and
Cookie-Docs. They must be rolled out together; merging source does not apply
database migrations.

## Deployment order

1. Back up the database and review migrations 0102–0104 with the operator.
   Apply them through the normal migration process before deploying the new
   Workers. No production migration is run by this change.
2. Deploy the calendar, tasks, send, emails and ingest Worker changes, including
   their cron configuration. The send ledger deliberately fails closed if its
   schema is unavailable.
3. Deploy Cookie-Web. Existing Google authorization attempts must be restarted;
   the old unbound OAuth transaction cannot complete.
4. Verify owned Google linking, Processing mail, a draft recovery after a
   temporary save failure, and one send in an isolated test account.
5. Check delivery reconciliation, object-cleanup backlog and search drift logs.
   Investigate uncertain sends before any manual replacement send.

Keep the additive tables/columns on application rollback. Do not revert to an
unjournaled sender while unresolved delivery intents exist. Migration 0104
marks legacy ambiguous scheduled attempts uncertain instead of inventing a
new safe retry window.

## Behavior by finding

| Finding | Change                                                                                                                                                                        |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01     | Google callback stages an encrypted code. Completion requires the initiating Cookie account, a browser-held verifier and a fresh callback-only handle.                        |
| F02     | Offline changes survive temporary, authentication and permanent HTTP errors. A review UI offers retry or explicit discard; revision/account checks protect concurrent edits.  |
| F03     | Owner-scoped draft recovery preserves local content separately from server saves and conflicts. Drafts exposes local copies and save failures.                                |
| F04     | Processing mail is readable through its own paginated folder even when classification is deferred or has stopped. Inbox and sender-screening policy remains in place.         |
| F05     | A durable delivery ledger freezes send intent, bounds ambiguous provider retries and repairs accepted sends without sending again. Uncertain delivery is surfaced explicitly. |
| F06     | Bounded periodic document/task search repair supplements the existing message sweep and weekly repair.                                                                        |
| F07     | Durable deletion jobs and document-image references make object cleanup retryable and preserve shared images.                                                                 |
| F08     | Shared modal focus handling contains keyboard navigation and restores the opener.                                                                                             |
| F09     | Mobile Tasks navigation can collapse so the list has the screen width; desktop resizing remains available.                                                                    |
| F10     | History refreshes after successful writes, once per bulk operation, and on explicit external sync/visibility changes. Reads do not invalidate history.                        |
| F11     | Patched dependencies and CI auditing prevent silent recurrence. Cookie-Docs documents one unpatched, CLI-only transitive advisory with an expiring exception.                 |
| F12     | Multipart limits count streamed bytes including framing and extra parts, reject duplicate/unknown fields, and check upload quota before parsing.                              |

## Dependency compatibility

Web updates shell-quote 1.10.0 to 1.12.0. A scoped Sass override replaces
Excalidraw's 1.51.0 with 1.105.2, eliminating the old Chokidar/braces chain
without downgrading Excalidraw. Remove the override when Excalidraw updates it.

KaTeX moves from 0.16.47 to 0.18.2 to fix
[GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7).
The [0.17 release](https://github.com/KaTeX/KaTeX/releases/tag/v0.17.0)
changes the internal `__defineFunction` API, which Cookie does not use.
The [0.18 release](https://github.com/KaTeX/KaTeX/releases/tag/v0.18.0)
prefixes internal CSS classes. Cookie has no custom selectors for those
internal classes; the package's matching stylesheet must accompany its renderer.
Verify formula rendering in Excalidraw/Mermaid after deployment.

Worker updates source-map-js 1.2.1 to 1.2.2. Docs records its exact updates,
parser-major compatibility and the unresolved sprintf-js advisory in
`Cookie-Docs/SECURITY.md`.

Optional mail-settings actions are now loaded on demand to keep the existing
entry-bundle budget while adding recovery functionality. A generation check
prevents a delayed settings import from starting under another account.

## Verification

Local verification uses the existing lint, formatting, type and build commands.
Unit/integration and browser suites run in GitHub Actions as required by
AGENTS.md. Check the linked pull requests for results from the final commits.
No production data or services are used for regression tests.
