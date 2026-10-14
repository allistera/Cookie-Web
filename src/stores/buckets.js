import { defineStore } from 'pinia'

import {
  BUCKET_DEFAULT_ICON,
  BUCKET_DEFAULT_TTL_MS,
  bucketItemKey,
  readBucket,
  removeBucket,
  writeBucket,
} from '../lib/bucketItems'

// One bucket per signed-in account (see lib/bucketItems.js for what it
// holds). The view showing an email, document, task or event registers it
// as the candidate (composables/useBucketCandidate.js); the 'b' shortcut in
// App.vue and the palette's "Pin to bucket" act on that candidate.
export const useBucketsStore = defineStore('buckets', {
  state: () => ({
    ownerSub: null,
    bucket: null,
    // What 'b' would pin right now, and a token naming the view that set it,
    // so a view unmounting after its successor registered does not clear
    // the successor's candidate.
    candidate: null,
    candidateToken: null,
    isOpen: false,
  }),

  getters: {
    hasBucket: (state) => state.bucket !== null,
    items: (state) => state.bucket?.items ?? [],
    isCandidatePinned(state) {
      if (!state.candidate || !state.bucket) return false
      const key = bucketItemKey(state.candidate)
      return state.bucket.items.some((item) => bucketItemKey(item) === key)
    },
  },

  actions: {
    setOwner(sub) {
      const owner = sub || null
      if (owner === this.ownerSub) return
      this.ownerSub = owner
      this.isOpen = false
      this.bucket = owner ? readBucket(owner) : null
      this.expireIfDue()
    },

    setCandidate(token, item) {
      this.candidate = item
      this.candidateToken = item ? token : null
    },

    clearCandidate(token) {
      if (this.candidateToken !== token) return
      this.candidate = null
      this.candidateToken = null
    },

    // Drops a bucket past its clearing time. Called on load, once a minute
    // while the app is open, and when the tab regains focus.
    expireIfDue(now = Date.now()) {
      if (!this.bucket || this.bucket.expiresAt > now) return false
      this.bucket = null
      this.isOpen = false
      removeBucket(this.ownerSub)
      return true
    },

    persist() {
      writeBucket(this.bucket)
    },

    ensureBucket(now = Date.now()) {
      if (this.bucket) return this.bucket
      this.bucket = {
        owner: this.ownerSub,
        title: '',
        icon: BUCKET_DEFAULT_ICON,
        createdAt: now,
        expiresAt: now + BUCKET_DEFAULT_TTL_MS,
        items: [],
      }
      return this.bucket
    },

    // Pins an item, or unpins it when it is already in the bucket. The first
    // pin makes the bucket. Returns what happened, for the caller's toast.
    togglePin(item) {
      if (!item || !this.ownerSub) return null
      this.expireIfDue()
      const key = bucketItemKey(item)
      const bucket = this.ensureBucket()
      const index = bucket.items.findIndex((row) => bucketItemKey(row) === key)
      if (index === -1) {
        bucket.items.push({ ...item, meta: { ...item.meta } })
      } else {
        bucket.items.splice(index, 1)
      }
      this.persist()
      return index === -1 ? 'pinned' : 'unpinned'
    },

    pinCandidate() {
      return this.togglePin(this.candidate)
    },

    removeItem(key) {
      if (!this.bucket) return
      this.bucket.items = this.bucket.items.filter((item) => bucketItemKey(item) !== key)
      this.persist()
    },

    rename(title) {
      if (!this.bucket) return
      this.bucket.title = String(title ?? '').slice(0, 120)
      this.persist()
    },

    setIcon(icon) {
      if (!this.bucket) return
      this.bucket.icon = String(icon ?? '') || BUCKET_DEFAULT_ICON
      this.persist()
    },

    // Restarts the clock: the bucket clears `ttlMs` from now.
    setExpiry(ttlMs, now = Date.now()) {
      if (!this.bucket || !(ttlMs > 0)) return
      this.bucket.expiresAt = now + ttlMs
      this.persist()
    },

    // Removes the bucket outright. Returns what was removed so a toast can
    // offer to put it back.
    clear() {
      const previous = this.bucket
      this.bucket = null
      this.isOpen = false
      removeBucket(this.ownerSub)
      return previous
    },

    // Puts a cleared bucket back. Anything pinned since the clear (which
    // made a fresh bucket) is kept, after the restored items.
    restore(bucket) {
      if (!bucket || bucket.owner !== this.ownerSub) return
      const keys = new Set(bucket.items.map(bucketItemKey))
      const since = (this.bucket?.items ?? []).filter((item) => !keys.has(bucketItemKey(item)))
      this.bucket = { ...bucket, items: [...bucket.items, ...since] }
      this.persist()
    },

    open() {
      if (this.expireIfDue() || !this.bucket) return
      this.isOpen = true
    },

    close() {
      this.isOpen = false
    },

    toggleOpen() {
      if (this.isOpen) this.close()
      else this.open()
    },
  },
})
