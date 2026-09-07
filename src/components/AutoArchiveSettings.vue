<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useInboxStore } from '../stores/inbox'
import { autoArchiveCategories } from '../lib/autoArchive'

const store = useInboxStore()
const draft = reactive({ ...store.autoArchive })
const loading = ref(false)
const saving = ref(false)
const error = ref('')
watch(
  () => store.autoArchive,
  (saved) => Object.assign(draft, saved),
)
const dirty = computed(() =>
  autoArchiveCategories.some(({ key }) => draft[key] !== store.autoArchive[key]),
)

async function load() {
  loading.value = true
  error.value = ''
  try {
    await store.loadAutoArchive()
  } catch {
    error.value = 'Could not load auto archive settings. Please retry.'
  } finally {
    loading.value = false
  }
}
async function save() {
  saving.value = true
  error.value = ''
  try {
    await store.saveAutoArchive({ ...draft })
    store.notify('Auto archive settings saved.')
  } catch {
    error.value = 'Could not save. Your changes have not been applied. Please try again.'
  } finally {
    saving.value = false
  }
}
onMounted(load)
</script>

<template>
  <section class="settings-section" data-testid="auto-archive-section">
    <h3 class="settings-section-title">Auto Archive</h3>
    <p class="settings-section-hint">
      Choose which low-priority mail Cookie AI can move to Done and mark read. Nothing is deleted.
      Only messages arriving after you enable a category are eligible; existing mail stays
      untouched. Receipts, personal messages and important account alerts are excluded from these
      categories. AI can make mistakes, so you can find archived messages in Done.
    </p>
    <form @submit.prevent="save">
      <fieldset
        :disabled="loading || saving || !store.autoArchiveLoaded"
        class="auto-archive-options"
      >
        <label
          v-for="category in autoArchiveCategories"
          :key="category.key"
          class="auto-archive-option"
        >
          <input v-model="draft[category.key]" type="checkbox" :aria-label="category.label" />
          <span
            ><strong>{{ category.label }}</strong
            ><span class="settings-section-hint">{{ category.description }}</span></span
          >
        </label>
      </fieldset>
      <p class="settings-section-hint">
        Filing happens after AI processing. Mail you read, star or schedule is left alone.
      </p>
      <button
        class="btn btn-primary"
        type="submit"
        :disabled="loading || saving || !store.autoArchiveLoaded || !dirty"
      >
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
    </form>
    <p v-if="error" class="settings-error" role="alert">{{ error }}</p>
    <button
      v-if="error && !store.autoArchiveLoaded"
      class="btn btn-secondary"
      data-testid="retry-auto-archive"
      :disabled="loading"
      @click="load"
    >
      Retry
    </button>
  </section>
</template>

<style scoped>
.auto-archive-options {
  border: 0;
  padding: 0;
  margin: 20px 0;
  display: grid;
  gap: 20px;
}
.auto-archive-option {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  cursor: pointer;
}
.auto-archive-option input {
  margin-top: 4px;
}
.auto-archive-option .settings-section-hint {
  display: block;
  margin: 4px 0 0;
}
</style>
