<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import EmojiPicker from './EmojiPicker.vue'
import {
  BUCKET_TTL_CHOICES,
  bucketExpiryLabel,
  bucketItemIcon,
  bucketItemKey,
  bucketItemRoute,
  bucketItemSubtitle,
} from '../lib/bucketItems'
import { useBucketsStore } from '../stores/buckets'
import { useInboxStore } from '../stores/inbox'

// The bucket's popover, under its header button (App.vue mounts it while
// store.isOpen). The title edits by typing straight into it and the icon by
// clicking it; each row opens its item; "Clears in" restarts the clock.
const store = useBucketsStore()
const inbox = useInboxStore()

const bucket = computed(() => store.bucket)
const items = computed(() => bucket.value?.items ?? [])
const countText = computed(() => `${items.value.length} item${items.value.length === 1 ? '' : 's'}`)

// Ticks once a minute so "edited 1h ago" and "Clears in" keep up while open.
const now = ref(Date.now())
let ticker = null
const expiryLabel = computed(() => bucketExpiryLabel(bucket.value?.expiresAt, now.value))
const expiryOpen = ref(false)

const panelRef = ref(null)
const titleInput = ref(null)

function subtitle(item) {
  return bucketItemSubtitle(item, new Date(now.value))
}

function openItem() {
  store.close()
}

function remove(item) {
  store.removeItem(bucketItemKey(item))
}

function rename(event) {
  store.rename(event.target.value)
}

function setExpiry(choice) {
  store.setExpiry(choice.ms)
  now.value = Date.now()
  expiryOpen.value = false
}

// Clearing removes the whole bucket, header button included; the toast's
// Undo (and the 'u' shortcut) put it back.
function clear() {
  const previous = store.clear()
  if (!previous) return
  inbox.notify('Bucket cleared.', 'info', { label: 'Undo', run: () => store.restore(previous) })
}

// A click outside closes the panel; the header button that opened it is
// left to its own toggle, or the two would cancel out.
function onDocumentClick(event) {
  const path = event.composedPath()
  if (path.some((node) => node?.classList?.contains('bucket-trigger'))) return
  if (!path.some((node) => node?.classList?.contains('bucket-expiry'))) expiryOpen.value = false
  if (panelRef.value && !path.includes(panelRef.value)) store.close()
}

// Escape closes the expiry menu first, then the panel, and is kept from the
// page behind (the inbox's Escape would also close its reader). Whatever
// sits above the panel keeps its own Escape: the command palette, the
// shortcuts help, a modal dialog, or the icon picker's popover.
function onKeydown(event) {
  if (event.key !== 'Escape') return
  if (
    inbox.isCommandPaletteOpen ||
    inbox.isShortcutsHelpOpen ||
    document.querySelector('dialog[open], [aria-modal="true"]') ||
    panelRef.value?.querySelector('.composer-emoji-popover')
  ) {
    return
  }
  event.stopPropagation()
  event.preventDefault()
  if (expiryOpen.value) expiryOpen.value = false
  else store.close()
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  window.addEventListener('keydown', onKeydown, true)
  ticker = setInterval(() => {
    now.value = Date.now()
    store.expireIfDue(now.value)
  }, 60_000)
  // A bucket made moments ago has no name yet: typing names it.
  nextTick(() => titleInput.value?.focus())
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  window.removeEventListener('keydown', onKeydown, true)
  clearInterval(ticker)
})
</script>

