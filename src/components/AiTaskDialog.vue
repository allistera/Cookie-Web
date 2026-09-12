<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useTaskItemsStore } from '../stores/taskItems'

const emit = defineEmits(['close', 'created'])
const items = useTaskItemsStore()
const dialog = ref(null)
const input = ref(null)
const text = ref('')
const saving = ref(false)
const error = ref('')
let previousFocus

function close() {
  if (!saving.value) emit('close')
}

async function submit() {
  if (saving.value || !text.value.trim()) return
  saving.value = true
  error.value = ''
  try {
    const item = await items.generateItem(text.value.trim())
    emit('created', item)
  } catch (failure) {
    error.value = failure.userMessage || 'Could not create your task. Please try again.'
  } finally {
    saving.value = false
    input.value?.focus()
  }
}

onMounted(() => {
  previousFocus = document.activeElement
  dialog.value.showModal()
  input.value.focus()
})
onBeforeUnmount(() => {
  dialog.value?.close()
  previousFocus?.focus?.()
})
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="ai-task-dialog"
      aria-label="AI Task"
      :aria-busy="saving"
      @cancel.prevent="close"
      @click="$event.target === dialog && close()"
    >
      <form class="ai-task-form" @submit.prevent="submit">
        <div class="ai-task-prompt">
          <span class="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
          <input
            ref="input"
            v-model="text"
            aria-label="Describe your task"
            aria-describedby="ai-task-status"
            placeholder="Plan day trip to London"
            maxlength="1000"
            autocomplete="off"
            data-1p-ignore
            :readonly="saving"
            @keydown.enter="($event.isComposing || saving) && $event.preventDefault()"
          />
          <button v-if="text.trim()" type="submit" aria-label="Create AI task" :disabled="saving">
            <span class="material-symbols-outlined" aria-hidden="true">arrow_upward</span>
          </button>
          <button type="button" aria-label="Close AI Task" :disabled="saving" @click="close">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
        <p id="ai-task-status" class="ai-task-status" role="status">
          {{
            saving
              ? 'Creating your task and subtasks…'
              : 'Describe a task. Press Enter to create it in Inbox.'
          }}
        </p>
        <p v-if="error" class="ai-task-error" role="alert">{{ error }}</p>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.ai-task-dialog {
  width: min(1000px, calc(100vw - 40px));
  max-width: none;
  margin: auto;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  overflow: visible;
}
.ai-task-dialog::backdrop {
  background: rgb(30 35 45 / 18%);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
.ai-task-prompt {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 18px 24px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-dialog) 88%, #a9c1ed);
  box-shadow: 0 12px 50px rgb(0 0 0 / 12%);
}
.ai-task-prompt > span {
  font-size: 30px;
  color: var(--text-secondary);
}
.ai-task-prompt input {
  flex: 1;
  min-width: 0;
  padding: 6px 0;
  border: 0;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 15px;
}
.ai-task-prompt:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.ai-task-prompt input::placeholder {
  color: var(--text-secondary);
}
.ai-task-prompt button {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.ai-task-prompt button:hover:not(:disabled) {
  background: var(--bg-hover);
}
.ai-task-prompt button:disabled {
  opacity: 0.4;
  cursor: wait;
}
.ai-task-status,
.ai-task-error {
  width: fit-content;
  max-width: 100%;
  box-sizing: border-box;
  margin: 14px auto 0;
  padding: 8px 14px;
  border-radius: 12px;
  background: var(--bg-dialog);
  font-size: 14px;
  text-align: center;
}
.ai-task-error {
  color: var(--color-danger, #b42318);
}
@media (max-width: 600px) {
  .ai-task-prompt {
    gap: 8px;
    padding: 14px;
  }
  .ai-task-prompt > span {
    font-size: 24px;
  }
}
</style>
