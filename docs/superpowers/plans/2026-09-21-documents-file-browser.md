# Documents File Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Documents dashboard into a per-folder browser with grid and list layouts that also holds uploaded files stored privately in R2.

**Architecture:** A new `document_files` table and a `/files` route family on the cookie-web-tasks Worker (Cookie-Worker repo) store file metadata in Postgres and bytes in a private R2 bucket, streamed back only through the authenticated Worker. In Cookie-Web, the Pinia documents store gains file state and actions; a new `DocumentsBrowser.vue` component renders one folder's subfolders, documents and files, and a new `FilePreview.vue` shows images and PDFs. Existing document features are untouched.

**Tech Stack:** Cloudflare Workers (JavaScript, postgres.js, R2 binding, vitest), Vue 3 + Pinia + vue-router (JavaScript, vitest + @vue/test-utils, Playwright e2e), Supabase Postgres migrations.

**Spec:** `docs/superpowers/specs/2026-09-21-documents-file-browser-design.md`

## Global Constraints

- Upload cap: 25 MB per file, enforced client-side and on the Worker (from `Content-Length` before reading and from the bytes after).
- Inline preview only for `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `application/pdf`; these five are the only sniffed types and the only types ever served `inline`.
- R2 bucket name `cookie-files`, binding name `FILES`, object key `<user_id>/<file uuid>` (never a client-supplied name).
- Local storage key for the layout: `cookie-documents-layout`; values `grid` (default) or `list`.
- Preview route `/documents/file/:fileId` is declared before `/documents/:id?`.
- Files are never searchable, taggable, starred or shown to the document AI.
- Both repos: Prettier is the formatter and `format:check` gates CI; run `npm run lint`, `npm run format:check`, `npm run typecheck` (Worker) / `npm run type-check` if present (Web) and the unit tests before every commit.
- Cookie-Worker is a colocated jj repo: commit with `jj commit -m`, move `main` with `jj bookmark set main -r @-`, push with `jj git push --bookmark main`, then confirm with `git ls-remote origin refs/heads/main`. Worker deploys are manual: `gh workflow run deploy.yml -f worker=cookie-web-tasks`. Cookie-Web is plain git and deploys on push to main.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File structure

**Cookie-Worker (`workers/cookie-web-tasks`)**

- Create `src/files.js`: everything about files. Exports `MAX_FILE_BYTES`, `sniffFileType`, `contentDisposition`, `listFiles`, `getFile`, `uploadFile`, `getFileContent`, `updateFile`, `deleteFile`.
- Modify `src/documents.js`: export `fetchOwnedFolder` (currently module-private).
- Modify `src/worker.js`: dispatch `/files`, `/files/:id`, `/files/:id/content`.
- Modify `src/sentry.js`: `TasksEnv` gains `FILES?: R2Bucket`.
- Modify `wrangler.jsonc`: `r2_buckets` binding. Regenerate `worker-configuration.d.ts` with `npm run types -- cookie-web-tasks` (CI runs `npm run types -- --all --check`).
- Create `test/files.test.js`; modify `test/worker.test.js`.
- Modify `README.md` (route table row for cookie-web-tasks).

**Cookie-Web**

- Create `migrations/0076_document_files.sql`.
- Create `src/lib/documentFiles.js`: pure helpers (`MAX_UPLOAD_BYTES`, `fileFolderKey`, `isPreviewable`, `fileKind`, `fileIcon`, `formatBytes`, `folderContents`, `folderBreadcrumb`).
- Create `src/lib/documentsLayout.js`: `getStoredLayout`, `saveLayout`.
- Modify `src/stores/documents.js`: `files`, `filePages`, `uploads` state; `filesRequest`, `loadFiles`, `loadFile`, `uploadFiles`, `uploadFile`, `dismissUpload`, `renameFile`, `moveFile`, `deleteFile`, `fetchFileBlob`; `deleteFolder` resets `filePages`.
- Create `src/components/DocumentsBrowser.vue`: breadcrumb, toolbar (layout toggle, upload), grid/list items, kebab menu, drag-and-drop, upload placeholders.
- Create `src/components/FilePreview.vue`: image or PDF preview with download and close.
- Modify `src/views/DocumentsView.vue`: render the browser for the folder-scoped default view, the preview for `route.params.fileId`, keep the table for starred/tag/search.
- Modify `src/components/DocumentsSidebar.vue`: folder click also navigates the browser; drops accept browser-originated items.
- Modify `src/router/index.js`: add `/documents/file/:fileId` before `/documents/:id?`.
- Modify `src/App.vue`: the Documents sidebar also shows for route name `document-file`.
- Modify `vite.config.js`: `/files` stub in the e2e tasks API.
- Tests: `src/lib/__tests__/documentFiles.spec.js`, `src/lib/__tests__/documentsLayout.spec.js`, additions to `src/stores/__tests__/documents.spec.js`, `src/components/__tests__/DocumentsBrowser.spec.js`, `src/components/__tests__/DocumentsSidebar.spec.js` additions, `e2e/documents.spec.js` updates.
- Docs: `../Cookie-Docs/docs/02-components/01-cookie-web.mdx` (Documents section) and `../Cookie-Docs/docs/05-operations.mdx` (R2 bucket line).

---

### Task 1: R2 bucket, binding and migration

**Files:**

- Modify: `Cookie-Worker/workers/cookie-web-tasks/wrangler.jsonc`
- Modify: `Cookie-Worker/workers/cookie-web-tasks/src/sentry.js`
- Regenerate: `Cookie-Worker/workers/cookie-web-tasks/worker-configuration.d.ts`
- Create: `Cookie-Web/migrations/0076_document_files.sql`

**Interfaces:**

- Produces: `env.FILES` (R2Bucket) on the Worker; table `document_files` with the columns in the spec.

- [ ] **Step 1: Create the bucket**

Run from `Cookie-Worker/workers/cookie-web-tasks`:

```bash
npx wrangler r2 bucket create cookie-files
```

Expected: "Created bucket 'cookie-files'".

- [ ] **Step 2: Add the binding**

In `wrangler.jsonc`, after the `"services"` line add:

```jsonc
  "r2_buckets": [{ "binding": "FILES", "bucket_name": "cookie-files" }],
```

- [ ] **Step 3: Regenerate types and check them**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Worker && npm run types -- cookie-web-tasks && npm run types -- cookie-web-tasks --check
```

Expected: `worker-configuration.d.ts` now declares `FILES: R2Bucket` and the check passes.

- [ ] **Step 4: Extend TasksEnv**

In `src/sentry.js`, inside the `TasksEnv` typedef add a line after `BLOB_READ_WRITE_TOKEN?: string,`:

```js
 *   FILES?: R2Bucket,
```

- [ ] **Step 5: Write the migration**

Create `Cookie-Web/migrations/0076_document_files.sql`:

```sql
-- Uploaded files that live in the Documents folder tree next to documents.
-- Bytes live in the private R2 bucket cookie-files under object_key; this
-- table is the metadata and the ownership check. Files follow the document
-- rule on folder deletion: they fall back to the root rather than being
-- destroyed with the folder.
BEGIN;

CREATE TABLE public.document_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  folder_id   uuid REFERENCES public.document_folders(id) ON DELETE SET NULL,
  name        text NOT NULL,
  mime_type   text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes  bigint NOT NULL,
  object_key  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX document_files_folder_idx
  ON public.document_files (user_id, folder_id, created_at DESC);

ALTER TABLE public.document_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.document_files FROM anon, authenticated;

COMMIT;
```

- [ ] **Step 6: Apply the migration to Supabase now**

The `Migrate Database` workflow runs on push to main, but the Worker deploy in Task 4 must find the table. Apply it directly with the Supabase MCP `apply_migration` tool on project `gnoryopdzknroqgqbxrh`, name `0076_document_files`, with the SQL above (without BEGIN/COMMIT, which the tool wraps). Then verify:

```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'document_files' ORDER BY ordinal_position;
```

Expected: nine columns.

- [ ] **Step 7: Commit both repos**

Cookie-Worker:

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Worker && npm run format:check && jj commit -m "cookie-web-tasks: bind the private cookie-files R2 bucket

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Cookie-Web:

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Web && git add migrations/0076_document_files.sql && git commit -m "migrations: document_files for uploaded files in the Documents tree

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Worker file module (sniff, list, upload, content, update, delete)

**Files:**

- Create: `Cookie-Worker/workers/cookie-web-tasks/src/files.js`
- Modify: `Cookie-Worker/workers/cookie-web-tasks/src/documents.js` (export `fetchOwnedFolder`)
- Test: `Cookie-Worker/workers/cookie-web-tasks/test/files.test.js`

**Interfaces:**

- Consumes: `createMockSql` from `test/helpers.js`; `cleanText`, `fetchOwnedFolder` from `src/documents.js`; `allowRequest(sql, userId, scope, { limit, windowMs })` from `src/rateLimit.js`.
- Produces (all return `Response`):
  - `listFiles(sql, userId, url)` → `{ files }`
  - `getFile(sql, userId, id)` → `{ file }` or 404
  - `uploadFile(request, sql, userId, env, deps = { allowRequest })` → 201 `{ file }`
  - `getFileContent(sql, userId, id, env)` → bytes
  - `updateFile(sql, userId, id, body)` → `{ file }`
  - `deleteFile(sql, userId, id, env)` → 204
  - `sniffFileType(buffer)` → `'image/png' | ... | 'application/pdf' | null`
  - `contentDisposition(name, inline)` → header string
  - `MAX_FILE_BYTES = 25 * 1024 * 1024`
- File row shape: `{ id, folder_id, name, mime_type, size_bytes, created_at, updated_at }` (never `object_key` or `user_id`).

- [ ] **Step 1: Export fetchOwnedFolder**

In `src/documents.js` change `function fetchOwnedFolder(sql, userId, id) {` to `export function fetchOwnedFolder(sql, userId, id) {`.

- [ ] **Step 2: Write the failing tests**

Create `test/files.test.js`:

```js
import { describe, expect, it, vi } from 'vitest'
import { createMockSql } from './helpers.js'
import {
  MAX_FILE_BYTES,
  contentDisposition,
  deleteFile,
  getFile,
  getFileContent,
  listFiles,
  sniffFileType,
  updateFile,
  uploadFile,
} from '../src/files.js'

const USER = 'user-1'
const FILE_ID = '33333333-3333-4333-8333-333333333333'
const FOLDER_ID = '44444444-4444-4444-8444-444444444444'
const ROW = {
  id: FILE_ID,
  folder_id: null,
  name: 'notes.pdf',
  mime_type: 'application/pdf',
  size_bytes: 5,
  object_key: `${USER}/${FILE_ID}`,
  created_at: 't0',
  updated_at: 't0',
}
const PUBLIC_ROW = (({ object_key: _key, ...rest }) => rest)(ROW)

function pdfBytes() {
  return new TextEncoder().encode('%PDF-1.4 x')
}

function pngBytes() {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
}

/** @param {{name?: string, type?: string, bytes?: Uint8Array, folder?: string, field?: string}} [opts] */
function uploadRequest({
  name = 'notes.pdf',
  type = 'application/pdf',
  bytes = pdfBytes(),
  folder,
  field = 'file',
} = {}) {
  const payload = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(payload).set(bytes)
  const form = new FormData()
  form.set(field, new File([payload], name, { type }))
  if (folder) form.set('folder', folder)
  return new Request('https://cookie-web-tasks.example/files', { method: 'POST', body: form })
}

function r2() {
  return {
    put: vi.fn(async () => ({})),
    get: vi.fn(),
    delete: vi.fn(async () => undefined),
  }
}

describe('sniffFileType', () => {
  it('recognises a PDF', () => {
    expect(sniffFileType(pdfBytes().buffer)).toBe('application/pdf')
  })
  it('recognises a PNG', () => {
    expect(sniffFileType(pngBytes().buffer)).toBe('image/png')
  })
  it('returns null for anything else', () => {
    expect(sniffFileType(new Uint8Array([1, 2, 3, 4, 5]).buffer)).toBeNull()
  })
})

describe('contentDisposition', () => {
  it('encodes non-ASCII names per RFC 5987 and quotes the ASCII fallback', () => {
    expect(contentDisposition('résumé "final".pdf', true)).toBe(
      `inline; filename="r_sum_ _final_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22.pdf`,
    )
    expect(contentDisposition('a.zip', false)).toBe(
      `attachment; filename="a.zip"; filename*=UTF-8''a.zip`,
    )
  })
})

describe('listFiles', () => {
  it('lists the root when no folder is given', async () => {
    const sql = createMockSql([[PUBLIC_ROW]])
    const response = await listFiles(sql, USER, new URL('https://x/files'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ files: [PUBLIC_ROW] })
    expect(sql.calls[0].text).toContain('folder_id IS NULL')
  })
  it('lists a folder by id', async () => {
    const sql = createMockSql([[]])
    await listFiles(sql, USER, new URL(`https://x/files?folder=${FOLDER_ID}`))
    expect(sql.calls[0].values).toContain(FOLDER_ID)
  })
  it('rejects a malformed folder id', async () => {
    const response = await listFiles(createMockSql(), USER, new URL('https://x/files?folder=nope'))
    expect(response.status).toBe(400)
  })
})

