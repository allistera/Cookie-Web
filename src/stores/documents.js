import { toRaw } from 'vue'
import { defineStore } from 'pinia'
import { jsonRequest } from '../lib/jsonRequest'
import { scheduleContentSave, flushPendingSave, discardPendingSave } from '../lib/documentSaves'

import { authHeaders as buildAuthHeaders } from '../lib/authHeaders'
import { AI_API_URL, TASKS_API_URL } from '../lib/apiWorkers'
import { MAX_UPLOAD_BYTES, fileFolderKey } from '../lib/documentFiles'
import {
  formatDailyMonthFolder,
  formatDailyNoteTitle,
  formatDailyYearFolder,
  parseDailyNoteDate,
} from '../lib/documentDates'
import { useInboxStore } from './inbox'

const workspaceLoads = new WeakMap()
const pageLoads = new WeakMap()
export const documentPageKey = (scope = {}) =>
  JSON.stringify([scope.folder ?? null, Boolean(scope.starred), scope.tag || null])

// Search: mirrors inbox.js's searchAbortController, kept at module scope for
// the same reason (an AbortController isn't reactive state).
let documentSearchAbortController = null

// The built-in seed for a brand-new daily note, used whenever the user
// hasn't customized one (Settings > Documents > Time Management). Exported
// so the settings pane can show/reset to the same content the store falls
// back to in openTodayNote().
export const DEFAULT_DAILY_NOTE_SEED_BLOCKS = [
  { type: 'header', data: { text: 'Tasks', level: 2 } },
]