<template>
  <section
    v-if="bucket"
    ref="panelRef"
    class="bucket-panel"
    role="dialog"
    aria-label="Bucket"
    data-testid="bucket-panel"
  >
    <header class="bucket-header">
      <EmojiPicker
        class="bucket-icon-picker"
        label="Change bucket icon"
        :emoji="bucket.icon"
        icons
        @select="store.setIcon($event)"
      />
      <input
        ref="titleInput"
        class="bucket-title"
        type="text"
        :value="bucket.title"
        placeholder="Name this bucket"
        aria-label="Bucket name"
        maxlength="120"
        autocomplete="off"
        @input="rename"
      />
      <button type="button" class="bucket-close" aria-label="Close bucket" @click="store.close()">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>

    <div class="bucket-body">
      <div class="bucket-body-top">
        <span class="bucket-count">{{ countText }}</span>
        <div class="bucket-expiry">
          <button
            type="button"
            class="bucket-expiry-trigger"
            aria-haspopup="menu"
            :aria-expanded="expiryOpen"
            @click="expiryOpen = !expiryOpen"
          >
            <span class="material-symbols-outlined" aria-hidden="true">schedule</span>
            <span>{{ expiryLabel }}</span>
            <span class="material-symbols-outlined bucket-expiry-chevron" aria-hidden="true"
              >keyboard_arrow_down</span
            >
          </button>
          <div
            v-if="expiryOpen"
            class="bucket-expiry-menu"
            role="menu"
            aria-label="Clear the bucket"
          >
            <button
              v-for="choice in BUCKET_TTL_CHOICES"
              :key="choice.id"
              type="button"
              role="menuitem"
              class="bucket-expiry-item"
              @click="setExpiry(choice)"
            >
              Clear in {{ choice.label }}
            </button>
          </div>
        </div>
      </div>

      <ul v-if="items.length" class="bucket-list">
        <li v-for="item in items" :key="bucketItemKey(item)" class="bucket-item">
          <router-link :to="bucketItemRoute(item)" class="bucket-item-link" @click="openItem">
            <span class="bucket-item-icon" :class="`bucket-item-icon--${item.kind}`">
              <span class="material-symbols-outlined" aria-hidden="true">{{
                bucketItemIcon(item.kind)
              }}</span>
            </span>
            <span class="bucket-item-text">
              <span class="bucket-item-title">{{ item.title }}</span>
              <span class="bucket-item-subtitle">{{ subtitle(item) }}</span>
            </span>
          </router-link>
          <button
            type="button"
            class="bucket-item-remove"
            :aria-label="`Remove ${item.title} from the bucket`"
            @click="remove(item)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </li>
      </ul>
      <p v-else class="bucket-empty">
        Nothing pinned yet. Open an email, document, task or event and press B.
      </p>
    </div>

    <footer class="bucket-footer">
      <span class="bucket-hint">Press <kbd>B</kbd> on any item to pin it</span>
      <div class="bucket-footer-actions">
        <button type="button" class="bucket-clear" @click="clear">Clear</button>
        <button type="button" class="bucket-done" @click="store.close()">
          <span class="material-symbols-outlined" aria-hidden="true">check</span>
          <span>Done</span>
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.bucket-panel {
  position: fixed;
  top: 58px;
  right: 16px;
  z-index: var(--z-dropdown);
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 74px);
  display: flex;
  flex-direction: column;
  padding: 20px;
  border: 1px solid var(--border-color);
  border-radius: 20px;
  background: var(--bg-dialog);
  box-shadow: var(--shadow-lg);
  animation: slide-down 0.2s ease-out;
}

.bucket-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.bucket-icon-picker {
  flex-shrink: 0;
}

.bucket-icon-picker :deep(.composer-emoji-btn) {
  width: 64px;
  height: 64px;
  padding: 0;
  border-radius: 16px;
  background: var(--bg-input);
  font-size: 30px;
  line-height: 1;
  display: grid;
  place-items: center;
}

.bucket-icon-picker :deep(.composer-emoji-btn:hover),
.bucket-icon-picker :deep(.composer-emoji-btn[aria-expanded='true']) {
  background: var(--bg-hover);
}

.bucket-icon-picker :deep(.composer-emoji-popover) {
  top: calc(100% + 8px);
  bottom: auto;
  left: 0;
  right: auto;
  width: min(320px, calc(100vw - 64px));
}