describe('uploadFile', () => {
  it('writes the object then the row and returns the row', async () => {
    const env = { FILES: r2() }
    const sql = createMockSql([[PUBLIC_ROW]])
    const response = await uploadFile(uploadRequest(), sql, USER, env, {
      allowRequest: async () => true,
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ file: PUBLIC_ROW })
    expect(env.FILES.put).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${USER}/[0-9a-f-]{36}$`)),
      expect.any(ArrayBuffer),
      { httpMetadata: { contentType: 'application/pdf' } },
    )
    expect(sql.calls[0].text).toContain('INSERT INTO document_files')
    expect(sql.calls[0].values).toEqual(
      expect.arrayContaining([USER, null, 'notes.pdf', 'application/pdf', 10]),
    )
  })

  it('prefers the sniffed type over the client type', async () => {
    const env = { FILES: r2() }
    const sql = createMockSql([[PUBLIC_ROW]])
    await uploadFile(
      uploadRequest({ name: 'x.bin', type: 'text/plain', bytes: pngBytes() }),
      sql,
      USER,
      env,
      {
        allowRequest: async () => true,
      },
    )
    expect(env.FILES.put.mock.calls[0][2]).toEqual({ httpMetadata: { contentType: 'image/png' } })
  })

  it('falls back to octet-stream when the client type is missing and nothing sniffs', async () => {
    const env = { FILES: r2() }
    const sql = createMockSql([[PUBLIC_ROW]])
    await uploadFile(
      uploadRequest({ name: 'x.bin', type: '', bytes: new Uint8Array([1, 2, 3]) }),
      sql,
      USER,
      env,
      { allowRequest: async () => true },
    )
    expect(env.FILES.put.mock.calls[0][2]).toEqual({
      httpMetadata: { contentType: 'application/octet-stream' },
    })
  })

  it('validates the folder belongs to the caller', async () => {
    const env = { FILES: r2() }
    const sql = createMockSql([[]]) // fetchOwnedFolder finds nothing
    const response = await uploadFile(uploadRequest({ folder: FOLDER_ID }), sql, USER, env, {
      allowRequest: async () => true,
    })
    expect(response.status).toBe(404)
    expect(env.FILES.put).not.toHaveBeenCalled()
  })

  it('deletes the object when the row insert fails', async () => {
    const env = { FILES: r2() }
    const sql = createMockSql()
    sql.mockRejectedValueOnce(new Error('insert failed'))
    const response = await uploadFile(uploadRequest(), sql, USER, env, {
      allowRequest: async () => true,
    })
    expect(response.status).toBe(500)
    expect(env.FILES.delete).toHaveBeenCalledWith(env.FILES.put.mock.calls[0][0])
  })

  it('rejects an oversized declared body before reading it', async () => {
    const env = { FILES: r2() }
    const request = new Request('https://x/files', {
      method: 'POST',
      headers: { 'Content-Length': String(MAX_FILE_BYTES + 1000) },
      body: 'x',
    })
    const response = await uploadFile(request, createMockSql(), USER, env, {
      allowRequest: async () => true,
    })
    expect(response.status).toBe(413)
  })

  it('rejects an oversized file after reading it', async () => {
    const env = { FILES: r2() }
    const big = new Uint8Array(MAX_FILE_BYTES + 1)
    const response = await uploadFile(uploadRequest({ bytes: big }), createMockSql(), USER, env, {
      allowRequest: async () => true,
    })
    expect(response.status).toBe(413)
    expect(env.FILES.put).not.toHaveBeenCalled()
  })

  it('rejects a request with no file field', async () => {
    const response = await uploadFile(
      uploadRequest({ field: 'other' }),
      createMockSql(),
      USER,
      { FILES: r2() },
      {
        allowRequest: async () => true,
      },
    )
    expect(response.status).toBe(400)
  })

  it('answers 429 when the rate limit refuses', async () => {
    const response = await uploadFile(
      uploadRequest(),
      createMockSql(),
      USER,
      { FILES: r2() },
      {
        allowRequest: async () => false,
      },
    )
    expect(response.status).toBe(429)
  })

  it('answers 503 without a bucket binding', async () => {
    const response = await uploadFile(
      uploadRequest(),
      createMockSql(),
      USER,
      {},
      {
        allowRequest: async () => true,
      },
    )
    expect(response.status).toBe(503)
  })
})

describe('getFile', () => {
  it('returns the row', async () => {
    const response = await getFile(createMockSql([[PUBLIC_ROW]]), USER, FILE_ID)
    expect(await response.json()).toEqual({ file: PUBLIC_ROW })
  })
  it('404s for a missing or foreign id', async () => {
    const response = await getFile(createMockSql([[]]), USER, FILE_ID)
    expect(response.status).toBe(404)
  })
})

describe('getFileContent', () => {
  it('streams the object inline for a PDF with private caching', async () => {
    const env = { FILES: r2() }
    env.FILES.get.mockResolvedValue({
      body: new Blob(['hello']).stream(),
      size: 5,
      httpMetadata: { contentType: 'application/pdf' },
    })
    const sql = createMockSql([[ROW]])
    const response = await getFileContent(sql, USER, FILE_ID, env)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Length')).toBe('5')
    expect(response.headers.get('Content-Disposition')).toContain('inline; filename="notes.pdf"')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.text()).toBe('hello')
    expect(env.FILES.get).toHaveBeenCalledWith(ROW.object_key)
  })

  it('serves anything else as an attachment', async () => {
    const env = { FILES: r2() }
    env.FILES.get.mockResolvedValue({ body: new Blob(['x']).stream(), size: 1, httpMetadata: {} })
    const sql = createMockSql([[{ ...ROW, name: 'a.zip', mime_type: 'application/zip' }]])
    const response = await getFileContent(sql, USER, FILE_ID, env)
    expect(response.headers.get('Content-Disposition')).toContain('attachment;')
    expect(response.headers.get('Content-Type')).toBe('application/zip')
  })

  it('404s when the row is missing', async () => {
    const response = await getFileContent(createMockSql([[]]), USER, FILE_ID, { FILES: r2() })
    expect(response.status).toBe(404)
  })

  it('404s when the object is missing', async () => {
    const env = { FILES: r2() }
    env.FILES.get.mockResolvedValue(null)
    const response = await getFileContent(createMockSql([[ROW]]), USER, FILE_ID, env)
    expect(response.status).toBe(404)
  })
})

describe('updateFile', () => {
  it('renames', async () => {
    const sql = createMockSql([[{ ...PUBLIC_ROW, name: 'renamed.pdf' }]])
    const response = await updateFile(sql, USER, FILE_ID, { name: '  renamed.pdf ' })
    expect((await response.json()).file.name).toBe('renamed.pdf')
    expect(sql.calls[0].values).toContain('renamed.pdf')
  })
  it('moves to an owned folder', async () => {
    const sql = createMockSql([[{ id: FOLDER_ID }], [{ ...PUBLIC_ROW, folder_id: FOLDER_ID }]])
    const response = await updateFile(sql, USER, FILE_ID, { folder: FOLDER_ID })
    expect((await response.json()).file.folder_id).toBe(FOLDER_ID)
  })
  it('moves to the root with folder null', async () => {
    const sql = createMockSql([[PUBLIC_ROW]])
    const response = await updateFile(sql, USER, FILE_ID, { folder: null })
    expect(response.status).toBe(200)
  })
  it('refuses a foreign folder', async () => {
    const response = await updateFile(createMockSql([[]]), USER, FILE_ID, { folder: FOLDER_ID })
    expect(response.status).toBe(404)
  })
  it('refuses an empty name and an empty body', async () => {
    expect((await updateFile(createMockSql(), USER, FILE_ID, { name: '   ' })).status).toBe(400)
    expect((await updateFile(createMockSql(), USER, FILE_ID, {})).status).toBe(400)
  })
  it('404s when nothing was updated', async () => {
    const response = await updateFile(createMockSql([[]]), USER, FILE_ID, { name: 'x' })
    expect(response.status).toBe(404)
  })
})

describe('deleteFile', () => {
  it('deletes the row then the object', async () => {
    const env = { FILES: r2() }
    const sql = createMockSql([[ROW]])
    const response = await deleteFile(sql, USER, FILE_ID, env)
    expect(response.status).toBe(204)
    expect(sql.calls[0].text).toContain('DELETE FROM document_files')
    expect(env.FILES.delete).toHaveBeenCalledWith(ROW.object_key)
  })
  it('still answers 204 when the object delete fails, reporting it', async () => {
    const env = { FILES: r2() }
    env.FILES.delete.mockRejectedValue(new Error('r2 down'))
    const report = vi.fn()
    const response = await deleteFile(createMockSql([[ROW]]), USER, FILE_ID, env, { report })
    expect(response.status).toBe(204)
    expect(report).toHaveBeenCalledWith('file_object_delete', expect.any(Error), {
      file_id: FILE_ID,
    })
  })
  it('404s for a missing row', async () => {
    const response = await deleteFile(createMockSql([[]]), USER, FILE_ID, { FILES: r2() })
    expect(response.status).toBe(404)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Worker && npx vitest run workers/cookie-web-tasks/test/files.test.js
```

Expected: fails with "Failed to resolve import ../src/files.js".

- [ ] **Step 4: Implement src/files.js**

```js
// Uploaded files in the Documents tree. Metadata lives in document_files;
// bytes live in the private R2 bucket bound as FILES, keyed by
// <user_id>/<uuid> so a key never carries a client-supplied name. Bytes only
// ever leave through getFileContent, which checks ownership first.

import { cleanText, fetchOwnedFolder } from './documents.js'

export const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_NAME_LENGTH = 255
const UPLOAD_RATE_LIMIT = { limit: 60, windowMs: 60_000 }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const FALLBACK_TYPE = 'application/octet-stream'
// The only types ever served inline: the sniffed set, nothing the client says.
const INLINE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
])
const FILE_COLUMNS = 'id, folder_id, name, mime_type, size_bytes, created_at, updated_at'

/** @param {unknown} value */
function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {string | null}
 */
export function sniffFileType(buffer) {
  const b = new Uint8Array(buffer)
  const starts = (/** @type {number[]} */ bytes) => bytes.every((v, i) => b[i] === v)
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (starts([0x89, 0x50, 0x4e, 0x47])) return 'image/png'
  if (starts([0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  if (
    b.length >= 12 &&
    starts([0x52, 0x49, 0x46, 0x46]) &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

/**
 * RFC 6266 disposition with an ASCII fallback and an RFC 5987 UTF-8 name.
 * @param {string} name @param {boolean} inline
 */
export function contentDisposition(name, inline) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/gu, '_')
  const encoded = encodeURIComponent(name).replace(
    /['()*]/gu,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/** @param {string} type */
function cleanMimeType(type) {
  const value = String(type ?? '')
    .trim()
    .toLowerCase()
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(value) && value.length <= 127
    ? value
    : FALLBACK_TYPE
}

/**
 * GET /files?folder=<uuid|root>
 * @param {import('postgres').Sql} sql @param {string} userId @param {URL} url
 */
export async function listFiles(sql, userId, url) {
  const folder = url.searchParams.get('folder')
  if (folder && folder !== 'root' && !isUuid(folder)) {
    return Response.json({ error: 'Invalid folder' }, { status: 400 })
  }
  const files =
    folder && folder !== 'root'
      ? await sql`
          SELECT ${sql.unsafe(FILE_COLUMNS)} FROM document_files
          WHERE user_id = ${userId} AND folder_id = ${folder}
          ORDER BY created_at DESC
        `
      : await sql`
          SELECT ${sql.unsafe(FILE_COLUMNS)} FROM document_files
          WHERE user_id = ${userId} AND folder_id IS NULL
          ORDER BY created_at DESC
        `
  return Response.json({ files })
}

/** @param {import('postgres').Sql} sql @param {string} userId @param {string} id */
export async function getFile(sql, userId, id) {
  const [file] = await sql`
    SELECT ${sql.unsafe(FILE_COLUMNS)} FROM document_files
    WHERE id = ${id} AND user_id = ${userId}
  `
  if (!file) return Response.json({ error: 'File not found' }, { status: 404 })
  return Response.json({ file })
}

/**
 * POST /files — multipart with `file` and optional `folder`.
 *
 * @param {Request} request
 * @param {import('postgres').Sql} sql
 * @param {string} userId
 * @param {{FILES?: R2Bucket}} env
 * @param {{allowRequest: (sql: import('postgres').Sql, userId: string, scope: string, policy: {limit: number, windowMs: number}) => Promise<boolean>}} deps
 */
export async function uploadFile(request, sql, userId, env, deps) {
  if (!env.FILES) {
    return Response.json({ error: 'File storage is not configured' }, { status: 503 })
  }
  const declared = Number(request.headers.get('Content-Length'))
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES + 64 * 1024) {
    return Response.json({ error: 'File is larger than 25 MB' }, { status: 413 })
  }
  if (!(await deps.allowRequest(sql, userId, 'file-upload', UPLOAD_RATE_LIMIT))) {
    return Response.json({ error: 'Too many uploads, slow down' }, { status: 429 })
  }

  let form
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'Content-Type must be multipart/form-data' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: 'No file provided' }, { status: 400 })
  }
  if (file.size > MAX_FILE_BYTES) {
    return Response.json({ error: 'File is larger than 25 MB' }, { status: 413 })
  }
  const folderField = form.get('folder')
  const folderId = typeof folderField === 'string' && folderField ? folderField : null
  if (folderId !== null) {
    if (!isUuid(folderId)) return Response.json({ error: 'Invalid folder' }, { status: 400 })
    const [owned] = await fetchOwnedFolder(sql, userId, folderId)
    if (!owned) return Response.json({ error: 'Folder not found' }, { status: 404 })
  }

  const bytes = await file.arrayBuffer()
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return Response.json({ error: 'File is larger than 25 MB' }, { status: 413 })
  }
  const name = cleanText(file.name, MAX_NAME_LENGTH) || 'Untitled'
  const mimeType = sniffFileType(bytes) ?? cleanMimeType(file.type)
  const objectKey = `${userId}/${crypto.randomUUID()}`

  await env.FILES.put(objectKey, bytes, { httpMetadata: { contentType: mimeType } })
  try {
    const [row] = await sql`
      INSERT INTO document_files (user_id, folder_id, name, mime_type, size_bytes, object_key)
      VALUES (${userId}, ${folderId}, ${name}, ${mimeType}, ${bytes.byteLength}, ${objectKey})
      RETURNING ${sql.unsafe(FILE_COLUMNS)}
    `
    console.log(JSON.stringify({ event: 'file_uploaded', file_id: row.id, size: bytes.byteLength }))
    return Response.json({ file: row }, { status: 201 })
  } catch (error) {
    await env.FILES.delete(objectKey).catch(() => undefined)
    console.log(
      JSON.stringify({
        event: 'file_upload_rejected',
        message: /** @type {Error} */ (error).message,
      }),
    )
    return Response.json({ error: 'Failed to store the file' }, { status: 500 })
  }
}

/**
 * GET /files/:id/content
 * @param {import('postgres').Sql} sql @param {string} userId @param {string} id
 * @param {{FILES?: R2Bucket}} env
 */
export async function getFileContent(sql, userId, id, env) {
  if (!env.FILES) {
    return Response.json({ error: 'File storage is not configured' }, { status: 503 })
  }
  const [file] = await sql`
    SELECT name, mime_type, object_key FROM document_files
    WHERE id = ${id} AND user_id = ${userId}
  `
  if (!file) return Response.json({ error: 'File not found' }, { status: 404 })
  const object = await env.FILES.get(file.object_key)
  if (!object) {
    console.log(JSON.stringify({ event: 'file_object_missing', file_id: id }))
    return Response.json({ error: 'File not found' }, { status: 404 })
  }
  const mimeType = file.mime_type || FALLBACK_TYPE
  return new Response(object.body, {
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(object.size),
      'Content-Disposition': contentDisposition(file.name, INLINE_TYPES.has(mimeType)),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/**
 * PATCH /files/:id — { name?, folder? }
 * @param {import('postgres').Sql} sql @param {string} userId @param {string} id @param {any} body
 */
export async function updateFile(sql, userId, id, body) {
  const updates = {}
  if (body?.name !== undefined) {
    const name = cleanText(body.name, MAX_NAME_LENGTH)
    if (!name) return Response.json({ error: 'Name is required' }, { status: 400 })
    updates.name = name
  }
  if (body && Object.hasOwn(body, 'folder')) {
    if (body.folder === null) {
      updates.folder_id = null
    } else {
      if (!isUuid(body.folder)) return Response.json({ error: 'Invalid folder' }, { status: 400 })
      const [owned] = await fetchOwnedFolder(sql, userId, body.folder)
      if (!owned) return Response.json({ error: 'Folder not found' }, { status: 404 })
      updates.folder_id = body.folder
    }
  }
  if (!Object.keys(updates).length) {
    return Response.json({ error: 'Nothing to update' }, { status: 400 })
  }
  const [file] = await sql`
    UPDATE document_files
    SET ${sql(updates)}, updated_at = now()
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING ${sql.unsafe(FILE_COLUMNS)}
  `
  if (!file) return Response.json({ error: 'File not found' }, { status: 404 })
  return Response.json({ file })
}

/**
 * DELETE /files/:id — row first, then the object. The row is the source of
 * truth; a leaked object is reported, not surfaced.
 *
 * @param {import('postgres').Sql} sql @param {string} userId @param {string} id
 * @param {{FILES?: R2Bucket}} env
 * @param {{report?: (operation: string, error: unknown, extra: Record<string, unknown>) => void}} [deps]
 */
export async function deleteFile(sql, userId, id, env, deps = {}) {
  const [file] = await sql`
    DELETE FROM document_files
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING object_key
  `
  if (!file) return Response.json({ error: 'File not found' }, { status: 404 })
  try {
    await env.FILES?.delete(file.object_key)
  } catch (error) {
    console.log(JSON.stringify({ event: 'file_object_delete_failed', file_id: id }))
    deps.report?.('file_object_delete', error, { file_id: id })
  }
  return new Response(null, { status: 204 })
}
```

Note on the mock: `createMockSql` records the `sql(updates)` dynamic SET helper and `sql.unsafe` may not exist on it. Check `test/helpers.js`; if `sql.unsafe` is missing, add to the mock `sql.unsafe = (text) => ({ __unsafe: text })` (it is a marker, not a round trip) and have the mock's `calls[].text` join it as `?`. Prefer keeping the code as written and extending the helper.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Worker && npx vitest run workers/cookie-web-tasks/test/files.test.js
```

Expected: all pass. If `contentDisposition` expectations differ only in escaping details, fix the implementation, not the test intent (ASCII fallback keeps `.pdf`, UTF-8 name is percent-encoded).

- [ ] **Step 6: Lint, format, typecheck, commit**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Worker && npm run lint && npm run format:check && npm run typecheck && jj commit -m "cookie-web-tasks: document file storage module over R2

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Worker routing for /files

**Files:**

- Modify: `Cookie-Worker/workers/cookie-web-tasks/src/worker.js`
- Test: `Cookie-Worker/workers/cookie-web-tasks/test/worker.test.js`

**Interfaces:**

- Consumes: Task 2 exports.
- Produces: `GET/POST /files`, `GET/PATCH/DELETE /files/:id`, `GET /files/:id/content`.

- [ ] **Step 1: Write the failing route tests**

Append to `test/worker.test.js` (the file already defines `request`, `env`, `ctx`, `mockQuery`, `captureHandledException`). Add `FILES: { put: vi.fn(async () => ({})), get: vi.fn(), delete: vi.fn(async () => undefined) }` to the `env` object literal near the top, and in `beforeEach` add `env.FILES.get.mockReset();`. Then:

```js
describe('routing — /files', () => {
  const FILE_ID = '33333333-3333-4333-8333-333333333333'

  test('GET /files dispatches to listFiles', async () => {
    const response = await worker.fetch(request('/files?folder=root'), env, ctx)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ files: [] })
  })

  test('POST /files uploads through the bucket', async () => {
    mockQuery.mockResolvedValueOnce([{ id: FILE_ID, name: 'a.txt' }])
    const form = new FormData()
    form.set('file', new File(['hi'], 'a.txt', { type: 'text/plain' }))
    const response = await worker.fetch(request('/files', { method: 'POST', body: form }), env, ctx)
    expect(response.status).toBe(201)
    expect(env.FILES.put).toHaveBeenCalled()
  })

  test('GET /files/:id/content streams the object', async () => {
    mockQuery.mockResolvedValueOnce([{ name: 'a.txt', mime_type: 'text/plain', object_key: 'k' }])
    env.FILES.get.mockResolvedValue({ body: new Blob(['hi']).stream(), size: 2, httpMetadata: {} })
    const response = await worker.fetch(request(`/files/${FILE_ID}/content`), env, ctx)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('hi')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(PRODUCTION)
  })

  test('PATCH /files/:id renames', async () => {
    mockQuery.mockResolvedValueOnce([{ id: FILE_ID, name: 'b.txt' }])
    const response = await worker.fetch(
      request(`/files/${FILE_ID}`, { method: 'PATCH', body: JSON.stringify({ name: 'b.txt' }) }),
      env,
      ctx,
    )
    expect(response.status).toBe(200)
  })

  test('DELETE /files/:id removes the row and object', async () => {
    mockQuery.mockResolvedValueOnce([{ object_key: 'k' }])
    const response = await worker.fetch(
      request(`/files/${FILE_ID}`, { method: 'DELETE' }),
      env,
      ctx,
    )
    expect(response.status).toBe(204)
    expect(env.FILES.delete).toHaveBeenCalledWith('k')
  })

  test('rejects malformed ids and unknown sub-paths', async () => {
    expect((await worker.fetch(request('/files/nope'), env, ctx)).status).toBe(404)
    expect((await worker.fetch(request(`/files/${FILE_ID}/other`), env, ctx)).status).toBe(404)
  })

  test('PUT /files returns 405', async () => {
    const response = await worker.fetch(request('/files', { method: 'PUT' }), env, ctx)
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET, POST')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Worker && npx vitest run workers/cookie-web-tasks/test/worker.test.js -t "routing — /files"
```

Expected: 404s where 200/201/204 are expected.

- [ ] **Step 3: Add the dispatch**

In `src/worker.js` add the import:

```js
import { deleteFile, getFile, getFileContent, listFiles, updateFile, uploadFile } from './files.js'
```

Inside `route(...)`, before `if (segments[0] === 'documents') {`, insert:

```js
if (segments[0] === 'files') {
  const FILE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
  if (segments.length === 1) {
    if (request.method === 'GET') return listFiles(sql, userId, url)
    if (request.method === 'POST') return uploadFile(request, sql, userId, env, { allowRequest })
    return Response.json(
      { error: 'Method not allowed' },
      { status: 405, headers: { Allow: 'GET, POST' } },
    )
  }
  const id = segments[1]
  if (!FILE_UUID.test(id) || segments.length > 3) {
    return Response.json({ error: 'Not Found' }, { status: 404 })
  }
  if (segments.length === 3) {
    if (segments[2] !== 'content') return Response.json({ error: 'Not Found' }, { status: 404 })
    if (request.method !== 'GET')
      return Response.json(
        { error: 'Method not allowed' },
        { status: 405, headers: { Allow: 'GET' } },
      )
    return getFileContent(sql, userId, id, env)
  }
  if (request.method === 'GET') return getFile(sql, userId, id)
  if (request.method === 'DELETE') {
    return deleteFile(sql, userId, id, env, {
      report: (operation, error, extra) => captureHandledException(operation, error, env, extra),
    })
  }
  if (request.method !== 'PATCH')
    return Response.json(
      { error: 'Method not allowed' },
      { status: 405, headers: { Allow: 'GET, PATCH, DELETE' } },
    )
  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    const errorResponse = bodyErrorResponse(error)
    if (errorResponse) return errorResponse
    throw error
  }
  return updateFile(sql, userId, id, body)
}
```

- [ ] **Step 4: Run the whole Worker suite, lint, format, typecheck**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Worker && npm test 2>&1 | tail -5 && npm run lint && npm run format:check && npm run typecheck
```

Expected: all pass.

- [ ] **Step 5: README row**

In `Cookie-Worker/README.md` the cookie-web-tasks row (line 17) ends with "`GET/POST/PATCH/DELETE /documents`)." Extend the parenthetical to "`GET/POST/PATCH/DELETE /documents`), and uploaded files in the same folder tree (`GET/POST /files`, `GET/PATCH/DELETE /files/:id`, `GET /files/:id/content`; bytes in the private `cookie-files` R2 bucket, served only through the Worker)." Run `npm run format:check` again (Prettier reflows the table).

- [ ] **Step 6: Commit**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Worker && jj commit -m "cookie-web-tasks: route /files for uploads, content, rename, move and delete

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Push and deploy the Worker

**Files:** none.

- [ ] **Step 1: Push**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Worker && jj bookmark set main -r @- && jj git push --bookmark main && git ls-remote origin refs/heads/main && jj log -r main --no-graph -T 'commit_id.short()'
```

Expected: the two SHAs match.

- [ ] **Step 2: Deploy cookie-web-tasks and wait**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Worker && gh workflow run deploy.yml -f worker=cookie-web-tasks && sleep 20 && id=$(gh run list --workflow=Deploy --limit 1 --json databaseId -q '.[0].databaseId') && gh run watch "$id" --exit-status --interval 15 >/dev/null && gh run view "$id" --json conclusion -q .conclusion
```

Expected: `success`.

- [ ] **Step 3: Smoke test the deployed route**

An unauthenticated request must be refused, proving the route exists behind auth:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://tasks-api.infinitywave.online/files
```

Expected: `401`.

---

### Task 5: Client pure helpers (documentFiles.js, documentsLayout.js)

**Files:**

- Create: `Cookie-Web/src/lib/documentFiles.js`
- Create: `Cookie-Web/src/lib/documentsLayout.js`
- Test: `Cookie-Web/src/lib/__tests__/documentFiles.spec.js`, `Cookie-Web/src/lib/__tests__/documentsLayout.spec.js`

**Interfaces:**

- Produces:
  - `MAX_UPLOAD_BYTES = 25 * 1024 * 1024`
  - `fileFolderKey(folderId)` → `'root'` or the id
  - `isPreviewable(mimeType)` → boolean (the five inline types)
  - `fileKind(mimeType)` → short label: `'Image'`, `'PDF'`, `'Spreadsheet'`, `'Text'`, `'Archive'`, `'Audio'`, `'Video'`, `'File'`
  - `fileIcon(mimeType)` → Material Symbols name: `image`, `picture_as_pdf`, `table_chart`, `description`, `folder_zip`, `audio_file`, `video_file`, `draft`
  - `formatBytes(n)` → `'12 B'`, `'3.4 KB'`, `'1.2 MB'`
  - `folderContents(folders, documents, files, folderId)` → `[{ kind: 'folder'|'document'|'file', id, name, item }]`
  - `folderBreadcrumb(folders, folderId)` → `[{ id: null, title: 'Documents' }, ...ancestors, current]`
  - `getStoredLayout()` → `'grid' | 'list'`; `saveLayout(layout)`

- [ ] **Step 1: Write the failing tests**

`src/lib/__tests__/documentFiles.spec.js`:

```js
import { describe, expect, it } from 'vitest'
import {
  fileFolderKey,
  fileIcon,
  fileKind,
  folderBreadcrumb,
  folderContents,
  formatBytes,
  isPreviewable,
} from '../documentFiles'

const FOLDERS = [
  { id: 'f-a', parent_id: null, title: 'Work' },
  { id: 'f-b', parent_id: 'f-a', title: '2026' },
  { id: 'f-c', parent_id: null, title: 'Archive' },
]

describe('documentFiles helpers', () => {
  it('keys the root as root', () => {
    expect(fileFolderKey(null)).toBe('root')
    expect(fileFolderKey('f-a')).toBe('f-a')
  })

  it('previews only images and PDFs', () => {
    expect(isPreviewable('image/png')).toBe(true)
    expect(isPreviewable('application/pdf')).toBe(true)
    expect(isPreviewable('application/zip')).toBe(false)
    expect(isPreviewable('image/svg+xml')).toBe(false)
  })

  it('labels and icons by type', () => {
    expect(fileKind('image/jpeg')).toBe('Image')
    expect(fileKind('application/pdf')).toBe('PDF')
    expect(fileKind('text/csv')).toBe('Spreadsheet')
    expect(fileKind('text/plain')).toBe('Text')
    expect(fileKind('application/zip')).toBe('Archive')
    expect(fileKind('audio/mpeg')).toBe('Audio')
    expect(fileKind('video/mp4')).toBe('Video')
    expect(fileKind('application/octet-stream')).toBe('File')
    expect(fileIcon('application/pdf')).toBe('picture_as_pdf')
    expect(fileIcon('application/octet-stream')).toBe('draft')
  })

  it('formats bytes', () => {
    expect(formatBytes(12)).toBe('12 B')
    expect(formatBytes(3481)).toBe('3.4 KB')
    expect(formatBytes(1_258_291)).toBe('1.2 MB')
  })

  it('orders folders first, then documents and files by name', () => {
    const docs = [
      { id: 'd-1', folder_id: 'f-a', title: 'zeta' },
      { id: 'd-2', folder_id: 'f-a', title: '' },
      { id: 'd-3', folder_id: null, title: 'elsewhere' },
    ]
    const files = [{ id: 'x-1', folder_id: 'f-a', name: 'Alpha.pdf' }]
    const items = folderContents(FOLDERS, docs, files, 'f-a')
    expect(items.map((item) => [item.kind, item.name])).toEqual([
      ['folder', '2026'],
      ['file', 'Alpha.pdf'],
      ['document', 'Untitled'],
      ['document', 'zeta'],
    ])
  })

  it('lists root folders and root items for the root', () => {
    const items = folderContents(FOLDERS, [{ id: 'd', folder_id: null, title: 'r' }], [], null)
    expect(items.map((item) => item.name)).toEqual(['Archive', 'Work', 'r'])
  })

  it('builds a breadcrumb from the root down', () => {
    expect(folderBreadcrumb(FOLDERS, 'f-b').map((c) => c.title)).toEqual([
      'Documents',
      'Work',
      '2026',
    ])
    expect(folderBreadcrumb(FOLDERS, null)).toEqual([{ id: null, title: 'Documents' }])
    expect(folderBreadcrumb(FOLDERS, 'missing')).toEqual([{ id: null, title: 'Documents' }])
  })
})
```

`src/lib/__tests__/documentsLayout.spec.js`:

```js
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getStoredLayout, saveLayout } from '../documentsLayout'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('documentsLayout', () => {
  it('defaults to grid', () => {
    expect(getStoredLayout()).toBe('grid')
  })
  it('round-trips list', () => {
    saveLayout('list')
    expect(localStorage.getItem('cookie-documents-layout')).toBe('list')
    expect(getStoredLayout()).toBe('list')
  })
  it('ignores garbage', () => {
    localStorage.setItem('cookie-documents-layout', 'columns')
    expect(getStoredLayout()).toBe('grid')
  })
  it('survives a throwing storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => saveLayout('list')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Web && npx vitest run src/lib/__tests__/documentFiles.spec.js src/lib/__tests__/documentsLayout.spec.js
```

Expected: import failures.

- [ ] **Step 3: Implement**

`src/lib/documentFiles.js`:

```js
// Pure helpers for the Documents folder browser and uploaded files. No
// store, no DOM: the browser component and the store both lean on these.

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

const PREVIEWABLE = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
])

export function fileFolderKey(folderId) {
  return folderId ?? 'root'
}

export function isPreviewable(mimeType) {
  return PREVIEWABLE.has(String(mimeType || '').toLowerCase())
}

const KINDS = [
  [/^image\//u, 'Image', 'image'],
  [/^application\/pdf$/u, 'PDF', 'picture_as_pdf'],
  [/spreadsheet|excel|csv/u, 'Spreadsheet', 'table_chart'],
  [/^text\/|word|document|rtf/u, 'Text', 'description'],
  [/zip|tar|gzip|compressed|7z|rar/u, 'Archive', 'folder_zip'],
  [/^audio\//u, 'Audio', 'audio_file'],
  [/^video\//u, 'Video', 'video_file'],
]

function kindEntry(mimeType) {
  const type = String(mimeType || '').toLowerCase()
  return KINDS.find(([pattern]) => pattern.test(type))
}

export function fileKind(mimeType) {
  return kindEntry(mimeType)?.[1] ?? 'File'
}

export function fileIcon(mimeType) {
  return kindEntry(mimeType)?.[2] ?? 'draft'
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

// Folders first by title, then documents and files together by name.
export function folderContents(folders, documents, files, folderId) {
  const here = (row) => (row.folder_id ?? null) === (folderId ?? null)
  const parent = (folder) => (folder.parent_id ?? null) === (folderId ?? null)
  const folderItems = folders
    .filter(parent)
    .map((item) => ({ kind: 'folder', id: item.id, name: item.title, item }))
    .sort(byName)
  const rest = [
    ...documents
      .filter(here)
      .map((item) => ({ kind: 'document', id: item.id, name: item.title || 'Untitled', item })),
    ...files.filter(here).map((item) => ({ kind: 'file', id: item.id, name: item.name, item })),
  ].sort(byName)
  return [...folderItems, ...rest]
}

export function folderBreadcrumb(folders, folderId) {
  const root = { id: null, title: 'Documents' }
  if (!folderId) return [root]
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const trail = []
  let current = byId.get(folderId)
  const seen = new Set()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    trail.unshift({ id: current.id, title: current.title })
    current = current.parent_id ? byId.get(current.parent_id) : null
  }
  return trail.length ? [root, ...trail] : [root]
}
```

`src/lib/documentsLayout.js`:

```js
const LAYOUT_KEY = 'cookie-documents-layout'
const LAYOUTS = new Set(['grid', 'list'])

export function getStoredLayout() {
  try {
    const value = localStorage.getItem(LAYOUT_KEY)
    return LAYOUTS.has(value) ? value : 'grid'
  } catch {
    return 'grid'
  }
}

export function saveLayout(layout) {
  if (!LAYOUTS.has(layout)) return
  try {
    localStorage.setItem(LAYOUT_KEY, layout)
  } catch (error) {
    console.error('Failed to save documents layout:', error)
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Same command as Step 2. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Web && npm run lint && npm run format:check && git add src/lib/documentFiles.js src/lib/documentsLayout.js src/lib/__tests__/documentFiles.spec.js src/lib/__tests__/documentsLayout.spec.js && git commit -m "documents: folder browser helpers and layout preference

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Store file state and actions

**Files:**

- Modify: `Cookie-Web/src/stores/documents.js`
- Test: `Cookie-Web/src/stores/__tests__/documents.spec.js`

**Interfaces:**

- Consumes: `MAX_UPLOAD_BYTES`, `fileFolderKey` from `src/lib/documentFiles.js`; `TASKS_API_URL`; `jsonRequest`.
- Produces on the store:
  - state `files: {}` (id → row), `filePages: {}` (folder key → `{ ids, loaded, loading, error }`), `uploads: []` (`{ id, name, folder_id, size_bytes, status: 'uploading'|'error', error }`)
  - `filesForFolder(folderId)` → rows
  - `loadFiles(folderId, { force })`, `loadFile(id)`, `uploadFiles(fileList, folderId)`, `uploadFile(file, folderId)`, `dismissUpload(id)`, `renameFile(id, name)`, `moveFile(id, folderId)`, `deleteFile(id)`, `fetchFileBlob(id)` → `Blob`

- [ ] **Step 1: Write the failing tests**

Append to `src/stores/__tests__/documents.spec.js` (it already has `stubFetch`, `ok`, `fail`, `store`):

```js
describe('documents store — files', () => {
  const FILE = {
    id: 'x-1',
    folder_id: null,
    name: 'notes.pdf',
    mime_type: 'application/pdf',
    size_bytes: 10,
    created_at: 't0',
    updated_at: 't0',
  }

  it('loads a folder page of files once and exposes it', async () => {
    const fetchMock = stubFetch({ GET: () => ok({ files: [FILE] }) })
    await store.loadFiles(null)
    await store.loadFiles(null)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${TASKS_API_URL}/files?folder=root`)
    expect(store.filesForFolder(null)).toEqual([FILE])
    expect(store.filePages.root.loaded).toBe(true)
  })

  it('records a failed load and notifies', async () => {
    stubFetch({ GET: fail })
    await store.loadFiles('f-1')
    expect(store.filePages['f-1'].error).toBeTruthy()
    expect(useInboxStore().notify).toHaveBeenCalled()
  })

  it('uploads with multipart form data into the folder page', async () => {
    const fetchMock = stubFetch({
      POST: () => ({
        ok: true,
        status: 201,
        json: async () => ({ file: { ...FILE, folder_id: 'f-1' } }),
      }),
    })
    store.filePages['f-1'] = { ids: [], loaded: true, loading: false, error: null }
    const file = new File(['hi'], 'notes.pdf', { type: 'application/pdf' })
    await store.uploadFiles([file], 'f-1')
    const [url, options] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${TASKS_API_URL}/files`)
    expect(options.body).toBeInstanceOf(FormData)
    expect(options.body.get('folder')).toBe('f-1')
    expect(store.filePages['f-1'].ids).toEqual(['x-1'])
    expect(store.uploads).toEqual([])
  })

  it('keeps a failed upload as a dismissable placeholder', async () => {
    stubFetch({
      POST: () => ({
        ok: false,
        status: 413,
        json: async () => ({ error: 'File is larger than 25 MB' }),
      }),
    })
    await store.uploadFiles([new File(['x'], 'a.bin')], null)
    expect(store.uploads).toHaveLength(1)
    expect(store.uploads[0]).toMatchObject({ status: 'error', error: 'File is larger than 25 MB' })
    store.dismissUpload(store.uploads[0].id)
    expect(store.uploads).toEqual([])
  })

  it('rejects oversized files before any request', async () => {
    const fetchMock = stubFetch({})
    const big = new File([new Uint8Array(1)], 'big.bin')
    Object.defineProperty(big, 'size', { value: 25 * 1024 * 1024 + 1 })
    await store.uploadFiles([big], null)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.uploads[0].error).toContain('25 MB')
  })

  it('renames optimistically and rolls back on failure', async () => {
    store.files['x-1'] = { ...FILE }
    stubFetch({ PATCH: fail })
    await store.renameFile('x-1', 'renamed.pdf')
    expect(store.files['x-1'].name).toBe('notes.pdf')
    expect(useInboxStore().notify).toHaveBeenCalled()
  })

  it('moves between loaded folder pages', async () => {
    store.files['x-1'] = { ...FILE }
    store.filePages.root = { ids: ['x-1'], loaded: true, loading: false, error: null }
    store.filePages['f-1'] = { ids: [], loaded: true, loading: false, error: null }
    stubFetch({ PATCH: (_url, body) => ok({ file: { ...FILE, folder_id: body.folder } }) })
    await store.moveFile('x-1', 'f-1')
    expect(store.filePages.root.ids).toEqual([])
    expect(store.filePages['f-1'].ids).toEqual(['x-1'])
    expect(store.files['x-1'].folder_id).toBe('f-1')
  })

  it('deletes optimistically and restores on failure', async () => {
    store.files['x-1'] = { ...FILE }
    store.filePages.root = { ids: ['x-1'], loaded: true, loading: false, error: null }
    stubFetch({ DELETE: fail })
    await store.deleteFile('x-1')
    expect(store.filePages.root.ids).toEqual(['x-1'])
    expect(store.files['x-1']).toBeDefined()
  })

  it('fetches content as a blob with auth headers', async () => {
    const blob = new Blob(['pdf'])
    const fetchMock = stubFetch({ GET: () => ({ ok: true, blob: async () => blob }) })
    await expect(store.fetchFileBlob('x-1')).resolves.toBe(blob)
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${TASKS_API_URL}/files/x-1/content`)
  })

  it('forgets file pages when a folder is deleted', async () => {
    store.folders = [{ id: 'f-1', parent_id: null, title: 'A' }]
    store.filePages['f-1'] = { ids: [], loaded: true, loading: false, error: null }
    stubFetch({ DELETE: () => ({ ok: true, status: 204 }) })
    await store.deleteFolder('f-1')
    expect(store.filePages).toEqual({})
  })
})
```

Note `stubFetch`'s handler receives `(url, body)` where `body` is parsed JSON only when `options.body` is a string; for the FormData upload test the existing `JSON.parse(options.body)` would throw. Change `stubFetch` in this spec file to:

```js
const body =
  typeof options.body === 'string' ? JSON.parse(options.body) : (options.body ?? undefined)
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Web && npx vitest run src/stores/__tests__/documents.spec.js -t files
```

Expected: "store.loadFiles is not a function" and similar.

- [ ] **Step 3: Implement in the store**

Add the import at the top of `src/stores/documents.js`:

```js
import { MAX_UPLOAD_BYTES, fileFolderKey } from '../lib/documentFiles'
```

Add to `state`, after `dailyNoteSeedLoading: false,`:

```js
    // Uploaded files (document_files rows) by id, and per-folder pages keyed
    // by fileFolderKey. They share the folder tree with documents but none of
    // the document machinery (search, tags, revisions, AI).
    files: {},
    filePages: {},
    // In-flight or failed uploads shown as placeholders in the browser.
    uploads: [],
```

Add these actions after `request(...)`:

```js
    async filesRequest(method, path = '', { body } = {}) {
      const headers = await this.authHeaders(
        body !== undefined ? { 'Content-Type': 'application/json' } : {},
      )
      return jsonRequest(`${TASKS_API_URL}/files${path}`, { method, headers, body })
    },

    filesForFolder(folderId) {
      const page = this.filePages[fileFolderKey(folderId)]
      if (!page) return []
      return page.ids.map((id) => this.files[id]).filter(Boolean)
    },

    async loadFiles(folderId = null, { force = false } = {}) {
      const key = fileFolderKey(folderId)
      this.filePages[key] ??= { ids: [], loaded: false, loading: false, error: null }
      const page = this.filePages[key]
      if ((page.loaded && !force) || page.loading) return
      page.loading = true
      page.error = null
      try {
        const { files } = await this.filesRequest('GET', `?folder=${encodeURIComponent(key)}`)
        for (const file of files) this.files[file.id] = file
        page.ids = files.map((file) => file.id)
        page.loaded = true
      } catch (error) {
        page.error = error.userMessage || 'Failed to load files.'
        this.notify(page.error, 'error')
      } finally {
        page.loading = false
      }
    },

    async loadFile(id) {
      if (this.files[id]) return this.files[id]
      const { file } = await this.filesRequest('GET', `/${encodeURIComponent(id)}`)
      this.files[file.id] = file
      return file
    },

    async uploadFiles(fileList, folderId = null) {
      await Promise.all(Array.from(fileList).map((file) => this.uploadFile(file, folderId)))
    },

    async uploadFile(file, folderId = null) {
      const placeholder = {
        id: `upload-${crypto.randomUUID()}`,
        name: file.name,
        folder_id: folderId,
        size_bytes: file.size,
        status: 'uploading',
        error: null,
      }
      this.uploads.push(placeholder)
      if (file.size > MAX_UPLOAD_BYTES) {
        placeholder.status = 'error'
        placeholder.error = 'File is larger than 25 MB.'
        return null
      }
      try {
        const form = new FormData()
        form.append('file', file)
        if (folderId) form.append('folder', folderId)
        const headers = await this.authHeaders()
        const response = await fetch(`${TASKS_API_URL}/files`, { method: 'POST', headers, body: form })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || `Upload failed (${response.status})`)
        }
        const { file: stored } = await response.json()
        this.files[stored.id] = stored
        const page = this.filePages[fileFolderKey(stored.folder_id)]
        if (page?.loaded && !page.ids.includes(stored.id)) page.ids.unshift(stored.id)
        this.uploads = this.uploads.filter((upload) => upload !== placeholder)
        return stored
      } catch (error) {
        placeholder.status = 'error'
        placeholder.error = error.message || 'Upload failed.'
        return null
      }
    },

    dismissUpload(id) {
      this.uploads = this.uploads.filter((upload) => upload.id !== id)
    },

    async renameFile(id, name) {
      const file = this.files[id]
      if (!file) return
      const previous = file.name
      file.name = name
      try {
        const { file: updated } = await this.filesRequest('PATCH', `/${encodeURIComponent(id)}`, {
          body: { name },
        })
        Object.assign(file, updated)
      } catch (error) {
        file.name = previous
        this.notify(error.userMessage || 'Failed to rename the file.', 'error')
      }
    },

    async moveFile(id, folderId) {
      const file = this.files[id]
      if (!file || (file.folder_id ?? null) === (folderId ?? null)) return
      const previousFolder = file.folder_id ?? null
      const place = (from, to) => {
        const fromPage = this.filePages[fileFolderKey(from)]
        if (fromPage) fromPage.ids = fromPage.ids.filter((existing) => existing !== id)
        const toPage = this.filePages[fileFolderKey(to)]
        if (toPage?.loaded && !toPage.ids.includes(id)) toPage.ids.unshift(id)
        file.folder_id = to
      }
      place(previousFolder, folderId)
      try {
        const { file: updated } = await this.filesRequest('PATCH', `/${encodeURIComponent(id)}`, {
          body: { folder: folderId },
        })
        Object.assign(file, updated)
      } catch (error) {
        place(folderId, previousFolder)
        this.notify(error.userMessage || 'Failed to move the file.', 'error')
      }
    },

    async deleteFile(id) {
      const file = this.files[id]
      if (!file) return
      const key = fileFolderKey(file.folder_id)
      const page = this.filePages[key]
      const index = page?.ids.indexOf(id) ?? -1
      if (page) page.ids = page.ids.filter((existing) => existing !== id)
      delete this.files[id]
      try {
        await this.filesRequest('DELETE', `/${encodeURIComponent(id)}`)
        this.notify('File deleted.')
      } catch (error) {
        this.files[id] = file
        if (page && index >= 0) page.ids.splice(index, 0, id)
        this.notify(error.userMessage || 'Failed to delete the file.', 'error')
      }
    },

    async fetchFileBlob(id) {
      const headers = await this.authHeaders()
      const response = await fetch(`${TASKS_API_URL}/files/${encodeURIComponent(id)}/content`, {
        headers,
      })
      if (!response.ok) throw new Error(`Download failed (${response.status})`)
      return response.blob()
    },
```

In `deleteFolder`, after `this.folders = this.folders.filter((folder) => !doomed.has(folder.id))` add:

```js
// Files in a deleted folder fall back to the root on the server; drop
// the cached pages so the next visit reloads them.
this.filePages = {}
```

- [ ] **Step 4: Run to verify they pass, plus the whole store spec**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Web && npx vitest run src/stores/__tests__/documents.spec.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Web && npm run lint && npm run format:check && git add src/stores/documents.js src/stores/__tests__/documents.spec.js && git commit -m "documents store: uploaded files by folder with optimistic rename, move and delete

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: DocumentsBrowser component

**Files:**

- Create: `Cookie-Web/src/components/DocumentsBrowser.vue`
- Test: `Cookie-Web/src/components/__tests__/DocumentsBrowser.spec.js`

**Interfaces:**

- Consumes: store (Task 6), helpers (Task 5), `confirmDocumentDelete` from `src/lib/documentDeleteConfirmation.js`, `useRouter`.
- Produces: `<DocumentsBrowser :folder-id="string|null" />`. Root element `.documents-browser`; items carry `.browser-item` with `data-kind` and `data-id`; layout toggle buttons have `aria-label="Grid view"` and `"List view"`; upload button `aria-label="Upload files"` wraps a hidden `<input type="file" multiple>`; kebab `aria-label="Actions for <name>"`; drag data is `text/plain` = `document:<id>` or `file:<id>`.

- [ ] **Step 1: Write the failing component test**

`src/components/__tests__/DocumentsBrowser.spec.js`:

```js
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import DocumentsBrowser from '../DocumentsBrowser.vue'
import { useDocumentsStore } from '../../stores/documents'
import { useInboxStore } from '../../stores/inbox'

let router
let push
let store

const FOLDERS = [
  { id: 'f-work', parent_id: null, title: 'Work', emoji: '📁' },
  { id: 'f-2026', parent_id: 'f-work', title: '2026', emoji: '📁' },
]
const DOCS = [
  {
    id: 'd-root',
    folder_id: null,
    title: 'Scratch',
    emoji: '🔹',
    starred: false,
    tags: [],
    updated_at: '2026-09-01T10:00:00Z',
  },
  {
    id: 'd-work',
    folder_id: 'f-work',
    title: 'Plan',
    emoji: '💡',
    starred: true,
    tags: [],
    updated_at: '2026-09-01T10:00:00Z',
  },
]
const FILE = {
  id: 'x-1',
  folder_id: null,
  name: 'brief.pdf',
  mime_type: 'application/pdf',
  size_bytes: 2048,
  created_at: 't0',
  updated_at: 't0',
}

function mountBrowser(folderId = null) {
  return mount(DocumentsBrowser, { props: { folderId }, global: { plugins: [router] } })
}

beforeEach(async () => {
  localStorage.clear()
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/documents/file/:fileId',
        name: 'document-file',
        component: { template: '<div />' },
      },
      { path: '/documents/:id?', name: 'documents', component: { template: '<div />' } },
    ],
  })
  await router.push('/documents')
  await router.isReady()
  push = vi.spyOn(router, 'push').mockResolvedValue()
  setActivePinia(createPinia())
  store = useDocumentsStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
  store.folders = FOLDERS
  store.documents = DOCS
  store.isLoaded = true
  vi.spyOn(store, 'loadDocumentPage').mockResolvedValue()
  vi.spyOn(store, 'loadFiles').mockImplementation(async (folderId) => {
    const key = folderId ?? 'root'
    if (key === 'root') store.files[FILE.id] = FILE
    store.filePages[key] = {
      ids: key === 'root' ? [FILE.id] : [],
      loaded: true,
      loading: false,
      error: null,
    }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DocumentsBrowser', () => {
  it('shows the root as folder cards first, then documents and files, in a grid by default', async () => {
    const wrapper = mountBrowser(null)
    await flushPromises()
    const items = wrapper.findAll('.browser-item')
    expect(items.map((item) => item.attributes('data-kind'))).toEqual([
      'folder',
      'file',
      'document',
    ])
    expect(items[0].text()).toContain('Work')
    expect(items[1].text()).toContain('brief.pdf')
    expect(items[1].text()).toContain('PDF')
    expect(wrapper.find('.documents-browser').classes()).toContain('layout-grid')
    expect(store.loadFiles).toHaveBeenCalledWith(null)
  })

  it('switches to the list layout and remembers it', async () => {
    const wrapper = mountBrowser(null)
    await flushPromises()
    await wrapper.find('[aria-label="List view"]').trigger('click')
    expect(wrapper.find('.documents-browser').classes()).toContain('layout-list')
    expect(localStorage.getItem('cookie-documents-layout')).toBe('list')
    expect(wrapper.find('.browser-item[data-kind="file"]').text()).toContain('2.0 KB')
  })

  it('renders the breadcrumb and navigates on folder open', async () => {
    const wrapper = mountBrowser('f-2026')
    await flushPromises()
    expect(wrapper.find('.browser-breadcrumb').text()).toContain('Documents')
    expect(wrapper.find('.browser-breadcrumb').text()).toContain('Work')
    expect(wrapper.find('.browser-breadcrumb').text()).toContain('2026')
    await wrapper.findAll('.browser-breadcrumb a')[1].trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/documents', query: { folder: 'f-work' } })

    const root = mountBrowser(null)
    await flushPromises()
    await root.find('.browser-item[data-kind="folder"]').trigger('dblclick')
    expect(push).toHaveBeenCalledWith({ path: '/documents', query: { folder: 'f-work' } })
  })

  it('opens a document and previews a PDF', async () => {
    const wrapper = mountBrowser(null)
    await flushPromises()
    await wrapper.find('.browser-item[data-kind="document"]').trigger('dblclick')
    expect(push).toHaveBeenCalledWith('/documents/d-root')
    await wrapper.find('.browser-item[data-kind="file"]').trigger('dblclick')
    expect(push).toHaveBeenCalledWith('/documents/file/x-1')
  })

  it('downloads a non-previewable file instead of opening it', async () => {
    store.files[FILE.id] = { ...FILE, mime_type: 'application/zip', name: 'a.zip' }
    const fetchBlob = vi.spyOn(store, 'fetchFileBlob').mockResolvedValue(new Blob(['x']))
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:x'),
      revokeObjectURL: vi.fn(),
    })
    const wrapper = mountBrowser(null)
    await flushPromises()
    await wrapper.find('.browser-item[data-kind="file"]').trigger('dblclick')
    await flushPromises()
    expect(fetchBlob).toHaveBeenCalledWith('x-1')
    expect(push).not.toHaveBeenCalledWith('/documents/file/x-1')
    vi.unstubAllGlobals()
  })

  it('uploads dropped files into the current folder', async () => {
    const upload = vi.spyOn(store, 'uploadFiles').mockResolvedValue()
    const wrapper = mountBrowser('f-work')
    await flushPromises()
    const file = new File(['x'], 'a.txt')
    await wrapper.find('.documents-browser').trigger('drop', {
      dataTransfer: { files: [file], types: ['Files'], getData: () => '' },
    })
    expect(upload).toHaveBeenCalledWith([file], 'f-work')
  })

  it('shows upload placeholders with their error', async () => {
    store.uploads = [
      {
        id: 'u-1',
        name: 'big.bin',
        folder_id: null,
        size_bytes: 1,
        status: 'error',
        error: 'File is larger than 25 MB.',
      },
    ]
    const wrapper = mountBrowser(null)
    await flushPromises()
    const placeholder = wrapper.find('.browser-item[data-kind="upload"]')
    expect(placeholder.text()).toContain('File is larger than 25 MB.')
    await placeholder.find('button').trigger('click')
    expect(store.uploads).toEqual([])
  })

  it('renames a file from the kebab menu', async () => {
    const rename = vi.spyOn(store, 'renameFile').mockResolvedValue()
    const wrapper = mountBrowser(null)
    await flushPromises()
    await wrapper.find('[aria-label="Actions for brief.pdf"]').trigger('click')
    await wrapper.find('.browser-menu button[data-action="rename"]').trigger('click')
    const input = wrapper.find('.browser-item[data-kind="file"] input')
    await input.setValue('brief-v2.pdf')
    await input.trigger('keydown.enter')
    expect(rename).toHaveBeenCalledWith('x-1', 'brief-v2.pdf')
  })

  it('deletes a document only after confirmation', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    )
    const del = vi.spyOn(store, 'deleteDocument').mockResolvedValue()
    const wrapper = mountBrowser(null)
    await flushPromises()
    await wrapper.find('[aria-label="Actions for Scratch"]').trigger('click')
    await wrapper.find('.browser-menu button[data-action="delete"]').trigger('click')
    expect(del).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('moves a dragged document onto a folder card', async () => {
    const move = vi.spyOn(store, 'moveDocument').mockResolvedValue()
    const wrapper = mountBrowser(null)
    await flushPromises()
    const folderCard = wrapper.find('.browser-item[data-kind="folder"]')
    await folderCard.trigger('drop', {
      dataTransfer: { files: [], types: ['text/plain'], getData: () => 'document:d-root' },
    })
    expect(move).toHaveBeenCalledWith('d-root', 'f-work')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Web && npx vitest run src/components/__tests__/DocumentsBrowser.spec.js
```

Expected: cannot resolve `../DocumentsBrowser.vue`.

- [ ] **Step 3: Implement the component**

`src/components/DocumentsBrowser.vue`:

```vue
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDocumentsStore } from '../stores/documents'
import { confirmDocumentDelete } from '../lib/documentDeleteConfirmation'
import {
  fileIcon,
  fileKind,
  folderBreadcrumb,
  folderContents,
  formatBytes,
  isPreviewable,
} from '../lib/documentFiles'
import { getStoredLayout, saveLayout } from '../lib/documentsLayout'

const props = defineProps({ folderId: { type: String, default: null } })
const store = useDocumentsStore()
const router = useRouter()

const layout = ref(getStoredLayout())
function setLayout(value) {
  layout.value = value
  saveLayout(value)
}

const pageScope = computed(() => ({ folder: props.folderId ?? 'root' }))
const documents = computed(() =>
  store.workspacePaged
    ? store.documentsForPage(pageScope.value)
    : store.documents.filter((doc) => (doc.folder_id ?? null) === (props.folderId ?? null)),
)
const files = computed(() => store.filesForFolder(props.folderId))
const items = computed(() =>
  folderContents(store.folders, documents.value, files.value, props.folderId),
)
const uploads = computed(() =>
  store.uploads.filter((upload) => (upload.folder_id ?? null) === (props.folderId ?? null)),
)
const crumbs = computed(() => folderBreadcrumb(store.folders, props.folderId))
const filePage = computed(() => store.filePages[props.folderId ?? 'root'])
const loading = computed(
  () => (store.pageFor(pageScope.value)?.loading ?? false) || (filePage.value?.loading ?? false),
)

function load(force = false) {
  void store.loadDocumentPage(pageScope.value, { force })
  void store.loadFiles(props.folderId, { force })
}
watch(
  () => props.folderId,
  () => load(),
  { immediate: true },
)

function folderRoute(id) {
  return id ? { path: '/documents', query: { folder: id } } : { path: '/documents' }
}

async function download(file) {
  try {
    const blob = await store.fetchFileBlob(file.id)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.name
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) {
    store.notify(error.message || 'Download failed.', 'error')
  }
}

function open(entry) {
  if (entry.kind === 'folder') return router.push(folderRoute(entry.id))
  if (entry.kind === 'document') return router.push(`/documents/${entry.id}`)
  if (isPreviewable(entry.item.mime_type)) return router.push(`/documents/file/${entry.id}`)
  return download(entry.item)
}

// Selection and keyboard: single click selects, Enter or double click opens.
const selectedId = ref(null)
function onItemKeydown(entry, event) {
  if (event.key === 'Enter') {
    event.preventDefault()
    void open(entry)
  }
}

// Kebab menu: one open at a time, closed by outside click or Escape.
const menuFor = ref(null)
function toggleMenu(entry) {
  menuFor.value = menuFor.value === entry.id ? null : entry.id
}
function onDocumentClick(event) {
  if (!event.composedPath().some((node) => node.classList?.contains('browser-menu-wrap'))) {
    menuFor.value = null
  }
}
function onKeydown(event) {
  if (event.key === 'Escape') menuFor.value = null
}
onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})

