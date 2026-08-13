import { defineStore } from 'pinia'

import { getAuth0 } from '../auth0-client'
import { formatDailyNoteTitle } from '../lib/documentDates'
import { useInboxStore } from './inbox'

// Autosave: edits wait this long after the last keystroke before the PATCH
// goes out (paper's cadence). The timer and its pending payload live at
// module scope so they stay out of reactive state.
const SAVE_DEBOUNCE_MS = 800
let saveTimer = null
let pendingSave = null

// The Documents workspace (paper-style notes): nested folders plus Editor.js
// block documents, backed by /api/tasks?resource=documents. The sidebar tree
// and dashboard read the blockless list rows; opening a document fetches its
// blocks separately, like email bodies.
export const useDocumentsStore = defineStore('documents', {
  state: () => ({
    folders: [],
    documents: [],
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
    newDocumentDialogOpen: false,
    newDocumentFolderId: null,
  }),

  getters: {
    starredDocuments(state) {
      return state.documents.filter((doc) => doc.starred)
    },
    documentTags(state) {
      const counts = new Map()
      for (const document of state.documents) {
        for (const tag of document.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
      return [...counts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, count]) => ({ name, count }))
    },
  },

  actions: {
    // Bearer-token headers for API calls; Auth0 is absent in e2e/fixture mode.
    async authHeaders(extra = {}) {
      const headers = { ...extra }
      const auth0 = getAuth0()
      if (auth0) {
        const token = await auth0.getAccessTokenSilently()
        headers.Authorization = `Bearer ${token}`
      }
      return headers
    },

    notify(message, kind = 'info') {
      useInboxStore().notify(message, kind)
    },

    async request(method, { params = '', body } = {}) {
      const headers = await this.authHeaders(
        body !== undefined ? { 'Content-Type': 'application/json' } : {},
      )
      const options = { method, headers }
      if (body !== undefined) options.body = JSON.stringify(body)
      const response = await fetch(`/api/tasks?resource=documents${params}`, options)
      if (!response.ok) {
        throw new Error(`${method} /api/tasks?resource=documents responded ${response.status}`)
      }
      return response.json()
    },

    async loadWorkspace({ force = false } = {}) {
      if ((this.isLoaded && !force) || this.isLoading) return
      this.isLoading = true
      try {
        const { folders, documents } = await this.request('GET')
        this.folders = folders
        this.documents = documents
        this.isLoaded = true
      } catch (error) {
        console.error('Failed to load documents:', error)
        this.notify('Failed to load documents.', 'error')
      } finally {
        this.isLoading = false
      }
    },

    // Opening a new document flushes any edit still waiting on the debounce
    // timer so switching documents never drops the tail of the last one.
    async openDocument(id) {
      await this.flushPendingSave()
      this.openDocId = id
      this.openDoc = null
      this.saveState = null
      if (!id) return
      this.isOpenDocLoading = true
      try {
        const { document } = await this.request('GET', { params: `&id=${encodeURIComponent(id)}` })
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
        return document
      } catch (error) {
        console.error('Failed to create document:', error)
        this.notify('Failed to create the document.', 'error')
        return null
      }
    },

    async loadTemplates({ force = false } = {}) {
      if ((this.templatesLoaded && !force) || this.templatesLoading) return
      this.templatesLoading = true
      try {
        const { templates } = await this.request('GET', { params: '&templates' })
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
          params: `&templateId=${encodeURIComponent(id)}`,
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

    // The "Today" sidebar shortcut: finds (or creates) the root "Daily"
    // folder and today's note inside it, seeding a fresh note with a "Tasks"
    // heading so it isn't blank the first time it's opened.
    async openTodayNote() {
      await this.loadWorkspace()
      const title = formatDailyNoteTitle()
      let folder = this.folders.find((f) => f.parent_id === null && f.title === 'Daily')
      if (!folder) folder = await this.createFolder({ title: 'Daily' })
      if (!folder) return null

      const existing = this.documents.find((d) => d.folder_id === folder.id && d.title === title)
      if (existing) return existing

      const document = await this.createDocument({ folderId: folder.id, title })
      if (!document) return null
      try {
        await this.request('PATCH', {
          body: {
            id: document.id,
            blocks: [{ type: 'header', data: { text: 'Tasks', level: 2 } }],
          },
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

    // Content autosave (title + blocks + tags) from the editor. Local state updates
    // immediately — the sidebar shows the new title as it is typed — while
    // the PATCH waits out the debounce.
    scheduleContentSave(id, { title, blocks, tags }) {
      const row = this.documents.find((doc) => doc.id === id)
      if (row && title !== undefined) row.title = title
      if (row && tags !== undefined) row.tags = tags
      if (this.openDoc?.id === id) {
        if (title !== undefined) this.openDoc.title = title
        if (blocks !== undefined) this.openDoc.blocks = blocks
        if (tags !== undefined) this.openDoc.tags = tags
      }
      const prev = pendingSave?.id === id ? pendingSave : null
      pendingSave = {
        id,
        title: title ?? prev?.title,
        blocks: blocks ?? prev?.blocks,
        tags: tags ?? prev?.tags,
      }
      this.saveState = 'saving'
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => this.flushPendingSave(), SAVE_DEBOUNCE_MS)
    },

    async flushPendingSave() {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      if (!pendingSave) return
      const { id, title, blocks, tags } = pendingSave
      pendingSave = null
      const body = { id }
      if (title !== undefined) body.title = title
      if (blocks !== undefined) body.blocks = blocks
      if (tags !== undefined) body.tags = tags
      try {
        const { document } = await this.request('PATCH', { body })
        const row = this.documents.find((doc) => doc.id === id)
        if (row) Object.assign(row, document)
        if (this.openDoc?.id === id) Object.assign(this.openDoc, document)
        // Only report "saved" if no newer edit queued while this one flushed.
        if (!pendingSave) this.saveState = 'saved'
      } catch (error) {
        console.error('Failed to save document:', error)
        this.saveState = 'error'
      }
    },

    async deleteDocument(id) {
      try {
        await this.request('DELETE', { body: { kind: 'document', id } })
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
