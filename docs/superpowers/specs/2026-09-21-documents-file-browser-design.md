# Documents file browser design

Date: 2026-09-21

## Goal

Turn the Documents dashboard into a folder browser, one folder at a time, with a
grid or list layout, and let it hold uploaded files of any type alongside
documents. Files are stored privately and are previewed inline when they are
images or PDFs, and downloaded otherwise.

The look follows a conventional file manager (folder cards, kind label, kebab
menu, list/grid toggle in the header). It is built natively on the existing
Vue, Pinia and Worker code. No file-manager library is added.

## Non-goals

- Files are not searchable, taggable, starred, versioned or visible to the
  document AI. They live next to documents but share none of the document
  machinery.
- No sharing, public links or per-file permissions. Every file belongs to one
  user and is served only to that user.
- No thumbnails for images in the grid; cards show a type icon.
- No column view; only grid and list.
- The sidebar tree keeps its current behaviour. Starred, tag filter and search
  keep the current flat table, since they cut across folders.

## Data model

One migration in Cookie-Web adds `document_files`:

| column     | type        | notes                                                      |
| ---------- | ----------- | ---------------------------------------------------------- |
| id         | uuid        | primary key, `gen_random_uuid()`                           |
| user_id    | uuid        | references `users`, cascade                                |
| folder_id  | uuid        | references `document_folders`, SET NULL on folder delete   |
| name       | text        | display name, trimmed, at most 255 characters, never empty |
| mime_type  | text        | stored as untrusted; sniffed for images and PDFs           |
| size_bytes | bigint      |                                                            |
| object_key | text        | unique; `<user_id>/<file uuid>`                            |
| created_at | timestamptz |                                                            |
| updated_at | timestamptz |                                                            |

Index `(user_id, folder_id, created_at DESC)` for folder listings. Row-level
security enabled and privileges revoked from `anon` and `authenticated`,
matching the documents tables.

Deleting a folder cascades subfolders and orphans documents to the root today;
files follow the document rule, so deleting a folder destroys no files.

## Storage

A private R2 bucket `cookie-files`, bound to `cookie-web-tasks` as `FILES`.
Object keys never contain a client-supplied name. The bucket is never made
public; bytes only leave through the authenticated Worker.

## Worker API (cookie-web-tasks)

All routes use the Worker's existing Auth0 bearer verification, CORS handling
and per-user rate limiting. Ownership is checked by `user_id` on every row read.