// Rename: inline input on the item, like the sidebar's folder rename.
const renamingId = ref(null)
const renameValue = ref('')
const renameInput = ref(null)
async function startRename(entry) {
  menuFor.value = null
  renamingId.value = entry.id
  renameValue.value = entry.name
  await nextTick()
  renameInput.value?.[0]?.select?.()
}
function submitRename(entry) {
  if (renamingId.value !== entry.id) return
  renamingId.value = null
  const name = renameValue.value.trim()
  if (!name || name === entry.name) return
  if (entry.kind === 'folder') return store.renameFolder(entry.id, name)
  if (entry.kind === 'document') return store.updateDocumentMeta(entry.id, { title: name })
  return store.renameFile(entry.id, name)
}

async function remove(entry) {
  menuFor.value = null
  if (entry.kind === 'folder') {
    if (!window.confirm(`Delete folder "${entry.name}" and its subfolders?`)) return
    return store.deleteFolder(entry.id)
  }
  if (entry.kind === 'document') {
    if (!confirmDocumentDelete(entry.item)) return
    return store.deleteDocument(entry.id)
  }
  if (!window.confirm(`Delete file "${entry.name}"?\n\nThis action cannot be undone.`)) return
  return store.deleteFile(entry.id)
}

// Move to: a flat list of every folder with its path, plus the root.
const moveTargetsFor = ref(null)
const folderPaths = computed(() =>
  store.folders
    .map((folder) => ({
      id: folder.id,
      path: folderBreadcrumb(store.folders, folder.id)
        .slice(1)
        .map((crumb) => crumb.title)
        .join(' / '),
    }))
    .sort((a, b) => a.path.localeCompare(b.path)),
)
function moveTo(entry, folderId) {
  moveTargetsFor.value = null
  menuFor.value = null
  if (entry.kind === 'document') return store.moveDocument(entry.id, folderId)
  return store.moveFile(entry.id, folderId)
}