// The Documents workspace (paper-style notes): nested folders plus Editor.js
// block documents, backed by /api/tasks?resource=documents. The sidebar tree
// and dashboard read the blockless list rows; opening a document fetches its
// blocks separately, like email bodies.
export const useDocumentsStore = defineStore('documents', {
  state: () => ({
    folders: [],
    documents: [],
    pages: {},
    workspaceVersion: null,
    workspacePaged: false,
    workspaceTags: [],
    templates: [],
    templatesLoaded: false,
    templatesLoading: false,
    isLoaded: false,
    isLoading: false,
    openDocId: null,
    // The open document including its blocks; list rows never carry blocks.
    openDoc: null,
    isOpenDocLoading: false,
    // null | 'saving' | 'saved' | 'error' — drives the editor's status line.
    saveState: null,
    saveConflict: false,
    newDocumentDialogOpen: false,
    newDocumentFolderId: null,
    // Action asked for by the command palette: 'new-folder' (the sidebar
    // owns the inline folder row) or 'export-markdown' / 'export-pdf' (the
    // editor owns the open document's blocks). The owner consumes it.
    viewActionRequest: null,
    // Search: unlike email's searchEmails (which overwrites the flat inbox
    // list), search results live in their own array — DocumentsSidebar
    // builds its persistent folder tree from `documents` continuously while
    // the Documents app is open, and overwriting it during a search would
    // collapse that tree to just the matched rows.
    activeSearchQuery: '',
    searchResults: [],
    // Out-of-order guard for searchDocuments, mirroring inbox.js's listSeq.
    searchSeq: 0,
    // The user's customized daily-note seed, [] when not customized (use
    // DEFAULT_DAILY_NOTE_SEED_BLOCKS instead — see openTodayNote).
    dailyNoteSeed: [],
    dailyNoteSeedLoaded: false,
    dailyNoteSeedLoading: false,
    // Uploaded files (document_files rows) by id, and per-folder pages keyed
    // by fileFolderKey. They share the folder tree with documents but none of
    // the document machinery (search, tags, revisions, AI).
    files: {},
    filePages: {},
    // In-flight or failed uploads shown as placeholders in the browser.
    uploads: [],
  }),

  getters: {
    starredDocuments(state) {
      return state.documents.filter((doc) => doc.starred)
    },
    documentTags(state) {
      if (state.workspacePaged) return state.workspaceTags
      const counts = new Map()
      for (const document of state.documents) {
        for (const tag of document.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
      return [...counts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, count]) => ({ name, count }))
    },
    // The date a daily note (Daily/<year>/<month>/DD-MM-YY, seeded by
    // openTodayNote) represents, or null for any other open document - both
    // the title shape and living under the root "Daily" folder must hold, so
    // a regular note someone happens to title like a date doesn't match.
    openDocDailyDate(state) {
      const doc = state.openDoc
      if (!doc) return null
      const date = parseDailyNoteDate(doc.title)
      if (!date) return null
      const byId = new Map(state.folders.map((folder) => [folder.id, folder]))
      let folder = byId.get(doc.folder_id)
      while (folder?.parent_id) folder = byId.get(folder.parent_id)
      return folder?.title === 'Daily' ? date : null
    },
  },

  actions: {
    // Bearer-token headers for API calls; Auth0 is absent in e2e/fixture mode.
    // Delegates so a dead session is recognised in one place: it sends the
    // person to sign in rather than letting each store report a generic
    // failure against a session that will never work again.
    authHeaders(extra = {}) {
      return buildAuthHeaders(extra)
    },

    notify(message, kind = 'info') {
      useInboxStore().notify(message, kind)
    },

    async request(method, { params = '', body } = {}) {
      const headers = await this.authHeaders(
        body !== undefined ? { 'Content-Type': 'application/json' } : {},
      )
      return jsonRequest(`${TASKS_API_URL}/documents${params}`, { method, headers, body })
    },

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

    // One request per file so a single failure cannot sink the batch; the
    // placeholder stays visible with its error until dismissed.
    async uploadFile(file, folderId = null) {
      this.uploads.push({
        id: `upload-${crypto.randomUUID()}`,
        name: file.name,
        folder_id: folderId,
        size_bytes: file.size,
        status: 'uploading',
        error: null,
      })
      // Work with the reactive entry, not the raw literal, so status changes
      // render and the identity check below holds.
      const placeholder = this.uploads[this.uploads.length - 1]
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
        const response = await fetch(`${TASKS_API_URL}/files`, {
          method: 'POST',
          headers,
          body: form,
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || `Upload failed (${response.status})`)
        }
        const { file: stored } = await response.json()
        this.files[stored.id] = stored
        const page = this.filePages[fileFolderKey(stored.folder_id)]
        if (page?.loaded && !page.ids.includes(stored.id)) page.ids.unshift(stored.id)
        this.uploads = this.uploads.filter((upload) => upload.id !== placeholder.id)
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
      const page = this.filePages[fileFolderKey(file.folder_id)]
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

    async loadWorkspace({ force = false } = {}) {
      if (this.isLoaded && !force) return
      const inFlight = workspaceLoads.get(toRaw(this))
      if (inFlight) return inFlight
      this.isLoading = true
      const load = (async () => {
        try {
          const version = this.workspaceVersion
            ? `&version=${encodeURIComponent(this.workspaceVersion)}`
            : ''
          const metadata = await this.request('GET', { params: `?view=meta${version}` })
          if (metadata.unchanged) {
            await Promise.all(
              Object.entries(this.pages)
                .filter(([, page]) => !page.loaded)
                .map(([key]) => {
                  const [folder, starred, tag] = JSON.parse(key)
                  return this.loadDocumentPage({ folder, starred, tag })
                }),
            )
            return
          }
          this.folders = metadata.folders
          if (Array.isArray(metadata.documents)) {
            // Older Workers and local fixtures still return the full workspace.
            this.workspacePaged = false
            this.workspaceVersion = null
            this.pages = {}
            this.documents = metadata.documents
          } else {
            this.workspacePaged = true
            this.workspaceVersion = metadata.version
            this.workspaceTags = metadata.tags ?? []
            this.pages = {}
            pageLoads.delete(toRaw(this))
            this.documents = []
            await Promise.all([
              this.loadDocumentPage(),
              this.loadDocumentPage({ folder: 'root' }),
              this.loadDocumentPage({ starred: true }),
            ])
          }
          this.isLoaded = true
        } catch (error) {
          console.error('Failed to load documents:', error)
          this.notify('Failed to load documents.', 'error')
        } finally {
          this.isLoading = false
          workspaceLoads.delete(toRaw(this))
        }
      })()
      workspaceLoads.set(toRaw(this), load)
      return load
    },

    pageFor(scope = {}) {
      return this.pages[documentPageKey(scope)]
    },

    documentsForPage(scope = {}) {
      const ids = this.pageFor(scope)?.ids
      if (!ids) return this.documents
      const byId = new Map(this.documents.map((doc) => [doc.id, doc]))
      return ids.map((id) => byId.get(id)).filter(Boolean)
    },

    async loadDocumentPage(scope = {}, { more = false, force = false } = {}) {
      if (!this.workspacePaged) return
      const key = documentPageKey(scope)
      const old = this.pages[key]
      if (old?.loaded && !more && !force) return
      if (more && !old?.nextCursor) return
      const pending = pageLoads.get(toRaw(this)) ?? new Map()
      pageLoads.set(toRaw(this), pending)
      if (pending.has(key)) return pending.get(key)
      const version = this.workspaceVersion
      this.pages[key] ??= { ids: [], nextCursor: null, loaded: false, loading: false }
      const page = this.pages[key]
      page.loading = true
      const params = new URLSearchParams({ view: 'page' })
      if (scope.folder) params.set('folder', scope.folder)
      if (scope.starred) params.set('starred', '1')
      if (scope.tag) params.set('tag', scope.tag)
      if (more) params.set('before', old.nextCursor)
      const request = (async () => {
        try {
          const { documents, nextCursor } = await this.request('GET', { params: `?${params}` })
          if (version !== this.workspaceVersion || this.pages[key] !== page) return
          const byId = new Map(this.documents.map((doc) => [doc.id, doc]))
          for (const doc of documents) byId.set(doc.id, doc)
          this.documents = [...byId.values()]
          page.ids = [...new Set([...(more ? page.ids : []), ...documents.map((doc) => doc.id)])]
          page.nextCursor = nextCursor ?? null
          page.loaded = true
        } catch (error) {
          this.notify(error.userMessage || 'Failed to load documents.', 'error')
        } finally {
          page.loading = false
          pending.delete(key)
        }
      })()
      pending.set(key, request)
      return request
    },

    // Opening a new document flushes any edit still waiting on the debounce
    // timer so switching documents never drops the tail of the last one.
    syncDocumentPages(document, previous = null) {
      if (!this.workspacePaged) return
      const counts = new Map(this.workspaceTags.map(({ name, count }) => [name, count]))
      for (const tag of previous?.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) - 1)
      for (const tag of document?.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
      this.workspaceTags = [...counts]
        .filter(([, count]) => count > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, count]) => ({ name, count }))
      const id = document?.id ?? previous?.id
      for (const [key, page] of Object.entries(this.pages)) {
        const [folder, starred, tag] = JSON.parse(key)
        page.ids = page.ids.filter((existing) => existing !== id)
        if (
          document &&
          (!folder || (folder === 'root' ? !document.folder_id : document.folder_id === folder)) &&
          (!starred || document.starred) &&
          (!tag || document.tags?.includes(tag))
        ) {
          page.ids.unshift(id)
          const byId = new Map(this.documents.map((row) => [row.id, row]))
          page.ids.sort(
            (a, b) =>
              String(byId.get(b)?.updated_at ?? '').localeCompare(
                String(byId.get(a)?.updated_at ?? ''),
              ) || b.localeCompare(a),
          )
        }
      }
    },

    async openDocument(id) {
      if (!(await this.flushPendingSave())) return false
      this.openDocId = id
      this.openDoc = null
      this.saveState = null
      if (!id) return
      this.isOpenDocLoading = true
      try {
        const { document } = await this.request('GET', { params: `?id=${encodeURIComponent(id)}` })
        // Ignore a fetch that resolves after the user has moved on.
        if (this.openDocId === id) this.openDoc = document
      } catch (error) {
        console.error('Failed to load document:', error)
        this.notify('Failed to load the document.', 'error')
        if (this.openDocId === id) this.openDocId = null
      } finally {
        if (this.openDocId === id || this.openDocId === null) this.isOpenDocLoading = false
      }
    },

    async createDocument({ folderId = null, title, templateId = null } = {}) {
      try {
        const body = { kind: 'document', folderId, templateId }
        if (title !== undefined) body.title = title
        const { document } = await this.request('POST', {
          body,
        })
        this.documents.unshift(document)
        this.syncDocumentPages(document)
        return document
      } catch (error) {
        console.error('Failed to create document:', error)
        this.notify('Failed to create the document.', 'error')
        return null
      }
    },

    // "AI document" in the new-document dialog: the ai Worker turns the
    // prompt into a title plus Editor.js blocks, and the row is then created
    // and filled the same way openTodayNote seeds a daily note (create, then
    // PATCH blocks) — POST /documents only takes content from a template.
    async createAiDocument({ folderId = null, instruction }) {
      let generated
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        ;({ document: generated } = await jsonRequest(`${AI_API_URL}/document`, {
          method: 'POST',
          headers,
          body: { instruction },
        }))
      } catch (error) {
        console.error('AI document failed:', error)
        this.notify('AI document failed. Please try again.', 'error')
        return null
      }
      const document = await this.createDocument({ folderId, title: generated.title })
      if (!document) return null
      try {
        await this.request('PATCH', { body: { id: document.id, blocks: generated.blocks } })
      } catch (error) {
        console.error('Failed to fill the AI document:', error)
        this.notify('The document was created but its content could not be saved.', 'error')
      }
      return document
    },

    async loadTemplates({ force = false } = {}) {
      if ((this.templatesLoaded && !force) || this.templatesLoading) return
      this.templatesLoading = true
      try {
        const { templates } = await this.request('GET', { params: '?templates' })
        this.templates = templates ?? []
        this.templatesLoaded = true
      } catch (error) {
        console.error('Failed to load document templates:', error)
        this.notify('Failed to load document templates.', 'error')
      } finally {
        this.templatesLoading = false
      }
    },

    async loadTemplate(id) {
      try {
        const { template } = await this.request('GET', {
          params: `?templateId=${encodeURIComponent(id)}`,
        })
        return template
      } catch (error) {
        console.error('Failed to load document template:', error)
        this.notify('Failed to load the document template.', 'error')
        return null
      }
    },

    async createTemplate({ title, blocks }) {
      try {
        const { template } = await this.request('POST', {
          body: { kind: 'template', title, blocks },
        })
        const { blocks: _blocks, ...row } = template
        this.templates.unshift(row)
        this.templatesLoaded = true
        return template
      } catch (error) {
        console.error('Failed to create document template:', error)
        this.notify('Failed to create the document template.', 'error')
        return null
      }
    },

    async updateTemplate(id, { title, blocks }) {
      try {
        const { template } = await this.request('PATCH', {
          body: { kind: 'template', id, title, blocks },
        })
        const index = this.templates.findIndex((item) => item.id === id)
        if (index !== -1) {
          const { blocks: _blocks, ...row } = template
          this.templates[index] = row
        }
        return template
      } catch (error) {
        console.error('Failed to update document template:', error)
        this.notify('Failed to update the document template.', 'error')
        return null
      }
    },

    async deleteTemplate(id) {
      try {
        await this.request('DELETE', { body: { kind: 'template', id } })
        this.templates = this.templates.filter((template) => template.id !== id)
        return true
      } catch (error) {
        console.error('Failed to delete document template:', error)
        this.notify('Failed to delete the document template.', 'error')
        return false
      }
    },

    // The user's customized default content for new daily notes (Settings >
    // Documents > Time Management). [] means "not customized" — callers fall
    // back to DEFAULT_DAILY_NOTE_SEED_BLOCKS themselves.
    async loadDailyNoteSeed({ force = false } = {}) {
      if ((this.dailyNoteSeedLoaded && !force) || this.dailyNoteSeedLoading) return
      this.dailyNoteSeedLoading = true
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`${TASKS_API_URL}/tasks/daily-note-seed`, { headers })
        if (!response.ok) {
          throw new Error(`GET daily-note-seed responded ${response.status}`)
        }
        const { blocks } = await response.json()
        this.dailyNoteSeed = blocks
        this.dailyNoteSeedLoaded = true
      } catch (error) {
        console.error('Failed to load the daily note default:', error)
      } finally {
        this.dailyNoteSeedLoading = false
      }
    },

    async saveDailyNoteSeed(blocks) {
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch(`${TASKS_API_URL}/tasks/daily-note-seed`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ blocks }),
        })
        if (!response.ok) {
          throw new Error(`PUT daily-note-seed responded ${response.status}`)
        }
        const { blocks: saved } = await response.json()
        this.dailyNoteSeed = saved
        this.dailyNoteSeedLoaded = true
        return true
      } catch (error) {
        console.error('Failed to save the daily note default:', error)
        this.notify('Failed to save the daily note default.', 'error')
        return false
      }
    },

    requestViewAction(action) {
      this.viewActionRequest = { id: (this.viewActionRequest?.id ?? 0) + 1, action }
    },

    openNewDocumentDialog(folderId = null) {
      this.newDocumentFolderId = folderId
      this.newDocumentDialogOpen = true
      this.loadTemplates()
    },

    closeNewDocumentDialog() {
      this.newDocumentDialogOpen = false
      this.newDocumentFolderId = null
    },

    async createFolder({ title, parentId = null }) {
      try {
        const { folder } = await this.request('POST', { body: { kind: 'folder', title, parentId } })
        this.folders.push(folder)
        return folder
      } catch (error) {
        console.error('Failed to create folder:', error)
        this.notify('Failed to create the folder.', 'error')
        return null
      }
    },

    async renameFolder(id, title) {
      try {
        const { folder } = await this.request('PATCH', { body: { kind: 'folder', id, title } })
        const index = this.folders.findIndex((item) => item.id === id)
        if (index !== -1) this.folders[index] = folder
      } catch (error) {
        console.error('Failed to rename folder:', error)
        this.notify('Failed to rename the folder.', 'error')
      }
    },

    // Looks up a folder by parent + title among already-loaded folders,
    // creating it if missing — used to lazily build the Daily/Year/Month tree.
    async findOrCreateFolder(title, parentId) {
      const existing = this.folders.find((f) => f.parent_id === parentId && f.title === title)
      if (existing) return existing
      return await this.createFolder({ title, parentId })
    },

    // The "Today" sidebar shortcut: finds (or creates) today's note inside
    // Daily/<year>/<month> (e.g. Daily/2026/Aug), seeding a fresh note with
    // the user's customized daily-note default (or DEFAULT_DAILY_NOTE_SEED_BLOCKS
    // if they haven't customized one) so it isn't blank the first time it's
    // opened.
    async openTodayNote() {
      // loadWorkspace and loadDailyNoteSeed are independent — run them
      // concurrently instead of sequentially to halve the waterfall depth.
      await Promise.all([this.loadWorkspace(), this.loadDailyNoteSeed()])
      const now = new Date()
      const title = formatDailyNoteTitle(now)

      const daily = await this.findOrCreateFolder('Daily', null)
      if (!daily) return null
      const year = await this.findOrCreateFolder(formatDailyYearFolder(now), daily.id)
      if (!year) return null
      const month = await this.findOrCreateFolder(formatDailyMonthFolder(now), year.id)
      await this.loadDocumentPage({ folder: month.id })
      if (!month) return null

      const existing = this.documents.find((d) => d.folder_id === month.id && d.title === title)
      if (existing) return existing

      const document = await this.createDocument({ folderId: month.id, title })
      if (!document) return null
      const seedBlocks = this.dailyNoteSeed.length
        ? this.dailyNoteSeed
        : DEFAULT_DAILY_NOTE_SEED_BLOCKS
      try {
        await this.request('PATCH', {
          body: { id: document.id, blocks: seedBlocks },
        })
      } catch (error) {
        console.error('Failed to seed the daily note:', error)
      }
      return document
    },

    // Metadata updates (star, move, emoji): applied optimistically to the
    // list row, rolled back if the PATCH fails.
    async updateDocumentMeta(id, patch) {
      const row = this.documents.find((doc) => doc.id === id)
      if (!row) return
      const before = { ...row }
      Object.assign(row, patch.starred !== undefined ? { starred: patch.starred } : {})
      if (patch.folderId !== undefined) row.folder_id = patch.folderId
      if (patch.emoji !== undefined) row.emoji = patch.emoji
      try {
        const { document } = await this.request('PATCH', { body: { id, ...patch } })
        Object.assign(row, document)
        this.syncDocumentPages(row, before)
        if (this.openDoc?.id === id) Object.assign(this.openDoc, document)
      } catch (error) {
        console.error('Failed to update document:', error)
        Object.assign(row, before)
        this.notify('Failed to update the document.', 'error')
      }
    },

    toggleStar(id) {
      const row = this.documents.find((doc) => doc.id === id)
      if (!row) return
      return this.updateDocumentMeta(id, { starred: !row.starred })
    },

    moveDocument(id, folderId) {
      return this.updateDocumentMeta(id, { folderId })
    },

    // The editor debounces block serialization before it hands anything to
    // scheduleContentSave, so between an edit and that handoff the store still
    // holds the previous save's state. Called on every editor change to close
    // that window — otherwise the status line claims "All changes saved" while
    // an edit is still queued upstream.
    markContentDirty() {
      this.saveState = 'saving'
    },

    scheduleContentSave,
    flushPendingSave,

    async saveConflictAsCopy() {
      if (!this.openDoc) return null
      const original = JSON.parse(JSON.stringify(this.openDoc))
      const copy = await this.createDocument({
        folderId: original.folder_id,
        title: `${original.title || 'Untitled'} (copy)`,
      })
      if (!copy) return null
      try {
        const { document } = await this.request('PATCH', {
          body: {
            id: copy.id,
            blocks: original.blocks,
            tags: original.tags ?? [],
            emoji: original.emoji,
          },
        })
        Object.assign(copy, document)
        if (
          ['title', 'blocks', 'tags', 'emoji'].some(
            (field) => JSON.stringify(this.openDoc?.[field]) !== JSON.stringify(original[field]),
          )
        ) {
          this.notify('Copy saved. Your newer edits are still open.')
          return null
        }
        discardPendingSave.call(this, original.id)
        this.saveState = 'saved'
        this.saveConflict = false
        return copy
      } catch {
        this.notify('Could not save the copy. Your edits are still open.', 'error')
        return null
      }
    },

    async deleteDocument(id) {
      try {
        await this.request('DELETE', { body: { kind: 'document', id } })
        this.syncDocumentPages(
          null,
          this.documents.find((doc) => doc.id === id),
        )
        this.documents = this.documents.filter((doc) => doc.id !== id)
        if (this.openDocId === id) {
          this.openDocId = null
          this.openDoc = null
        }
        this.notify('Document deleted.')
        return true
      } catch (error) {
        console.error('Failed to delete document:', error)
        this.notify('Failed to delete the document.', 'error')
        return false
      }
    },

    // Search results populate a separate array from the sidebar's `documents`
    // — see the activeSearchQuery/searchResults state comment. Mirrors
    // inbox.js's searchEmails: AbortController cancellation plus searchSeq as
    // an ordering backstop for the runtime that doesn't honor cancellation.
    async searchDocuments(query, { semantic = true } = {}) {
      const q = query.trim()
      if (!q) return
      documentSearchAbortController?.abort()
      const controller = new AbortController()
      documentSearchAbortController = controller
      const seq = ++this.searchSeq
      try {
        const headers = await this.authHeaders()
        const mode = semantic ? '' : '&mode=keyword'
        const response = await fetch(
          `${TASKS_API_URL}/documents?q=${encodeURIComponent(q)}${mode}`,
          { headers, signal: controller.signal },
        )
        if (!response.ok) {
          throw new Error(`GET documents search responded ${response.status}`)
        }
        const { documents } = await response.json()
        if (seq !== this.searchSeq) return
        this.activeSearchQuery = q
        this.searchResults = documents
      } catch (error) {
        if (seq !== this.searchSeq) return
        if (error?.name === 'AbortError') return
        console.error('Document search failed:', error)
        this.notify('Search failed. Please try again.', 'error')
      } finally {
        if (documentSearchAbortController === controller) documentSearchAbortController = null
      }
    },

    // Leaves search mode. Cheaper than email's clearSearch: `documents` was
    // never touched by the search, so there's nothing to reload.
    clearSearch() {
      documentSearchAbortController?.abort()
      documentSearchAbortController = null
      this.searchSeq++
      this.activeSearchQuery = ''
      this.searchResults = []
    },

    // Matches the schema's behavior so the tree is correct without a refetch:
    // sub-folders go with the folder, their documents drop back to the root.
    async deleteFolder(id) {
      try {
        await this.request('DELETE', { body: { kind: 'folder', id } })
        const doomed = new Set([id])
        let grew = true
        while (grew) {
          grew = false
          for (const folder of this.folders) {
            if (folder.parent_id && doomed.has(folder.parent_id) && !doomed.has(folder.id)) {
              doomed.add(folder.id)
              grew = true
            }
          }
        }
        this.folders = this.folders.filter((folder) => !doomed.has(folder.id))
        // Files in a deleted folder fall back to the root on the server; drop
        // the cached pages so the next visit reloads them.
        this.filePages = {}
        for (const doc of this.documents) {
          if (doomed.has(doc.folder_id)) doc.folder_id = null
        }
        this.notify('Folder deleted.')
      } catch (error) {
        console.error('Failed to delete folder:', error)
        this.notify('Failed to delete the folder.', 'error')
      }
    },
  },
})
