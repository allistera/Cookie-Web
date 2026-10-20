// Optional mail settings and contact suggestions load only when requested.
import {
  AI_API_URL,
  EMAILS_API_URL,
  LABELS_API_URL,
  TASKS_API_URL,
  MESSAGES_API_URL,
  NOTIFICATIONS_API_URL,
} from '../lib/apiWorkers'
import { parseAutoArchive } from '../lib/autoArchive'
import { parseEnrichmentSettings } from '../lib/enrichmentSettings'

export const mailSettingsActions = {
  async loadRules() {
    try {
      const headers = await this.authHeaders()
      const response = await fetch(`${LABELS_API_URL}/labels/rules`, { headers })
      if (!response.ok) {
        throw new Error(`GET /api/labels?resource=rules responded ${response.status}`)
      }
      const { rules } = await response.json()
      this.rules = rules
    } catch (error) {
      console.error('Failed to load rules:', error)
      this.notify('Failed to load tag rules.', 'error')
    }
  },

  async createRule(newRule) {
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${LABELS_API_URL}/labels/rules`, {
        method: 'POST',
        headers,
        body: JSON.stringify(newRule),
      })
      if (!response.ok) {
        throw new Error(`POST /api/labels?resource=rules responded ${response.status}`)
      }
      const { rule } = await response.json()
      this.rules = [...this.rules, rule]
      this.notify('Rule created.')
      return rule
    } catch (error) {
      console.error('Failed to create rule:', error)
      this.notify('Failed to create rule.', 'error')
      return null
    }
  },

  async deleteRule(id) {
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${LABELS_API_URL}/labels/rules`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ id }),
      })
      if (!response.ok) {
        throw new Error(`DELETE /api/labels?resource=rules responded ${response.status}`)
      }
      this.rules = this.rules.filter((rule) => rule.id !== id)
      this.notify('Rule deleted.')
    } catch (error) {
      console.error('Failed to delete rule:', error)
      this.notify('Failed to delete rule.', 'error')
    }
  },

  async requestAiRuleDraft(instruction) {
    const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
    const response = await fetch(`${AI_API_URL}/rule-draft`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ instruction: instruction.trim() }),
    })
    const data = await response.json()
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
    try {
      const headers = await this.authHeaders()
      const response = await fetch(`${TASKS_API_URL}/tasks/interests`, { headers })
      if (!response.ok) throw new Error(`GET interests responded ${response.status}`)
      const { interests, personaliseGithub } = await response.json()
      this.interests = interests
      this.personaliseGithub = personaliseGithub === true
      this.interestsLoaded = true
    } catch (error) {
      console.error('Failed to load interests:', error)
    }
  },

  async saveInterests(interests, personaliseGithub = this.personaliseGithub) {
    const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
    const response = await fetch(`${TASKS_API_URL}/tasks/interests`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ interests, personaliseGithub }),
    })
    if (!response.ok) {
      throw new Error(`PUT interests responded ${response.status}`)
    }
    const saved = await response.json()
    this.interests = saved.interests
    this.personaliseGithub = saved.personaliseGithub === true
    this.interestsLoaded = true
    return this.interests
  },

  async loadEnrichmentSettings() {
    if (this.enrichmentSettingsLoaded) return
    const headers = await this.authHeaders()
    const response = await fetch(`${TASKS_API_URL}/tasks/enrichment-settings`, { headers })
    if (!response.ok) throw new Error(`GET enrichment settings responded ${response.status}`)
    const saved = parseEnrichmentSettings(await response.json())
    if (this.enrichmentSettingsLoaded) return
    this.enrichmentSettings = saved
    this.enrichmentSettingsLoaded = true
  },

  async saveEnrichmentSettings(enrichmentSettings) {
    const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
    const response = await fetch(`${TASKS_API_URL}/tasks/enrichment-settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ enrichmentSettings }),
    })
    if (!response.ok) throw new Error(`PUT enrichment settings responded ${response.status}`)
    this.enrichmentSettings = parseEnrichmentSettings(await response.json())
    this.enrichmentSettingsLoaded = true
    return this.enrichmentSettings
  },

  async loadAutoArchive() {
    if (this.autoArchiveLoaded) return
    const headers = await this.authHeaders()
    const response = await fetch(`${EMAILS_API_URL}/emails/auto-archive`, { headers })
    if (!response.ok) throw new Error(`GET auto archive responded ${response.status}`)
    const saved = parseAutoArchive(await response.json())
    if (this.autoArchiveLoaded) return
    this.autoArchive = saved
    this.autoArchiveLoaded = true
  },

  async saveAutoArchive(autoArchive) {
    const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
    const response = await fetch(`${EMAILS_API_URL}/emails/auto-archive`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ autoArchive }),
    })
    if (!response.ok) throw new Error(`PUT auto archive responded ${response.status}`)
    this.autoArchive = parseAutoArchive(await response.json())
    this.autoArchiveLoaded = true
  },

  async loadSpamRetention() {
    if (this.spamRetentionLoaded) return
    try {
      const headers = await this.authHeaders()
      const response = await fetch(`${EMAILS_API_URL}/emails/spam-retention`, { headers })
      if (!response.ok) throw new Error(`GET spam retention responded ${response.status}`)
      const payload = await response.json()
      // A save that completed while this was in flight is newer than
      // whatever the server had when it answered.
      if (this.spamRetentionLoaded) return
      this.applySpamRetention(payload)
    } catch (error) {
      console.error('Failed to load spam retention:', error)
    }
  },

  async saveSpamRetention(days) {
    const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
    const response = await fetch(`${EMAILS_API_URL}/emails/spam-retention`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ spamRetentionDays: days }),
    })
    if (!response.ok) {
      throw new Error(`PUT spam retention responded ${response.status}`)
    }
    this.applySpamRetention(await response.json())
    return this.spamRetentionDays
  },

  async loadNtfySubscription() {
    const headers = await this.authHeaders()
    const response = await fetch(`${NOTIFICATIONS_API_URL}/ntfy`, { headers, cache: 'no-store' })
    if (!response.ok) throw new Error(`GET /ntfy responded ${response.status}`)
    const subscription = await response.json()
    // A paused subscription keeps its topic so the phone stays subscribed;
    // only a user who never set ntfy up has no topic at all.
    this.ntfySubscription = subscription.topic ? subscription : null
    return this.ntfySubscription
  },

  async createNtfySubscription() {
    const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
    const response = await fetch(`${NOTIFICATIONS_API_URL}/ntfy`, { method: 'POST', headers })
    if (!response.ok) throw new Error(`POST /ntfy responded ${response.status}`)
    this.ntfySubscription = await response.json()
    return this.ntfySubscription
  },

  async disableNtfySubscription() {
    const headers = await this.authHeaders()
    const response = await fetch(`${NOTIFICATIONS_API_URL}/ntfy`, { method: 'DELETE', headers })
    if (!response.ok) throw new Error(`DELETE /ntfy responded ${response.status}`)
    if (this.ntfySubscription) {
      this.ntfySubscription = { ...this.ntfySubscription, enabled: false }
    }
  },

  async sendNtfyTest() {
    const headers = await this.authHeaders()
    const response = await fetch(`${NOTIFICATIONS_API_URL}/ntfy/test`, {
      method: 'POST',
      headers,
    })
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
    try {
      const headers = await this.authHeaders()
      // cache: 'no-store' — contacts are per-account; the shared browser
      // HTTP cache must never serve them across an account switch.
      const response = await fetch(`${MESSAGES_API_URL}/messages/contacts`, {
        headers,
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`GET contacts responded ${response.status}`)
      const { contacts } = await response.json()
      this.contacts = contacts
      this.contactsLoaded = true
    } catch (error) {
      console.error('Failed to load contacts:', error)
    }
  },
  async createCategory({ name, color, description }) {
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${LABELS_API_URL}/categories`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, color, description }),
      })
      if (response.status === 409) {
        this.notify('A category with that name already exists.', 'error')
        return false
      }
      if (!response.ok) throw new Error(`POST /categories responded ${response.status}`)
      const { category } = await response.json()
      this.categories = [...this.categories, category].sort((a, b) => a.name.localeCompare(b.name))
      this.notify('Category created.')
      return true
    } catch (error) {
      console.error('Failed to create category:', error)
      this.notify('Failed to create category.', 'error')
      return false
    }
  },
  async deleteCategory(id) {
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${LABELS_API_URL}/categories`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ id }),
      })
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
      console.error('Failed to delete category:', error)
      this.notify('Failed to delete category.', 'error')
      return false
    }
  },
  async createLabel({ name, color, description }) {
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${LABELS_API_URL}/labels`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, color, description }),
      })
      if (response.status === 409) {
        this.notify('A label with that name already exists.', 'error')
        return false
      }
      if (!response.ok) {
        throw new Error(`POST /api/labels responded ${response.status}`)
      }
      const { label } = await response.json()
      this.labels = [...this.labels, label].sort((a, b) => a.name.localeCompare(b.name))
      this.notify('Label created.')
      return true
    } catch (error) {
      console.error('Failed to create label:', error)
      this.notify('Failed to create label.', 'error')
      return false
    }
  },
  async deleteLabel(id) {
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${LABELS_API_URL}/labels`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ id }),
      })
      if (!response.ok) {
        throw new Error(`DELETE /api/labels responded ${response.status}`)
      }
      this.labels = this.labels.filter((label) => label.id !== id)
      this.notify('Label deleted.')
    } catch (error) {
      console.error('Failed to delete label:', error)
      this.notify('Failed to delete label.', 'error')
    }
  },
  async renameLabel(label, name) {
    const nextName = name.trim()
    if (!nextName || nextName === label.name) return nextName === label.name

    const previousName = label.name
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${LABELS_API_URL}/labels`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id: label.id, name: nextName }),
      })
      if (response.status === 409) {
        this.notify('A label with that name already exists.', 'error')
        return false
      }
      if (!response.ok) throw new Error(`PATCH /api/labels responded ${response.status}`)

      const { label: updatedLabel } = await response.json()
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
      console.error('Failed to rename label:', error)
      this.notify('Failed to rename label.', 'error')
      return false
    }
  },
  async updateRule(rule, changes) {
    const previous = { ...rule }
    Object.assign(rule, changes)
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${LABELS_API_URL}/labels/rules`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id: rule.id, ...changes }),
      })
      if (!response.ok)
        throw new Error(`PATCH /api/labels?resource=rules responded ${response.status}`)
      const { rule: updatedRule } = await response.json()
      Object.assign(rule, updatedRule)
      return true
    } catch (error) {
      Object.assign(rule, previous)
      console.error('Failed to update rule:', error)
      this.notify('Failed to update rule.', 'error')
      return false
    }
  },
  async setLabelAutoApply(label, autoApply) {
    const previous = label.auto_apply
    label.auto_apply = autoApply
    try {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${LABELS_API_URL}/labels`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id: label.id, auto_apply: autoApply }),
      })
      if (!response.ok) throw new Error(`PATCH /api/labels responded ${response.status}`)
    } catch (error) {
      label.auto_apply = previous
      console.error('Failed to update label auto-tagging:', error)
      this.notify('Failed to update auto-tagging.', 'error')
    }
  },
}