// Drag and drop: items carry "<kind>:<id>" so the sidebar tree can accept
// them too; folder cards accept both document and file drops. External file
// drops anywhere on the pane upload into the current folder.
const dropTargetId = ref(undefined)
const dragOverPane = ref(false)
function onDragStart(entry, event) {
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', `${entry.kind}:${entry.id}`)
}
function hasFiles(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}
function onFolderDragOver(entry, event) {
  if (hasFiles(event)) return
  event.preventDefault()
  event.stopPropagation()
  event.dataTransfer.dropEffect = 'move'
  dropTargetId.value = entry.id
}
function onFolderDrop(entry, event) {
  if (hasFiles(event)) return
  event.preventDefault()
  event.stopPropagation()
  dropTargetId.value = undefined
  const [kind, id] = String(event.dataTransfer.getData('text/plain')).split(':')
  if (kind === 'document') void store.moveDocument(id, entry.id)
  else if (kind === 'file') void store.moveFile(id, entry.id)
}
function onPaneDragOver(event) {
  if (!hasFiles(event)) return
  event.preventDefault()
  dragOverPane.value = true
}
function onPaneDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) dragOverPane.value = false
}
function onPaneDrop(event) {
  dragOverPane.value = false
  dropTargetId.value = undefined
  const dropped = Array.from(event.dataTransfer?.files ?? [])
  if (!dropped.length) return
  event.preventDefault()
  void store.uploadFiles(dropped, props.folderId)
}
const fileInput = ref(null)
function onFilesChosen(event) {
  const chosen = Array.from(event.target.files ?? [])
  event.target.value = ''
  if (chosen.length) void store.uploadFiles(chosen, props.folderId)
}

