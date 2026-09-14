<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'

import { useContactInsightsStore } from '../stores/contactInsights'

const props = defineProps({
  address: { type: String, required: true },
  name: { type: String, default: '' },
})

const store = useContactInsightsStore()
const showing = ref(false)
let closeTimer

const displayName = computed(() => props.name || props.address)
const initials = computed(() => {
  const source = props.name || props.address.split('@')[0]
  return (
    source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  )
})

function show() {
  window.clearTimeout(closeTimer)
  showing.value = true
}

function hideSoon() {
  window.clearTimeout(closeTimer)
  closeTimer = window.setTimeout(() => {
    showing.value = false
  }, 120)
}

function viewInsights() {
  showing.value = false
  void store.openContact({ address: props.address, name: props.name })
}

onBeforeUnmount(() => window.clearTimeout(closeTimer))
</script>

<template>
  <span
    class="contact-address"
    tabindex="0"
    @mouseenter="show"
    @mouseleave="hideSoon"
    @focusin="show"
    @focusout="hideSoon"
  >
    <span class="contact-address-text"
      ><slot>{{ address }}</slot></span
    >
    <span
      v-if="showing"
      class="contact-address-popover"
      role="dialog"
      :aria-label="'Contact actions for ' + address"
      @mouseenter="show"
      @mouseleave="hideSoon"
    >
      <span class="contact-address-avatar" aria-hidden="true">{{ initials }}</span>
      <span class="contact-address-copy">
        <strong>{{ displayName }}</strong>
        <span>{{ address }}</span>
      </span>
      <button type="button" @mousedown.stop @click.stop="viewInsights">
        View Insights
        <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
      </button>
    </span>
  </span>
</template>

<style scoped>
.contact-address {
  position: relative;
  display: inline-flex;
  outline: none;
}

.contact-address-text {
  border-radius: 4px;
  cursor: default;
}

.contact-address:hover .contact-address-text,
.contact-address:focus .contact-address-text {
  color: var(--text-blue);
  background: var(--accent-soft);
}

.contact-address-popover {
  position: absolute;
  top: calc(100% + 8px);
  left: -12px;
  z-index: 90;
  display: grid;
  grid-template-columns: 36px minmax(150px, 1fr);
  gap: 10px;
  width: 270px;
  padding: 14px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-card);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
  color: var(--text-primary);
  text-align: left;
}

.contact-address-popover::before {
  content: '';
  position: absolute;
  right: 0;
  bottom: 100%;
  left: 0;
  height: 10px;
}

.contact-address-avatar {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--text-blue);
  font-size: 13px;
  font-weight: 700;
}

.contact-address-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}

.contact-address-copy strong,
.contact-address-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-address-copy span {
  color: var(--text-secondary);
  font-weight: 400;
}

.contact-address-popover button {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--text-blue);
  border-radius: 7px;
  background: transparent;
  color: var(--text-blue);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.contact-address-popover button:hover {
  background: var(--accent-soft);
}

.contact-address-popover .material-symbols-outlined {
  font-size: 16px;
}
</style>
