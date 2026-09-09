<script setup>
import { computed } from 'vue'

const props = defineProps({ layout: String, grouping: String })
defineEmits(['layout', 'grouping', 'reset'])
const count = computed(() => Number(props.layout === 'board') + Number(props.grouping === 'labels'))
</script>

<template>
  <div class="task-display">
    <button type="button" class="display-trigger" popovertarget="task-display-options">
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path v-if="layout === 'board'" d="M9 7v10M15 7v10" />
        <path v-else d="M7 9h10M7 15h10" />
      </svg>
      <span>{{ count ? `Display: ${count}` : 'Display' }}</span>
    </button>
    <div
      id="task-display-options"
      popover
      class="display-popover"
      aria-label="Task display options"
    >
      <h2>Layout</h2>
      <div class="display-layouts" role="group" aria-label="Task view">
        <button
          v-for="option in [
            { value: 'list', name: 'List', icon: 'view_list' },
            { value: 'board', name: 'Board', icon: 'view_column' },
          ]"
          :key="option.value"
          type="button"
          :aria-pressed="layout === option.value"
          @click="$emit('layout', option.value)"
        >
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path v-if="option.value === 'board'" d="M9 7v10M15 7v10" />
            <path v-else d="M7 9h10M7 15h10" />
          </svg>
          {{ option.name }}
        </button>
      </div>
      <div v-if="layout === 'board'" class="display-section">
        <h2>Grouping</h2>
        <label
          >Group by
          <select
            aria-label="Group tasks by"
            :value="grouping"
            @change="$emit('grouping', $event.target.value)"
          >
            <option value="priority">Priority</option>
            <option value="labels">Labels</option>
          </select>
        </label>
      </div>
      <button type="button" class="display-reset" @click="$emit('reset')">Reset all</button>
    </div>
  </div>
</template>

<style scoped>
.task-display {
  position: relative;
  margin-bottom: 16px;
}
.display-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  anchor-name: --task-display;
}
.display-trigger:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}
.display-popover {
  position: fixed;
  inset: auto;
  top: anchor(bottom);
  left: anchor(left);
  position-anchor: --task-display;
  position-try-fallbacks: flip-inline, flip-block;
  margin: 6px 0 0;
  box-sizing: border-box;
  width: min(340px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  overflow-y: auto;
  padding: 18px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-card);
  color: var(--text-primary);
  box-shadow: 0 8px 28px #0002;
  font: inherit;
  font-size: 14px;
}
.display-popover h2 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 650;
}
.display-layouts {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--bg-main, #8881);
  border-radius: 10px;
}
.display-layouts button {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px;
  font: inherit;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
}
.display-layouts button[aria-pressed='true'] {
  background: var(--bg-card);
  border-color: var(--border-color);
  color: var(--text-primary);
  box-shadow: 0 1px 3px #0001;
}
.display-section {
  border-top: 1px solid var(--border-color);
  margin-top: 18px;
  padding-top: 18px;
}
.display-section label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.display-section select {
  font: inherit;
  color: inherit;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 8px 12px;
  min-width: 170px;
}
.display-reset {
  display: block;
  width: 100%;
  margin-top: 18px;
  padding: 14px 0 0;
  border: 0;
  border-top: 1px solid var(--border-color);
  color: #d1453b;
  background: transparent;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
@supports not (top: anchor(bottom)) {
  .display-popover {
    inset: 100px auto auto 24px;
  }
}
</style>