| method | path                 | behaviour                                                                                                                                                                                                                                                                |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/files?folder=<id>` | Files in the folder, newest first, metadata only. `folder=root` or omitted means the root (`folder_id IS NULL`). A folder the user does not own returns an empty list.                                                                                                   |
| POST   | `/files`             | Multipart upload via `Request.formData()`: field `file`, optional `folder`. 25 MB cap, checked from the request `Content-Length` before reading and from the bytes after. Writes the R2 object first, then the row; a failed insert deletes the object. Returns the row. |
| GET    | `/files/:id/content` | Streams the object with `Content-Type`, `Content-Length`, `Content-Disposition` (inline for images and PDFs, attachment otherwise, filename encoded per RFC 5987) and `Cache-Control: private, no-store`.                                                                |
| PATCH  | `/files/:id`         | JSON body with `name` and/or `folder` (uuid or null). Both validated like the document equivalents. Returns the row.                                                                                                                                                     |
| DELETE | `/files/:id`         | Deletes the row, then the object. A failed object delete is logged and reported to Sentry with the file id, not surfaced to the user, since the row is already gone.                                                                                                     |

MIME type: images (jpeg, png, gif, webp) and PDF are sniffed from the leading
bytes with the existing `sniffImageType` helper extended for PDF. When the
sniff succeeds it wins over the client type. Otherwise the client type is
stored after basic validation, or `application/octet-stream` when absent.
Only the sniffed set is ever served inline.

Structured log events: `file_uploaded`, `file_upload_rejected`,
`file_object_delete_failed`. Sentry captures carry the file id, never the name.

## Client

### Navigation

The current folder comes from the route query, `/documents?folder=<id>`. No
query means the root. Clicking a folder in the sidebar tree navigates the
browser; clicking a folder card or row does the same. A breadcrumb (Documents
› Work › 2026) sits above the content with a refresh button. Folder ids in the
query that the user does not own fall back to the root.

### Contents

One ordered list per folder, built by a pure helper `folderContents(folders,
documents, files, folderId)`: folders first by title, then documents and files
together by name, case-insensitive. Sources:

- Folders from the store's existing tree.
- Documents from the store's existing `pageFor({ folder })`, keeping its paging
  and realtime updates.
- Files from a new `filePages` map in the store keyed by folder, loaded on first
  visit and on refresh.

### Layout

A grid/list toggle in the header. Grid is the default. Cards show a folder
icon or a file-type icon, the name, a kind label and a kebab menu. Rows show
name, kind, size for files or updated time for documents, and the kebab menu.
The choice persists in local storage under `cookie-documents-layout`, using the
same read and write pattern as the expanded-folders key. Single click selects,
double click or Enter opens.

### Actions

Kebab menu and keyboard: open, rename, move to folder, star (documents only),
delete with the existing confirmation, download (files only). Moving reuses
the sidebar's drag-and-drop and also accepts drops onto folder cards and rows.

### Upload

An Upload button (hidden multi-file input) and drops anywhere on the pane call
one store action, `uploadFiles(fileList, folderId)`. Each file posts
separately so one failure does not sink the batch. A placeholder item shows the
name with a progress state and is replaced by the real row on success. Files
over 25 MB are rejected client-side before any request; Worker rejections show
an inline error on the placeholder, dismissed with one click. The bearer token
is attached the way the existing image upload does it.

### Preview and download

Opening an image or PDF navigates to `/documents/file/<id>`, a route declared
ahead of the existing `/documents/:id?` so the `file` segment is never read as
a document id: a full-pane view
with the name, download and close in the header, and the content rendered from
`GET /files/:id/content`. Because that route needs the bearer header, the view
fetches the bytes and displays them through an object URL, revoked on close.
Images render in an `<img>`, PDFs in an `<iframe>`. Any other type performs the
same fetch and triggers a download instead.

### Store

`document_files` rows live in `documents.js` under `files` (by id) and
`filePages` (by folder). Actions: `loadFiles(folderId, { force })`,
`uploadFiles`, `renameFile`, `moveFile`, `deleteFile`, `fetchFileBlob`. Rename,
move and delete update optimistically and roll back on failure, matching
document moves.

## Error handling

- Client: network and Worker errors surface inline on the affected item or as
  the existing toast, never as a blank pane. A failed folder listing shows a
  retry.
- Worker: R2 failures on upload return 502 with a generic body; the object is
  cleaned up when the row insert fails. Unknown ids and other users' ids both
  return 404.

## Testing

Worker (vitest, mock-sql pattern): route dispatch and 405s for `/files`;
upload writes object then row and deletes the object when the insert fails;
sniffed type wins over client type; content route inline versus attachment
and 404 for another user's file; delete removes row then object and reports a
failed object delete without failing the request; 25 MB cap before and after
reading.

SPA (vitest): store actions with optimistic rollback; `folderContents`
ordering; layout preference persistence; breadcrumb from a folder id; browser
view rendering cards versus rows and navigating on folder click; upload
placeholder lifecycle.

E2E: the `vite.config.js` e2e adapter gains a `/files` stub so existing
documents specs keep passing, plus one spec that uploads a file and sees it in
the grid.

## Docs

Cookie-Worker README route table, the Cookie-Docs Documents page, and a
runbook line for creating the R2 bucket and binding.

## Rollout

1. Create the R2 bucket, add the binding, apply the migration.
2. Worker routes and tests; deploy cookie-web-tasks.
3. Store and browser view: grid/list, breadcrumb, folder navigation.
4. Upload, preview, download.
5. Docs; push Cookie-Web to main, which deploys on push.