.bucket-title {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  outline: none;
}

.bucket-title::placeholder {
  color: var(--text-secondary);
  font-weight: 500;
}

.bucket-title:hover,
.bucket-title:focus {
  border-color: var(--border-color);
  background: var(--bg-card);
}

.bucket-close,
.bucket-item-remove {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: grid;
  place-items: center;
}

.bucket-close:hover,
.bucket-close:focus-visible,
.bucket-item-remove:hover,
.bucket-item-remove:focus-visible {
  background: var(--bg-hover);
  color: var(--text-primary);
  outline: none;
}

.bucket-close .material-symbols-outlined,
.bucket-item-remove .material-symbols-outlined {
  font-size: 20px;
}

.bucket-body {
  min-height: 0;
  overflow: auto;
  padding: 14px;
  border-radius: 16px;
  background: var(--bg-input);
}

.bucket-body-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.bucket-count {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-secondary);
}

.bucket-expiry {
  position: relative;
}

.bucket-expiry-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px 0 12px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--bg-card);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
}

.bucket-expiry-trigger:hover,
.bucket-expiry-trigger:focus-visible {
  background: var(--bg-hover);
  outline: none;
}

.bucket-expiry-trigger .material-symbols-outlined {
  font-size: 18px;
  color: var(--text-secondary);
}

.bucket-expiry-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: var(--z-popover);
  min-width: 160px;
  padding: 6px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-dialog);
  box-shadow: var(--shadow-md);
}

.bucket-expiry-item {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.bucket-expiry-item:hover,
.bucket-expiry-item:focus-visible {
  background: var(--bg-hover);
  outline: none;
}

.bucket-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bucket-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 8px 8px 10px;
  border-radius: 12px;
  background: var(--bg-card);
  box-shadow: var(--shadow-sm);
}

.bucket-item-link {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  color: inherit;
  text-decoration: none;
  border-radius: 8px;
}

.bucket-item-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.bucket-item-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: var(--bg-input);
  color: var(--text-secondary);
}

.bucket-item-icon .material-symbols-outlined {
  font-size: 20px;
}

.bucket-item-icon--email {
  background: rgba(94, 106, 210, 0.14);
  color: var(--text-blue);
}

.bucket-item-icon--event {
  background: rgba(180, 83, 9, 0.14);
  color: var(--schedule-line);
}

.bucket-item-icon--task {
  background: rgba(76, 183, 130, 0.16);
  color: var(--text-green);
}

.bucket-item-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.bucket-item-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bucket-item-subtitle {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bucket-empty {
  padding: 20px 8px;
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
}

.bucket-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
}

.bucket-hint {
  font-size: 13px;
  color: var(--text-secondary);
}

.bucket-hint kbd {
  display: inline-block;
  min-width: 20px;
  padding: 1px 5px;
  border: 1px solid var(--border-color);
  border-radius: 5px;
  background: var(--bg-card);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 11px;
  text-align: center;
}

.bucket-footer-actions {
  display: flex;
  gap: 8px;
}

.bucket-clear,
.bucket-done {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  padding: 0 18px;
  border-radius: 999px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.bucket-clear {
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-primary);
}

.bucket-clear:hover,
.bucket-clear:focus-visible {
  background: var(--bg-hover);
  outline: none;
}

.bucket-done {
  border: 0;
  background: var(--accent);
  color: #fff;
}

.bucket-done:hover,
.bucket-done:focus-visible {
  background: var(--accent-hover);
  outline: none;
}

.bucket-done .material-symbols-outlined {
  font-size: 18px;
}

@media (max-width: 640px) {
  .bucket-panel {
    right: 8px;
    left: 8px;
    width: auto;
    padding: 16px;
  }

  .bucket-footer {
    flex-direction: column;
    align-items: stretch;
  }

  .bucket-footer-actions {
    justify-content: flex-end;
  }
}
</style>