function kindLabel(entry) {
  if (entry.kind === 'folder') return 'Folder'
  if (entry.kind === 'document') return 'Document'
  return fileKind(entry.item.mime_type)
}
function detail(entry) {
  if (entry.kind === 'file') return formatBytes(entry.item.size_bytes)
  if (entry.kind === 'document' && entry.item.updated_at) {
    return new Date(entry.item.updated_at).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return ''
}
</script>

<template>
  <section
    class="documents-browser"
    :class="[`layout-${layout}`, { 'drop-active': dragOverPane }]"
    aria-label="Folder contents"
    @dragover="onPaneDragOver"
    @dragleave="onPaneDragLeave"
    @drop="onPaneDrop"
  >
    <header class="browser-toolbar">
      <nav class="browser-breadcrumb" aria-label="Folder path">
        <button type="button" class="browser-refresh" aria-label="Refresh" @click="load(true)">
          <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
        </button>
        <template v-for="(crumb, index) in crumbs" :key="crumb.id ?? 'root'">
          <span v-if="index" class="crumb-separator" aria-hidden="true">›</span>
          <router-link v-if="index < crumbs.length - 1" :to="folderRoute(crumb.id)">
            {{ crumb.title }}
          </router-link>
          <span v-else aria-current="location">{{ crumb.title }}</span>
        </template>
      </nav>
      <div class="browser-actions">
        <button
          type="button"
          class="browser-upload"
          aria-label="Upload files"
          @click="fileInput.click()"
        >
          <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>
          <span>Upload</span>
        </button>
        <input ref="fileInput" type="file" multiple hidden @change="onFilesChosen" />
        <div class="layout-toggle" role="group" aria-label="Layout">
          <button
            type="button"
            :class="{ active: layout === 'list' }"
            :aria-pressed="layout === 'list'"
            aria-label="List view"
            @click="setLayout('list')"
          >
            <span class="material-symbols-outlined" aria-hidden="true">view_list</span>
          </button>
          <button
            type="button"
            :class="{ active: layout === 'grid' }"
            :aria-pressed="layout === 'grid'"
            aria-label="Grid view"
            @click="setLayout('grid')"
          >
            <span class="material-symbols-outlined" aria-hidden="true">grid_view</span>
          </button>
        </div>
      </div>
    </header>

    <p v-if="filePage?.error" class="browser-error" role="alert">
      {{ filePage.error }}
      <button type="button" @click="load(true)">Retry</button>
    </p>

    <div v-if="loading && !items.length && !uploads.length" class="documents-loading">
      <div class="spinner"></div>
    </div>
    <p v-else-if="!items.length && !uploads.length" class="browser-empty">
      This folder is empty. Create a document or drop files here.
    </p>

    <ul v-else class="browser-items" :aria-busy="loading">
      <li
        v-for="upload in uploads"
        :key="upload.id"
        class="browser-item upload-item"
        data-kind="upload"
        :class="`upload-${upload.status}`"
      >
        <span class="item-icon material-symbols-outlined" aria-hidden="true">upload_file</span>
        <span class="item-name">{{ upload.name }}</span>
        <span v-if="upload.status === 'uploading'" class="item-kind" role="status">Uploading…</span>
        <template v-else>
          <span class="item-kind item-error" role="alert">{{ upload.error }}</span>
          <button
            type="button"
            class="item-dismiss"
            aria-label="Dismiss"
            @click="store.dismissUpload(upload.id)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </template>
      </li>

      <li
        v-for="entry in items"
        :key="`${entry.kind}:${entry.id}`"
        class="browser-item"
        :class="{ selected: selectedId === entry.id, 'drop-target': dropTargetId === entry.id }"
        :data-kind="entry.kind"
        :data-id="entry.id"
        tabindex="0"
        :draggable="entry.kind !== 'folder'"
        @click="selectedId = entry.id"
        @dblclick="open(entry)"
        @keydown="onItemKeydown(entry, $event)"
        @dragstart="onDragStart(entry, $event)"
        @dragover="entry.kind === 'folder' && onFolderDragOver(entry, $event)"
        @dragleave="dropTargetId = undefined"
        @drop="entry.kind === 'folder' && onFolderDrop(entry, $event)"
      >
        <span
          v-if="entry.kind === 'folder'"
          class="item-icon item-folder material-symbols-outlined"
          aria-hidden="true"
          >folder</span
        >
        <span
          v-else-if="entry.kind === 'document'"
          class="item-icon item-emoji"
          aria-hidden="true"
          >{{ entry.item.emoji }}</span
        >
        <span v-else class="item-icon material-symbols-outlined" aria-hidden="true">{{
          fileIcon(entry.item.mime_type)
        }}</span>

        <input
          v-if="renamingId === entry.id"
          ref="renameInput"
          v-model="renameValue"
          class="item-rename"
          :aria-label="`Rename ${entry.name}`"
          @click.stop
          @dblclick.stop
          @keydown.enter.prevent="submitRename(entry)"
          @keydown.escape="renamingId = null"
          @blur="submitRename(entry)"
        />
        <span v-else class="item-name">{{ entry.name }}</span>
        <span class="item-kind">{{ kindLabel(entry) }}</span>
        <span class="item-detail">{{ detail(entry) }}</span>

        <span class="browser-menu-wrap" @click.stop @dblclick.stop>
          <button
            type="button"
            class="item-menu-btn"
            :aria-label="`Actions for ${entry.name}`"
            :aria-expanded="menuFor === entry.id"
            @click="toggleMenu(entry)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">more_vert</span>
          </button>
          <div v-if="menuFor === entry.id" class="browser-menu" role="menu">
            <button type="button" role="menuitem" data-action="open" @click="open(entry)">
              Open
            </button>
            <button type="button" role="menuitem" data-action="rename" @click="startRename(entry)">
              Rename
            </button>
            <button
              v-if="entry.kind !== 'folder'"
              type="button"
              role="menuitem"
              data-action="move"
              @click="moveTargetsFor = moveTargetsFor === entry.id ? null : entry.id"
            >
              Move to…
            </button>
            <div v-if="moveTargetsFor === entry.id" class="browser-move-targets">
              <button type="button" role="menuitem" @click="moveTo(entry, null)">
                Documents (root)
              </button>
              <button
                v-for="target in folderPaths"
                :key="target.id"
                type="button"
                role="menuitem"
                :disabled="target.id === (entry.item.folder_id ?? null)"
                @click="moveTo(entry, target.id)"
              >
                {{ target.path }}
              </button>
            </div>
            <button
              v-if="entry.kind === 'document'"
              type="button"
              role="menuitem"
              data-action="star"
              @click="
                store.toggleStar(entry.id)
                menuFor = null
              "
            >
              {{ entry.item.starred ? 'Unstar' : 'Star' }}
            </button>
            <button
              v-if="entry.kind === 'file'"
              type="button"
              role="menuitem"
              data-action="download"
              @click="
                download(entry.item)
                menuFor = null
              "
            >
              Download
            </button>
            <button
              type="button"
              role="menuitem"
              data-action="delete"
              class="danger"
              @click="remove(entry)"
            >
              Delete
            </button>
          </div>
        </span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.documents-browser {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 60vh;
  border-radius: 12px;
}
.documents-browser.drop-active {
  outline: 2px dashed var(--accent);
  outline-offset: -2px;
  background: var(--accent-soft);
}
.browser-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
}
.browser-breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 16px;
  color: var(--text-primary);
}
.browser-breadcrumb a {
  color: var(--text-secondary);
  text-decoration: none;
}
.browser-breadcrumb a:hover {
  color: var(--text-primary);
  text-decoration: underline;
}
.crumb-separator {
  color: var(--text-secondary);
}
.browser-refresh,
.item-menu-btn,
.item-dismiss,
.layout-toggle button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.browser-refresh:hover,
.item-menu-btn:hover,
.item-dismiss:hover,
.layout-toggle button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.browser-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.browser-upload {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
}
.browser-upload:hover {
  background: var(--bg-hover);
}
.layout-toggle {
  display: inline-flex;
  padding: 2px;
  border-radius: 8px;
  background: var(--bg-hover);
}
.layout-toggle button.active {
  background: var(--accent);
  color: #fff;
}
.browser-error,
.browser-empty {
  margin: 0;
  padding: 24px;
  color: var(--text-secondary);
  text-align: center;
}
.browser-error button {
  margin-left: 8px;
}
.browser-items {
  list-style: none;
  margin: 0;
  padding: 0;
}
.layout-grid .browser-items {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}
.browser-item {
  position: relative;
  display: grid;
  gap: 4px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  cursor: default;
  outline: none;
  transition: box-shadow var(--transition-fast, 0.15s);
}
.browser-item:hover,
.browser-item:focus-visible {
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
}
.browser-item.selected {
  border-color: var(--accent);
}
.browser-item.drop-target {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.layout-grid .browser-item {
  grid-template-columns: 1fr auto;
  grid-template-areas:
    'icon icon'
    'kind menu'
    'name menu'
    'detail detail';
  padding: 18px 14px 12px;
  min-height: 190px;
}
.layout-grid .item-icon {
  grid-area: icon;
  justify-self: center;
  font-size: 88px;
  line-height: 1;
  margin-bottom: 14px;
}
.layout-grid .item-emoji {
  font-size: 64px;
}
.item-folder {
  color: #4a7de0;
  font-variation-settings: 'FILL' 1;
}
.layout-grid .item-kind {
  grid-area: kind;
  font-size: 12px;
  color: var(--text-secondary);
}
.layout-grid .item-name,
.layout-grid .item-rename {
  grid-area: name;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.layout-grid .item-detail {
  grid-area: detail;
  font-size: 12px;
  color: var(--text-secondary);
}
.layout-grid .browser-menu-wrap {
  grid-area: menu;
  align-self: center;
}
.layout-list .browser-item {
  grid-template-columns: 32px minmax(0, 1fr) 120px 140px 40px;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  margin-bottom: 6px;
}
.layout-list .item-icon {
  font-size: 24px;
  text-align: center;
}
.layout-list .item-name,
.layout-list .item-rename {
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.layout-list .item-kind,
.layout-list .item-detail {
  font-size: 13px;
  color: var(--text-secondary);
}
.item-rename {
  font: inherit;
  padding: 2px 6px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
}
.item-error {
  color: #c0392b;
}
.upload-item {
  opacity: 0.85;
}
.browser-menu-wrap {
  position: relative;
}
.browser-menu {
  position: absolute;
  right: 0;
  top: 100%;
  z-index: var(--z-header, 20);
  min-width: 160px;
  padding: 6px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}
.browser-menu button {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}
.browser-menu button:hover:not(:disabled) {
  background: var(--bg-hover);
}
.browser-menu button:disabled {
  opacity: 0.5;
}
.browser-menu button.danger {
  color: #c0392b;
}
.browser-move-targets {
  max-height: 220px;
  overflow: auto;
  margin: 4px 0;
  padding-left: 8px;
  border-left: 2px solid var(--border-color);
}
@media (max-width: 640px) {
  .layout-grid .browser-items {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  }
  .layout-list .browser-item {
    grid-template-columns: 28px minmax(0, 1fr) 40px;
  }
  .layout-list .item-kind,
  .layout-list .item-detail {
    display: none;
  }
}
</style>
```

- [ ] **Step 4: Run the component test**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Web && npx vitest run src/components/__tests__/DocumentsBrowser.spec.js
```

Expected: all pass. If `renameInput.value?.[0]` is not an array (Vue collects refs in `v-for` as arrays), handle both: `const el = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value; el?.select?.()`.

- [ ] **Step 5: Commit**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Web && npm run lint && npm run format:check && git add src/components/DocumentsBrowser.vue src/components/__tests__/DocumentsBrowser.spec.js && git commit -m "documents: folder browser component with grid and list layouts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: FilePreview component and route

**Files:**

- Create: `Cookie-Web/src/components/FilePreview.vue`
- Modify: `Cookie-Web/src/router/index.js`
- Modify: `Cookie-Web/src/App.vue:44`
- Test: `Cookie-Web/src/components/__tests__/FilePreview.spec.js`

**Interfaces:**

- Consumes: `store.loadFile(id)`, `store.fetchFileBlob(id)`, `isPreviewable`.
- Produces: `<FilePreview :file-id="string" />`; route `{ path: '/documents/file/:fileId', name: 'document-file' }` rendering `DocumentsView`.

- [ ] **Step 1: Write the failing test**

`src/components/__tests__/FilePreview.spec.js`:

```js
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import FilePreview from '../FilePreview.vue'
import { useDocumentsStore } from '../../stores/documents'

let router
let store
const revoke = vi.fn()

beforeEach(async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/documents/:id?', name: 'documents', component: { template: '<div />' } }],
  })
  await router.push('/documents')
  await router.isReady()
  setActivePinia(createPinia())
  store = useDocumentsStore()
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:preview'),
    revokeObjectURL: revoke,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('FilePreview', () => {
  it('renders a PDF in an iframe and revokes the object URL on unmount', async () => {
    vi.spyOn(store, 'loadFile').mockResolvedValue({
      id: 'x-1',
      name: 'brief.pdf',
      mime_type: 'application/pdf',
    })
    vi.spyOn(store, 'fetchFileBlob').mockResolvedValue(new Blob(['x'], { type: 'application/pdf' }))
    const wrapper = mount(FilePreview, { props: { fileId: 'x-1' }, global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('h1').text()).toBe('brief.pdf')
    expect(wrapper.find('iframe').attributes('src')).toBe('blob:preview')
    wrapper.unmount()
    expect(revoke).toHaveBeenCalledWith('blob:preview')
  })

  it('renders an image in an img', async () => {
    vi.spyOn(store, 'loadFile').mockResolvedValue({
      id: 'x-2',
      name: 'a.png',
      mime_type: 'image/png',
    })
    vi.spyOn(store, 'fetchFileBlob').mockResolvedValue(new Blob(['x'], { type: 'image/png' }))
    const wrapper = mount(FilePreview, { props: { fileId: 'x-2' }, global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('img').attributes('src')).toBe('blob:preview')
  })

  it('shows an error when the file cannot be loaded', async () => {
    vi.spyOn(store, 'loadFile').mockRejectedValue(new Error('gone'))
    const wrapper = mount(FilePreview, { props: { fileId: 'x-3' }, global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('could not be loaded')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Web && npx vitest run src/components/__tests__/FilePreview.spec.js
```

- [ ] **Step 3: Implement FilePreview.vue**

```vue
<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDocumentsStore } from '../stores/documents'
import { isPreviewable } from '../lib/documentFiles'

const props = defineProps({ fileId: { type: String, required: true } })
const store = useDocumentsStore()
const router = useRouter()

const file = ref(null)
const objectUrl = ref('')
const error = ref('')
const loading = ref(false)

function release() {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value)
  objectUrl.value = ''
}

async function load() {
  release()
  error.value = ''
  loading.value = true
  try {
    file.value = await store.loadFile(props.fileId)
    const blob = await store.fetchFileBlob(props.fileId)
    if (isPreviewable(file.value.mime_type)) {
      objectUrl.value = URL.createObjectURL(blob)
    } else {
      download(blob)
    }
  } catch {
    error.value = 'This file could not be loaded.'
  } finally {
    loading.value = false
  }
}

function download(blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.value?.name || 'download'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function downloadCurrent() {
  try {
    download(await store.fetchFileBlob(props.fileId))
  } catch {
    store.notify('Download failed.', 'error')
  }
}

function close() {
  const folder = file.value?.folder_id
  router.push(folder ? { path: '/documents', query: { folder } } : '/documents')
}

watch(() => props.fileId, load, { immediate: true })
onBeforeUnmount(release)
</script>

<template>
  <section class="file-preview" aria-label="File preview">
    <header class="file-preview-header">
      <button type="button" class="back-link" aria-label="Back to folder" @click="close">
        <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
      </button>
      <h1>{{ file?.name || 'File' }}</h1>
      <button
        type="button"
        class="file-preview-download"
        :disabled="!file"
        @click="downloadCurrent"
      >
        <span class="material-symbols-outlined" aria-hidden="true">download</span>
        <span>Download</span>
      </button>
    </header>
    <p v-if="error" role="alert" class="file-preview-error">{{ error }}</p>
    <div v-else-if="loading" class="documents-loading"><div class="spinner"></div></div>
    <div v-else-if="objectUrl" class="file-preview-body">
      <img v-if="file.mime_type.startsWith('image/')" :src="objectUrl" :alt="file.name" />
      <iframe v-else :src="objectUrl" :title="file.name"></iframe>
    </div>
    <p v-else class="file-preview-error">
      This file type has no preview. Its download has started.
    </p>
  </section>
</template>

<style scoped>
.file-preview {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 70vh;
}
.file-preview-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0 16px;
}
.file-preview-header h1 {
  flex: 1;
  margin: 0;
  font-size: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.back-link,
.file-preview-download {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
}
.file-preview-body {
  flex: 1;
  display: flex;
  justify-content: center;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
}
.file-preview-body img {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
  align-self: center;
}
.file-preview-body iframe {
  width: 100%;
  min-height: 75vh;
  border: none;
}
.file-preview-error {
  padding: 24px;
  color: var(--text-secondary);
  text-align: center;
}
</style>
```

- [ ] **Step 4: Add the route and sidebar mapping**

In `src/router/index.js`, before the `/documents/:id?` entry insert:

```js
    {
      path: '/documents/file/:fileId',
      name: 'document-file',
      component: () => import('../views/DocumentsView.vue'),
      meta: { requiresAuth: true },
    },
```

In `src/App.vue` line 44 change `if (route.name === 'documents') return 'documents'` to `if (route.name === 'documents' || route.name === 'document-file') return 'documents'`.

- [ ] **Step 5: Run the test and commit**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Web && npx vitest run src/components/__tests__/FilePreview.spec.js && npm run lint && npm run format:check && git add src/components/FilePreview.vue src/components/__tests__/FilePreview.spec.js src/router/index.js src/App.vue && git commit -m "documents: inline preview route for uploaded images and PDFs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Wire the browser and preview into DocumentsView, sidebar navigation and drops

**Files:**

- Modify: `Cookie-Web/src/views/DocumentsView.vue` (script lines 243-320, template lines 323, 496-616)
- Modify: `Cookie-Web/src/components/DocumentsSidebar.vue` (script `toggleFolder`, `onDragOver`, `onDrop`; template folder rows)
- Test: `Cookie-Web/src/components/__tests__/DocumentsSidebar.spec.js` additions

**Interfaces:**

- Consumes: `DocumentsBrowser`, `FilePreview`.
- Produces: default dashboard is the browser scoped by `route.query.folder`; starred, tag and search still render the table.

- [ ] **Step 1: Write the failing sidebar tests**

Append to `src/components/__tests__/DocumentsSidebar.spec.js` inside the main describe (the file has `mountSidebar`, `push`, `FOLDERS`):

```js
it('navigates the browser to a folder when its row is clicked', async () => {
  const wrapper = mountSidebar()
  await flushPromises()
  await wrapper.find('.folder-item').trigger('click')
  expect(push).toHaveBeenCalledWith({ path: '/documents', query: { folder: 'f-projects' } })
})

it('accepts a file dragged from the browser onto a folder row', async () => {
  const wrapper = mountSidebar()
  await flushPromises()
  const store = useDocumentsStore()
  const moveFile = vi.spyOn(store, 'moveFile').mockResolvedValue()
  await wrapper.find('.folder-item').trigger('drop', {
    dataTransfer: { types: ['text/plain'], getData: () => 'file:x-1' },
  })
  expect(moveFile).toHaveBeenCalledWith('x-1', 'f-projects')
})
```

Run `npx vitest run src/components/__tests__/DocumentsSidebar.spec.js` and confirm the two new tests fail.

- [ ] **Step 2: Sidebar changes**

In `DocumentsSidebar.vue` script:

```js
function toggleFolder(id) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
  // The browser pane follows the tree: clicking a folder shows its contents.
  router.push({ path: '/documents', query: { folder: id } })
}
```

Check `router` is already defined via `useRouter()` in that script (it uses `route`; add `const router = useRouter()` and import `useRouter` if missing).

Replace `onDragOver` and `onDrop`:

```js
function onDragOver(folderId, event) {
  const external = Array.from(event.dataTransfer?.types ?? []).includes('text/plain')
  if (!dragDocId.value && !external) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  dropFolderId.value = folderId
}

function onDrop(folderId, event) {
  const ownDocId = dragDocId.value
  dragDocId.value = null
  dropFolderId.value = undefined
  // Items dragged in from the browser pane carry "<kind>:<id>"; the tree's
  // own rows only set dragDocId.
  const data = ownDocId ? '' : String(event?.dataTransfer?.getData?.('text/plain') ?? '')
  const [kind, draggedId] = data.includes(':') ? data.split(':') : ['document', data]
  const docId = ownDocId || (kind === 'document' ? draggedId : null)
  if (kind === 'file' && draggedId) {
    void store.moveFile(draggedId, folderId)
    return
  }
  if (!docId) return
  const doc = store.documents.find((candidate) => candidate.id === docId)
  if ((doc?.folder_id ?? null) === folderId) return
  store.moveDocument(docId, folderId)
}
```

In the template, every `@drop="onDrop(...)"` / `@drop.stop="onDrop(...)"` gains `$event` as the second argument: `@drop="onDrop(null, $event)"`, `@drop.stop="onDrop(row.item.id, $event)"`, `@drop="onDrop(treeDropTarget($event), $event)"`.

Run the sidebar spec again. Expected: all pass (including the existing drag tests).

- [ ] **Step 3: DocumentsView script**

Add imports:

```js
import DocumentsBrowser from '../components/DocumentsBrowser.vue'
import FilePreview from '../components/FilePreview.vue'
```

After `const activeTag = computed(...)` add:

```js
const currentFolderId = computed(() => {
  const value = Array.isArray(route.query.folder) ? route.query.folder[0] : route.query.folder
  const id = String(value ?? '')
  // An unknown or foreign folder id falls back to the root once folders are known.
  if (!id || (store.isLoaded && !store.folders.some((folder) => folder.id === id))) return null
  return id
})
// The folder browser is the default; starred, tag and search cut across
// folders and keep the flat table.
const showBrowser = computed(
  () => !starredOnly.value && !activeTag.value && !store.activeSearchQuery,
)
```

- [ ] **Step 4: DocumentsView template**

Change line 323 `<template v-if="route.params.id">` to `<template v-if="route.params.id && !route.params.fileId">`.

Before the `<!-- Dashboard -->` comment insert:

```vue
<FilePreview v-if="route.params.fileId" :file-id="String(route.params.fileId)" />
```

Change `<template v-if="!route.params.id">` (dashboard) to `<template v-if="!route.params.id && !route.params.fileId">`.

Inside the dashboard, replace the block from `<div v-if="store.isLoading && !store.isLoaded" class="documents-loading">` through the closing `</div>` of `document-pagination` with:

```vue
<DocumentsBrowser v-if="showBrowser" :folder-id="currentFolderId" />

<template v-else>
  <div v-if="store.isLoading && !store.isLoaded" class="documents-loading">
    <div class="spinner"></div>
  </div>

  <div v-else-if="!dashboardDocs.length" class="documents-empty">
    <p v-if="store.activeSearchQuery">No documents match “{{ store.activeSearchQuery }}”.</p>
    <p v-else-if="activeTag">No documents tagged #{{ activeTag }}.</p>
    <p v-else>No starred documents yet — star one from the list or the sidebar.</p>
  </div>

  <table v-else class="documents-table">
    ...existing thead/tbody unchanged...
  </table>
  <div v-if="store.workspacePaged && !store.activeSearchQuery" class="document-pagination">
    ...existing pagination unchanged...
  </div>
</template>
```

Keep the table and pagination markup exactly as it is today, only nested inside the `<template v-else>`. Update the subtitle text in the header from "Notes and docs, organised in folders. Autosaved as you type." to "Notes, docs and files, organised in folders." only when `showBrowser` is true; otherwise keep the current copy:

```vue
activeTag ? `Documents tagged #${activeTag}` : showBrowser ? 'Notes, docs and files, organised in
folders.' : 'Notes and docs, organised in folders. Autosaved as you type.'
```

Also, the `watch` that calls `store.loadDocumentPage(dashboardScope.value)` immediately still runs for the flat scope; leave it.

- [ ] **Step 5: Run the unit suite, lint, format**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Web && npx vitest run && npm run lint && npm run format:check
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Web && git add src/views/DocumentsView.vue src/components/DocumentsSidebar.vue src/components/__tests__/DocumentsSidebar.spec.js && git commit -m "documents: folder browser is the default dashboard; sidebar folders navigate it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: e2e fixture for /files and Playwright updates

**Files:**

- Modify: `Cookie-Web/vite.config.js` (handleWorkerTasksApi, around line 1266)
- Modify: `Cookie-Web/e2e/documents.spec.js` (lines 45-47, 166-175, 613-616, plus one new test)

**Interfaces:**

- Consumes: the Worker wire shapes from Task 2.

- [ ] **Step 1: Add the fixture handler**

In `vite.config.js`, inside `handleWorkerTasksApi` after the `documents` branch add:

```js
if (segments[0] === 'files') {
  state.docFiles ??= []
  const publicRow = ({ bytes: _bytes, ...row }) => row
  if (segments.length === 1 && req.method === 'GET') {
    const folder = url.searchParams.get('folder')
    const wanted = folder && folder !== 'root' ? folder : null
    return json(res, {
      files: state.docFiles.filter((row) => (row.folder_id ?? null) === wanted).map(publicRow),
    })
  }
  if (segments.length === 1 && req.method === 'POST') {
    const { Readable } = await import('node:stream')
    const upload = new Request('http://localhost/files', {
      method: 'POST',
      headers: { 'content-type': req.headers['content-type'] || '' },
      body: Readable.toWeb(req),
      duplex: 'half',
    })
    const form = await upload.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return json(res, { error: 'No file provided' }, 400)
    if (file.size > 25 * 1024 * 1024) return json(res, { error: 'File is larger than 25 MB' }, 413)
    const now = new Date().toISOString()
    const row = {
      id: `stub-file-${randomUUID()}`,
      folder_id: form.get('folder') || null,
      name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
      created_at: now,
      updated_at: now,
      bytes: Buffer.from(await file.arrayBuffer()),
    }
    state.docFiles.push(row)
    return json(res, { file: publicRow(row) }, 201)
  }
  const row = state.docFiles.find((candidate) => candidate.id === segments[1])
  if (!row) return json(res, { error: 'File not found' }, 404)
  if (segments[2] === 'content') {
    res.statusCode = 200
    res.setHeader('Content-Type', row.mime_type)
    res.setHeader('Content-Length', String(row.bytes.length))
    res.setHeader('Content-Disposition', `inline; filename="${row.name}"`)
    res.end(row.bytes)
    return
  }
  if (req.method === 'GET') return json(res, { file: publicRow(row) })
  if (req.method === 'PATCH') {
    const body = await readBody(req)
    if (body.name !== undefined) row.name = body.name
    if (Object.hasOwn(body, 'folder')) row.folder_id = body.folder
    row.updated_at = new Date().toISOString()
    return json(res, { file: publicRow(row) })
  }
  if (req.method === 'DELETE') {
    state.docFiles = state.docFiles.filter((candidate) => candidate !== row)
    res.statusCode = 204
    res.end()
    return
  }
  return json(res, { error: 'Method not allowed' }, 405)
}
```

Confirm `randomUUID` is already imported at the top of `vite.config.js` (it is used by the projects stub).

- [ ] **Step 2: Update the existing specs**

Line 45-47 (first test): replace

```js
await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible()
await page.locator('.documents-table-row', { hasText: 'Floor plan notes' }).click()
```

with

```js
// The dashboard browses one folder at a time: drill into Projects, then
// Kitchen Renovation, and open the document from there.
await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible()
await page.locator('.browser-item[data-kind="folder"]', { hasText: 'Projects' }).dblclick()
await expect(page.locator('.browser-breadcrumb')).toContainText('Projects')
await page
  .locator('.browser-item[data-kind="folder"]', { hasText: 'Kitchen Renovation' })
  .dblclick()
await page
  .locator('.browser-item[data-kind="document"]', { hasText: 'Floor plan notes' })
  .dblclick()
```

Lines 166-175 (deletion test): replace the `scratchpad` locator and button with

```js
const scratchpad = page.locator('.browser-item[data-kind="document"]', { hasText: 'Scratchpad' })
await scratchpad.getByRole('button', { name: 'Actions for Scratchpad' }).click()
const deleteButton = page.locator('.browser-menu button[data-action="delete"]')
```

and for the second dialog in that test reopen the menu the same way before clicking delete again (read the rest of the test and mirror it).

Lines 613-616 (search test): replace

```js
const dashboard = page.locator('.documents-table')
await expect(dashboard.getByText('Floor plan notes')).toBeVisible()
await expect(dashboard.getByText('Scratchpad')).toBeVisible()
```

with

```js
const dashboard = page.locator('.documents-browser')
await expect(dashboard.getByText('Projects')).toBeVisible()
await expect(dashboard.getByText('Scratchpad')).toBeVisible()
```

Line 128-129 (tag filter) keeps `.documents-table-row`: the tag view still renders the table.

- [ ] **Step 3: Add the upload test**

Append to `e2e/documents.spec.js`:

```js
test('Files can be uploaded into a folder, switched to list view, previewed and deleted', async ({
  page,
}) => {
  await page.goto('/documents?folder=stub-folder-projects')
  await expect(page.locator('.browser-breadcrumb')).toContainText('Projects')

  await page.locator('input[type="file"]').setInputFiles({
    name: 'brief.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 stub'),
  })
  const card = page.locator('.browser-item[data-kind="file"]', { hasText: 'brief.pdf' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('PDF')

  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.locator('.documents-browser')).toHaveClass(/layout-list/)
  await expect(card).toContainText('B')
  await page.reload()
  await expect(page.locator('.documents-browser')).toHaveClass(/layout-list/)
  await page.getByRole('button', { name: 'Grid view' }).click()

  await card.dblclick()
  await expect(page).toHaveURL(/\/documents\/file\/stub-file-/)
  await expect(page.locator('.file-preview h1')).toHaveText('brief.pdf')
  await expect(page.locator('.file-preview iframe')).toBeVisible()
  await page.getByRole('button', { name: 'Back to folder' }).click()
  await expect(page).toHaveURL(/\/documents\?folder=stub-folder-projects$/)

  await card.getByRole('button', { name: 'Actions for brief.pdf' }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('.browser-menu button[data-action="delete"]').click()
  await expect(card).toHaveCount(0)
})
```

- [ ] **Step 4: Run the documents e2e spec**

Check `package.json` for the e2e script name (`test:e2e`). Run only this spec:

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Web && npx playwright test e2e/documents.spec.js 2>&1 | tail -20
```

Expected: all documents tests pass. If Playwright needs the dev server, the config starts it (`vite --mode e2e`). Two pre-existing Tasks e2e failures elsewhere are known and unrelated.

- [ ] **Step 5: Commit**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Web && npm run lint && npm run format:check && git add vite.config.js e2e/documents.spec.js && git commit -m "e2e: files fixture and folder-browser flows for Documents

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Docs, push, verify

**Files:**

- Modify: `Cookie-Docs/docs/02-components/01-cookie-web.mdx` (Documents section)
- Modify: `Cookie-Docs/docs/05-operations.mdx` (R2 bucket)
- Modify: `Cookie-Web/README.md` if it describes the Documents dashboard (grep "Documents" and update the sentence about the dashboard table if present).

- [ ] **Step 1: Cookie-Docs**

Find the Documents paragraph with `grep -n -i "documents" ../Cookie-Docs/docs/02-components/01-cookie-web.mdx`. Add after it:

```md
The Documents dashboard is a folder browser: it shows one folder's subfolders, documents and uploaded files as cards or rows (the choice is remembered per browser), with a breadcrumb and an Upload button. Any file type up to 25 MB can be uploaded; images and PDFs open in an inline preview at `/documents/file/<id>`, other types download. Files are stored privately in the `cookie-files` R2 bucket and served only through the authenticated `cookie-web-tasks` Worker (`/files` routes). Starred, tag and search views keep the flat table because they cut across folders.
```

In `05-operations.mdx`, in the Cloudflare or Worker bindings section, add: "`cookie-web-tasks` binds the private R2 bucket `cookie-files` as `FILES` for uploaded Documents files. Create it once with `wrangler r2 bucket create cookie-files`; the bucket is never made public."

Cookie-Docs is a colocated jj repo. Its `npm run lint` fails on a pre-existing eslint config error; run `npx oxlint` and Prettier (`npm run format:check`) instead, then:

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Docs && jj commit -m "docs: Documents folder browser and uploaded files

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && jj bookmark set main -r @- && jj git push --bookmark main
```

- [ ] **Step 2: Push Cookie-Web**

```bash
cd /Users/allistera/Development/Projects/Cookie/Cookie-Web && npx vitest run 2>&1 | tail -3 && npm run lint && npm run format:check && git push origin main && git rev-parse --short origin/main
```

The push triggers the Cloudflare Pages deploy and the `Migrate Database` workflow (the migration was already applied in Task 1; `migrate.sh` must tolerate an already-applied file, which it does by tracking applied migrations, otherwise it errors on the existing table: check `migrations/migrate.sh` and, if it does not track applied files, record 0076 as applied before pushing).

- [ ] **Step 3: Verify in production**

Open `https://mail.infinitywave.online/documents`: the root shows folder cards; upload a small PDF into a folder, preview it, download it, delete it. Check Sentry for new cookie-web-tasks errors after the smoke test.

---

## Self-review

**Spec coverage.** Data model and storage: Task 1. Worker routes including `GET /files/:id` (added beyond the spec so deep links to the preview can load metadata): Tasks 2 and 3. MIME sniff and inline set: Task 2. Navigation by `?folder=`, breadcrumb, refresh, contents ordering, grid/list persistence, kebab actions (open, rename, move to, star, delete, download), drag-and-drop onto folder cards and the sidebar tree: Tasks 5, 7, 9. Upload button and pane drop, placeholders, 25 MB client rejection, per-file requests: Tasks 6 and 7. Preview route and object URL revoke, download for other types: Task 8. Starred, tag and search keep the table: Task 9. Error handling (retry on a failed listing, optimistic rollback, R2 cleanup, reported object-delete failures): Tasks 2, 6, 7. Tests and e2e fixture: every task plus Task 10. Docs and rollout: Task 11.

**Placeholders.** None: every step carries its code.

**Type consistency.** Store actions named `loadFiles`, `loadFile`, `uploadFiles`, `uploadFile`, `dismissUpload`, `renameFile`, `moveFile`, `deleteFile`, `fetchFileBlob`, `filesForFolder` are used with those names in Tasks 7, 8 and 9. Worker exports in Task 2 match the imports in Task 3. Drag payload `"<kind>:<id>"` is produced in Task 7 and consumed in Task 9. Route name `document-file` is declared in Task 8 and used in App.vue in the same task.
