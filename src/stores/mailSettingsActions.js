import { convertEmojiToEmoticons } from '../lib/emoticons'
import { sanitizeEmailHtml } from '../lib/sanitizeEmailHtml'
import { sanitizeStoredSnippets } from '../lib/snippets'
// Optional mail settings and contact suggestions load only when requested.
import {
  AI_API_URL,
  RECEIPTS_API_URL,
  EMAILS_API_URL,
  LABELS_API_URL,
  TASKS_API_URL,
  MESSAGES_API_URL,
  NOTIFICATIONS_API_URL,
} from '../lib/apiWorkers'
import { parseAutoArchive } from '../lib/autoArchive'
import { parseEnrichmentSettings } from '../lib/enrichmentSettings'

export const mailSettingsActions = {
  async loadReadReceipts(emails) {
    if (!emails.length) return
    const generation = this.composeGeneration
    try {
      const headers = await this.authHeaders()
      if (generation !== this.composeGeneration) return
      const ids = emails.map((email) => email.id).join(',')
      const response = await fetch(
        `${RECEIPTS_API_URL}/read-receipts?messageIds=${encodeURIComponent(ids)}`,
        { headers },
      )
      if (!response.ok) throw new Error(`GET /read-receipts responded ${response.status}`)
      const { receipts } = await response.json()
      if (generation !== this.composeGeneration) return
      const byMessage = new Map(receipts.map((receipt) => [receipt.message_id, receipt]))
      for (const email of emails) {
        const receipt = byMessage.get(email.id)
        email.readAt = receipt?.first_opened_at ?? null
        email.readCount = receipt?.open_count ?? 0
      }
    } catch (error) {
      // Receipt status is advisory; never make Sent unusable when it fails.
      console.error('Failed to load read receipts:', error)
    }
  },
  async downloadAttachment(attachment) {
    if (!attachment?.id || !attachment.downloadable) return false
    const generation = this.composeGeneration
    try {
      const headers = await this.authHeaders()
      if (generation !== this.composeGeneration) return false
      const response = await fetch(
        `${MESSAGES_API_URL}/messages/attachment?id=${encodeURIComponent(attachment.id)}`,
        { headers },
      )
      if (!response.ok) {
        throw new Error(`GET attachment endpoint responded ${response.status}`)
      }
      const { url: rawUrl, filename } = await response.json()
      if (generation !== this.composeGeneration) return false
      const url = String(rawUrl ?? '')
      if (!url) throw new Error('Attachment URL is missing')
      // The URL is server-supplied; only a real web (or local blob) link
      // may reach a synthetic click, so a compromised/misconfigured
      // response can't navigate to javascript:/data:.
      try {
        const { protocol } = new URL(url)
        if (protocol !== 'https:' && protocol !== 'http:' && protocol !== 'blob:') {
          throw new Error(`Unsupported attachment URL protocol: ${protocol}`)
        }
      } catch (error) {
        console.error('Rejected unsafe attachment URL:', error)
        this.notify('Attachment download failed.', 'error')
        return false
      }

      const link = document.createElement('a')
      link.href = url
      link.download = filename || attachment.filename || 'attachment'
      link.rel = 'noopener'
      document.body.append(link)
      link.click()
      link.remove()
      return true
    } catch (error) {
      if (generation !== this.composeGeneration) return false
      console.error('Failed to download attachment:', error)
      this.notify('Failed to download attachment.', 'error')
      return false
    }
  },

  async requestAiReply({ replyToMessageId, to, subject, existingText }) {
    const generation = this.composeGeneration
    const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
    if (generation !== this.composeGeneration) throw new Error('The signed-in account changed')
    const response = await fetch(`${AI_API_URL}/compose`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({
        instruction:
          'Write a concise, helpful reply to this email in its language. ' +
          'Use the existing draft as guidance and preserve its meaning. ' +
          'Keep facts and commitments grounded in the supplied context; ask for missing information when needed. ' +
          'Return the reply body without a quoted original, signature, or placeholders.',
        replyToMessageId,
        to,
        subject,
        existingText,
      }),
    })
    if (!response.ok) throw new Error(`POST /compose responded ${response.status}`)
    const { draft } = await response.json()
    if (generation !== this.composeGeneration) throw new Error('The signed-in account changed')
    const text = draft.text.trim()
    if (!text || text.length > 10_000) throw new Error('AI returned an invalid reply')
    return convertEmojiToEmoticons(text)
  },

  async postImportance(email, body) {
    const generation = this.composeGeneration
    const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
    if (generation !== this.composeGeneration) return false
    const response = await fetch(`${MESSAGES_API_URL}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: email.id, ...body }),
    })
    if (generation !== this.composeGeneration) return false
    if (!response.ok) throw new Error(`POST /messages responded ${response.status}`)
    return response.json()
  },

  async setMessageCategory(email, category) {
    const generation = this.composeGeneration
    if (!email) return false
    const categoryId = category?.id ?? null
    if ((email.category?.id ?? null) === categoryId) return true
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      if (generation !== this.composeGeneration) return false
      const response = await fetch(`${MESSAGES_API_URL}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: email.id, action: 'set_category', category_id: categoryId }),
      })
      if (generation !== this.composeGeneration) return false
      if (!response.ok) throw new Error(`POST /messages responded ${response.status}`)
      const { category: assignedCategory } = await response.json()
      if (generation !== this.composeGeneration) return false
      for (const list of [
        this.traditionalEmails,
        this.starredEmails,
        this.labelEmails,
        this.sentEmails,
        this.spamEmails,
        this.snoozedEmails,
        this.doneEmails,
      ]) {
        const cached = list.find((item) => item.id === email.id)
        if (cached) cached.category = assignedCategory ?? null
      }
      email.category = assignedCategory ?? null
      return true
    } catch (error) {
      if (generation !== this.composeGeneration) return false
      console.error('Failed to update message category:', error)
      this.notify('Failed to update category.', 'error')
      return false
    }
  },

  async updateCategory(category, { name, description }) {
    const generation = this.composeGeneration
    const nextName = name.trim()
    const nextDescription = description.trim()
    if (!nextName) return false
    if (nextName === category.name && nextDescription === (category.description || '')) return true
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      if (generation !== this.composeGeneration) return false
      const response = await fetch(`${LABELS_API_URL}/categories`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          id: category.id,
          name: nextName,
          description: nextDescription,
        }),
      })
      if (generation !== this.composeGeneration) return false
      if (response.status === 409) {
        this.notify('A category with that name already exists.', 'error')
        return false
      }
      if (generation !== this.composeGeneration) return false
      if (!response.ok) throw new Error(`PATCH /categories responded ${response.status}`)
      const { category: updatedCategory } = await response.json()
      if (generation !== this.composeGeneration) return false
      Object.assign(category, updatedCategory)
      this.categories.sort((a, b) => a.name.localeCompare(b.name))
      for (const list of [
        this.traditionalEmails,
        this.starredEmails,
        this.labelEmails,
        this.sentEmails,
        this.spamEmails,
        this.snoozedEmails,
        this.doneEmails,
      ]) {
        for (const email of list) {
          if (email.category?.id === category.id) Object.assign(email.category, updatedCategory)
        }
      }
      this.notify('Category updated.')
      return true
    } catch (error) {
      if (generation !== this.composeGeneration) return false
      console.error('Failed to update category:', error)
      this.notify('Failed to update category.', 'error')
      return false
    }
  },

  async setCategoryNotifications(category, enabled) {
    const generation = this.composeGeneration
    if (!category) return false
    if (this.categoryNotificationSavingIds.has(category.id)) return false
    this.categoryNotificationSavingIds.add(category.id)
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      if (generation !== this.composeGeneration) return false
      const response = await fetch(`${LABELS_API_URL}/categories`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          id: category.id,
          notifications_enabled: enabled,
        }),
      })
      if (generation !== this.composeGeneration) return false
      if (!response.ok) throw new Error(`PATCH /categories responded ${response.status}`)
      const { category: updatedCategory } = await response.json()
      if (generation !== this.composeGeneration) return false
      Object.assign(category, updatedCategory)
      this.notify(enabled ? 'Category notifications enabled.' : 'Category notifications disabled.')
      return true
    } catch (error) {
      if (generation !== this.composeGeneration) return false
      console.error('Failed to update category notifications:', error)
      this.notify('Failed to update category notifications.', 'error')
      return false
    } finally {
      if (generation === this.composeGeneration)
        this.categoryNotificationSavingIds.delete(category.id)
    }
  },

  async saveComposePreferences({
    signatureHtml = this.signatureHtml,
    snippets = this.snippets,
  } = {}) {
    if (!this.composeOwnerSub || !this.composePreferencesLoaded)
      throw new Error('Composer preferences must be loaded before saving')
    if (this.composePreferencesSaving) throw new Error('Composer preferences are already saving')
    const owner = this.composeOwnerSub
    const generation = this.composeGeneration
    const next = {
      revision: this.composePreferencesRevision,
      signatureHtml: sanitizeEmailHtml(signatureHtml),
      snippets: sanitizeStoredSnippets(snippets),
    }
    if (next.snippets.length !== snippets.length) {
      this.composePreferencesError =
        'A snippet is empty, duplicated, or exceeds the 50-snippet limit.'
      return false
    }
    this.composePreferencesSaving = true
    this.composePreferencesError = ''
    this.composePreferencesConflict = false
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      if (owner !== this.composeOwnerSub || generation !== this.composeGeneration) return false
      const response = await fetch(`${EMAILS_API_URL}/emails/compose-preferences`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(next),
      })
      const payload = await response.json()
      if (owner !== this.composeOwnerSub || generation !== this.composeGeneration) return false
      if (response.status === 409) {
        this.applyComposePreferences(payload.current)
        this.composePreferencesConflict = true
        this.composePreferencesError =
          'These preferences changed in another session. Review the latest version before saving again.'
        return false
      }
      if (!response.ok)
        throw new Error(payload.error || `PUT compose preferences responded ${response.status}`)
      this.applyComposePreferences(payload)
      return true
    } catch (error) {
      if (owner !== this.composeOwnerSub || generation !== this.composeGeneration) return false
      this.composePreferencesError =
        'Could not save composer preferences. Your edit is still here; please try again.'
      console.error('Failed to save compose preferences:', error)
      return false
    } finally {
      if (owner === this.composeOwnerSub && generation === this.composeGeneration)
        this.composePreferencesSaving = false
    }
  },

  async loadRules() {
    const generation = this.composeGeneration
    try {
      const headers = await this.authHeaders()
      if (generation !== this.composeGeneration) return
      const response = await fetch(`${LABELS_API_URL}/labels/rules`, { headers })
      if (!response.ok) {
        throw new Error(`GET /api/labels?resource=rules responded ${response.status}`)
      }
      const { rules } = await response.json()
      if (generation !== this.composeGeneration) return
      this.rules = rules
    } catch (error) {
      if (generation !== this.composeGeneration) return
      console.error('Failed to load rules:', error)
      this.notify('Failed to load tag rules.', 'error')
    }
  },

  async createRule(newRule) {
    const generation = this.composeGeneration
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      if (generation !== this.composeGeneration) return false
      const response = await fetch(`${LABELS_API_URL}/labels/rules`, {
        method: 'POST',
        headers,
        body: JSON.stringify(newRule),
      })
      if (generation !== this.composeGeneration) return false
      if (!response.ok) {
        throw new Error(`POST /api/labels?resource=rules responded ${response.status}`)
      }
      const { rule } = await response.json()
      if (generation !== this.composeGeneration) return false
      this.rules = [...this.rules, rule]
      this.notify('Rule created.')
      return rule
    } catch (error) {
      if (generation !== this.composeGeneration) return false
      console.error('Failed to create rule:', error)
      this.notify('Failed to create rule.', 'error')
      return null
    }
  },

  async deleteRule(id) {
    const generation = this.composeGeneration
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      if (generation !== this.composeGeneration) return false
      const response = await fetch(`${LABELS_API_URL}/labels/rules`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ id }),
      })
      if (generation !== this.composeGeneration) return false
      if (!response.ok) {
        throw new Error(`DELETE /api/labels?resource=rules responded ${response.status}`)
      }
      this.rules = this.rules.filter((rule) => rule.id !== id)
      this.notify('Rule deleted.')
    } catch (error) {
      if (generation !== this.composeGeneration) return false
      console.error('Failed to delete rule:', error)
      this.notify('Failed to delete rule.', 'error')
    }
  },

  async requestAiRuleDraft(instruction) {
    const generation = this.composeGeneration
    const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
    if (generation !== this.composeGeneration) return false
    const response = await fetch(`${AI_API_URL}/rule-draft`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ instruction: instruction.trim() }),
    })
    const data = await response.json()
    if (generation !== this.composeGeneration) return false
    if (generation !== this.composeGeneration) return false
    if (!response.ok) throw new Error(data.error || 'AI rule generation failed. Please try again.')
    if (
      !data.draft ||
      !['conditions', 'ai'].includes(data.draft.kind) ||
      !Array.isArray(data.draft.conditions)
    ) {
      throw new Error('AI returned an invalid rule. Please try again.')
    }
    return data.draft
  },

  async requestAiSnippet(instruction) {
    const prompt = instruction.trim()
    if (!prompt || !this.composeOwnerSub) return null
    const owner = this.composeOwnerSub
    const generation = this.composeGeneration
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      if (owner !== this.composeOwnerSub || generation !== this.composeGeneration) return null
      const response = await fetch(`${AI_API_URL}/compose`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ mode: 'snippet', instruction: prompt }),
      })
      if (owner !== this.composeOwnerSub || generation !== this.composeGeneration) return null
      if (!response.ok) throw new Error(`POST /compose responded ${response.status}`)
      const { snippet } = await response.json()
      return owner === this.composeOwnerSub && generation === this.composeGeneration
        ? snippet
        : null
    } catch (error) {
      if (owner !== this.composeOwnerSub || generation !== this.composeGeneration) return null
      console.error('AI snippet generation failed:', error)
      this.notify('AI snippet generation failed. Please try again.', 'error')
      return null
    }
  },

  async loadInterests() {
    if (this.interestsLoaded) return
    const generation = this.composeGeneration
    try {
      const headers = await this.authHeaders()
      if (generation !== this.composeGeneration) return
      const response = await fetch(`${TASKS_API_URL}/tasks/interests`, { headers })
      if (!response.ok) throw new Error(`GET interests responded ${response.status}`)
      const { interests, personaliseGithub } = await response.json()
      if (generation !== this.composeGeneration) return
      this.interests = interests
      this.personaliseGithub = personaliseGithub === true
      this.interestsLoaded = true
    } catch (error) {
      if (generation !== this.composeGeneration) return
      console.error('Failed to load interests:', error)
    }
  },

  async saveInterests(interests, personaliseGithub = this.personaliseGithub) {
    const generation = this.composeGeneration
    const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
    if (generation !== this.composeGeneration) return false
    const response = await fetch(`${TASKS_API_URL}/tasks/interests`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ interests, personaliseGithub }),
    })
    if (generation !== this.composeGeneration) return false
    if (!response.ok) {
      throw new Error(`PUT interests responded ${response.status}`)
    }
    const saved = await response.json()
    if (generation !== this.composeGeneration) return false
    this.interests = saved.interests
    this.personaliseGithub = saved.personaliseGithub === true
    this.interestsLoaded = true
    return this.interests
  },

  async loadEnrichmentSettings() {
    if (this.enrichmentSettingsLoaded) return
    const generation = this.composeGeneration
    const headers = await this.authHeaders()
    if (generation !== this.composeGeneration) return
    const response = await fetch(`${TASKS_API_URL}/tasks/enrichment-settings`, { headers })
    if (!response.ok) throw new Error(`GET enrichment settings responded ${response.status}`)
    const saved = parseEnrichmentSettings(await response.json())
    if (generation !== this.composeGeneration) return
    if (this.enrichmentSettingsLoaded) return
    this.enrichmentSettings = saved
    this.enrichmentSettingsLoaded = true
  },

  async saveEnrichmentSettings(enrichmentSettings) {
    const generation = this.composeGeneration
    const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
    if (generation !== this.composeGeneration) return false
    const response = await fetch(`${TASKS_API_URL}/tasks/enrichment-settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ enrichmentSettings }),
    })
    if (generation !== this.composeGeneration) return false
    if (!response.ok) throw new Error(`PUT enrichment settings responded ${response.status}`)
    const saved = parseEnrichmentSettings(await response.json())
    if (generation !== this.composeGeneration) return false
    this.enrichmentSettings = saved
    this.enrichmentSettingsLoaded = true
    return this.enrichmentSettings
  },

  async loadAutoArchive() {
    if (this.autoArchiveLoaded) return
    const generation = this.composeGeneration
    const headers = await this.authHeaders()
    if (generation !== this.composeGeneration) return
    const response = await fetch(`${EMAILS_API_URL}/emails/auto-archive`, { headers })
    if (!response.ok) throw new Error(`GET auto archive responded ${response.status}`)
    const saved = parseAutoArchive(await response.json())
    if (generation !== this.composeGeneration) return
    if (this.autoArchiveLoaded) return
    this.autoArchive = saved
    this.autoArchiveLoaded = true
  },

  async saveAutoArchive(autoArchive) {
    const generation = this.composeGeneration
    const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
    if (generation !== this.composeGeneration) return false
    const response = await fetch(`${EMAILS_API_URL}/emails/auto-archive`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ autoArchive }),
    })
    if (generation !== this.composeGeneration) return false
    if (!response.ok) throw new Error(`PUT auto archive responded ${response.status}`)
    const saved = parseAutoArchive(await response.json())
    if (generation !== this.composeGeneration) return false
    this.autoArchive = saved
    this.autoArchiveLoaded = true
  },

  async loadSpamRetention() {
    if (this.spamRetentionLoaded) return
    const generation = this.composeGeneration
    try {
      const headers = await this.authHeaders()
      if (generation !== this.composeGeneration) return
      const response = await fetch(`${EMAILS_API_URL}/emails/spam-retention`, { headers })
      if (!response.ok) throw new Error(`GET spam retention responded ${response.status}`)
      const payload = await response.json()
      if (generation !== this.composeGeneration) return
      // A save that completed while this was in flight is newer than
      // whatever the server had when it answered.
      if (this.spamRetentionLoaded) return
      this.applySpamRetention(payload)
    } catch (error) {
      if (generation !== this.composeGeneration) return
      console.error('Failed to load spam retention:', error)
    }
  },

  async saveSpamRetention(days) {
    const generation = this.composeGeneration
    const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
    if (generation !== this.composeGeneration) return false
    const response = await fetch(`${EMAILS_API_URL}/emails/spam-retention`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ spamRetentionDays: days }),
    })
    if (generation !== this.composeGeneration) return false
    if (!response.ok) {
      throw new Error(`PUT spam retention responded ${response.status}`)
    }
    const saved = await response.json()
    if (generation !== this.composeGeneration) return false
    this.applySpamRetention(saved)
    return this.spamRetentionDays
  },

  async loadNtfySubscription() {
    const generation = this.composeGeneration
    const headers = await this.authHeaders()
    if (generation !== this.composeGeneration) return null
    const response = await fetch(`${NOTIFICATIONS_API_URL}/ntfy`, { headers, cache: 'no-store' })
    if (!response.ok) throw new Error(`GET /ntfy responded ${response.status}`)
    const subscription = await response.json()
    if (generation !== this.composeGeneration) return null
    // A paused subscription keeps its topic so the phone stays subscribed;
    // only a user who never set ntfy up has no topic at all.
    this.ntfySubscription = subscription.topic ? subscription : null
    return this.ntfySubscription
  },

  async createNtfySubscription() {
    const generation = this.composeGeneration
    const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
    if (generation !== this.composeGeneration) return false
    const response = await fetch(`${NOTIFICATIONS_API_URL}/ntfy`, { method: 'POST', headers })
    if (generation !== this.composeGeneration) return false
    if (!response.ok) throw new Error(`POST /ntfy responded ${response.status}`)
    const subscription = await response.json()
    if (generation !== this.composeGeneration) return false
    this.ntfySubscription = subscription
    return this.ntfySubscription
  },

  async disableNtfySubscription() {
    const generation = this.composeGeneration
    const headers = await this.authHeaders()
    if (generation !== this.composeGeneration) return false
    const response = await fetch(`${NOTIFICATIONS_API_URL}/ntfy`, { method: 'DELETE', headers })
    if (generation !== this.composeGeneration) return false
    if (!response.ok) throw new Error(`DELETE /ntfy responded ${response.status}`)
    if (this.ntfySubscription) {
      this.ntfySubscription = { ...this.ntfySubscription, enabled: false }
    }
  },

  async sendNtfyTest() {
    const generation = this.composeGeneration
    const headers = await this.authHeaders()
    if (generation !== this.composeGeneration) return false
    const response = await fetch(`${NOTIFICATIONS_API_URL}/ntfy/test`, {
      method: 'POST',
      headers,
    })
    if (generation !== this.composeGeneration) return false
    if (!response.ok) {
      const details = await response.json().catch(() => ({}))
      const error = new Error(`POST /ntfy/test responded ${response.status}`)
      error.code = details.error
      error.retryAfterSeconds = details.retryAfterSeconds
      throw error
    }
    return response.json()
  },

  async loadContacts() {
    if (this.contactsLoaded) return
    const generation = this.composeGeneration
    try {
      const headers = await this.authHeaders()
      if (generation !== this.composeGeneration) return
      // cache: 'no-store' — contacts are per-account; the shared browser
      // HTTP cache must never serve them across an account switch.
      const response = await fetch(`${MESSAGES_API_URL}/messages/contacts`, {
        headers,
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`GET contacts responded ${response.status}`)
      const { contacts } = await response.json()
      if (generation !== this.composeGeneration) return
      this.contacts = contacts
      this.contactsLoaded = true
    } catch (error) {
      if (generation !== this.composeGeneration) return
      console.error('Failed to load contacts:', error)
    }
  },
  async createCategory({ name, color, description }) {
    const generation = this.composeGeneration
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      if (generation !== this.composeGeneration) return false
      const response = await fetch(`${LABELS_API_URL}/categories`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, color, description }),
      })
      if (generation !== this.composeGeneration) return false
      if (response.status === 409) {
        this.notify('A category with that name already exists.', 'error')
        return false
      }
      if (generation !== this.composeGeneration) return false
      if (!response.ok) throw new Error(`POST /categories responded ${response.status}`)
      const { category } = await response.json()
      if (generation !== this.composeGeneration) return false
      this.categories = [...this.categories, category].sort((a, b) => a.name.localeCompare(b.name))
      this.notify('Category created.')
      return true
    } catch (error) {
      if (generation !== this.composeGeneration) return false
      console.error('Failed to create category:', error)
      this.notify('Failed to create category.', 'error')
      return false
    }
  },
  async deleteCategory(id) {
    const generation = this.composeGeneration
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      if (generation !== this.composeGeneration) return false
      const response = await fetch(`${LABELS_API_URL}/categories`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ id }),
      })
      if (generation !== this.composeGeneration) return false
      if (!response.ok) throw new Error(`DELETE /categories responded ${response.status}`)
      this.categories = this.categories.filter((category) => category.id !== id)
      for (const list of [
        this.traditionalEmails,
        this.starredEmails,
        this.labelEmails,
        this.sentEmails,
        this.spamEmails,
        this.snoozedEmails,
        this.doneEmails,
      ]) {
        for (const email of list) {
          if (email.category?.id === id) email.category = null
        }
      }
      this.notify('Category deleted.')
      return true
    } catch (error) {
      if (generation !== this.composeGeneration) return false
      console.error('Failed to delete category:', error)
      this.notify('Failed to delete category.', 'error')
      return false
    }
  },
  async createLabel({ name, color, description }) {
    const generation = this.composeGeneration
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      if (generation !== this.composeGeneration) return false
      const response = await fetch(`${LABELS_API_URL}/labels`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, color, description }),
      })
      if (generation !== this.composeGeneration) return false
      if (response.status === 409) {
        this.notify('A label with that name already exists.', 'error')
        return false
      }
      if (generation !== this.composeGeneration) return false
      if (!response.ok) {
        throw new Error(`POST /api/labels responded ${response.status}`)
      }
      const { label } = await response.json()
      if (generation !== this.composeGeneration) return false
      this.labels = [...this.labels, label].sort((a, b) => a.name.localeCompare(b.name))
      this.notify('Label created.')
      return true
    } catch (error) {
      if (generation !== this.composeGeneration) return false
      console.error('Failed to create label:', error)
      this.notify('Failed to create label.', 'error')
      return false
    }
  },
  async deleteLabel(id) {
    const generation = this.composeGeneration
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      if (generation !== this.composeGeneration) return false
      const response = await fetch(`${LABELS_API_URL}/labels`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ id }),
      })
      if (generation !== this.composeGeneration) return false
      if (!response.ok) {
        throw new Error(`DELETE /api/labels responded ${response.status}`)
      }
      this.labels = this.labels.filter((label) => label.id !== id)
      this.notify('Label deleted.')
    } catch (error) {
      if (generation !== this.composeGeneration) return false
      console.error('Failed to delete label:', error)
      this.notify('Failed to delete label.', 'error')
    }
  },
  async renameLabel(label, name) {
    const generation = this.composeGeneration
    const nextName = name.trim()
    if (!nextName || nextName === label.name) return nextName === label.name

    const previousName = label.name
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      if (generation !== this.composeGeneration) return false
      const response = await fetch(`${LABELS_API_URL}/labels`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id: label.id, name: nextName }),
      })
      if (generation !== this.composeGeneration) return false
      if (response.status === 409) {
        this.notify('A label with that name already exists.', 'error')
        return false
      }
      if (generation !== this.composeGeneration) return false
      if (!response.ok) throw new Error(`PATCH /api/labels responded ${response.status}`)

      const { label: updatedLabel } = await response.json()
      if (generation !== this.composeGeneration) return false
      Object.assign(label, updatedLabel)
      this.labels.sort((a, b) => a.name.localeCompare(b.name))
      for (const list of [
        this.traditionalEmails,
        this.starredEmails,
        this.labelEmails,
        this.sentEmails,
        this.spamEmails,
        this.snoozedEmails,
        this.doneEmails,
      ]) {
        for (const email of list) {
          for (const messageLabel of email.labels || []) {
            if (messageLabel.name === previousName) messageLabel.name = updatedLabel.name
          }
        }
      }

      this.notify('Label renamed.')
      return true
    } catch (error) {
      if (generation !== this.composeGeneration) return false
      console.error('Failed to rename label:', error)
      this.notify('Failed to rename label.', 'error')
      return false
    }
  },
  async updateRule(rule, changes) {
    const generation = this.composeGeneration
    const previous = { ...rule }
    Object.assign(rule, changes)
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      if (generation !== this.composeGeneration) return false
      const response = await fetch(`${LABELS_API_URL}/labels/rules`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id: rule.id, ...changes }),
      })
      if (generation !== this.composeGeneration) return false
      if (!response.ok)
        throw new Error(`PATCH /api/labels?resource=rules responded ${response.status}`)
      const { rule: updatedRule } = await response.json()
      if (generation !== this.composeGeneration) return false
      Object.assign(rule, updatedRule)
      return true
    } catch (error) {
      if (generation !== this.composeGeneration) return false
      Object.assign(rule, previous)
      console.error('Failed to update rule:', error)
      this.notify('Failed to update rule.', 'error')
      return false
    }
  },
  async setLabelAutoApply(label, autoApply) {
    const generation = this.composeGeneration
    const previous = label.auto_apply
    label.auto_apply = autoApply
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      if (generation !== this.composeGeneration) return false
      const response = await fetch(`${LABELS_API_URL}/labels`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id: label.id, auto_apply: autoApply }),
      })
      if (generation !== this.composeGeneration) return false
      if (!response.ok) throw new Error(`PATCH /api/labels responded ${response.status}`)
    } catch (error) {
      if (generation !== this.composeGeneration) return false
      label.auto_apply = previous
      console.error('Failed to update label auto-tagging:', error)
      this.notify('Failed to update auto-tagging.', 'error')
    }
  },
}
