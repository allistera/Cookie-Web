<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import { NEW_AUTOMATION_SECTION, automationRoute } from '../lib/automations'
import { TEMPLATE_APPS, searchTemplateGroups } from '../lib/automationTemplates'

// A gallery of automation ideas. The list is hard-coded and nothing runs yet:
// a card, the questions button and the prompt box all lead to Create
// Automation.
const router = useRouter()
const createRoute = automationRoute(NEW_AUTOMATION_SECTION)

const query = ref('')
const groups = computed(() => searchTemplateGroups(query.value))

// How many cards a row shows at a common width before it scrolls.
const ROW_SIZE = 3

// Groups showing every template as a grid instead of one scrolling row.
const expanded = ref(new Set())
function toggleGroup(id) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

const prompt = ref('')
function submitPrompt() {
  if (prompt.value.trim()) router.push(createRoute)
}
</script>

<template>
  <div class="templates-page" data-testid="automations-templates">
    <div class="templates-scroll">
      <div class="templates-column">
        <header class="templates-header">
          <h1>Find an automation that works for you</h1>
          <p>Be inspired by these ideas, or create your own.</p>
          <router-link class="templates-questions" :to="createRoute">
            Not sure what to automate? Answer a few questions
          </router-link>
        </header>

        <label class="templates-search">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <span class="visually-hidden">Search ideas</span>
          <input v-model="query" type="search" placeholder="Search ideas..." />
        </label>

        <p v-if="groups.length === 0" class="templates-empty" role="status">
          No ideas match “{{ query.trim() }}”.
        </p>

        <section
          v-for="group in groups"
          :key="group.id"
          class="templates-group"
          :aria-labelledby="`templates-group-${group.id}`"
        >
          <div class="templates-group-head">
            <div>
              <h2 :id="`templates-group-${group.id}`">{{ group.title }}</h2>
              <p v-if="group.description">{{ group.description }}</p>
            </div>
            <!-- A group that fits in one row has nothing more to show. -->
            <button
              v-if="group.templates.length > ROW_SIZE"
              type="button"
              class="templates-see-all"
              :aria-expanded="expanded.has(group.id)"
              @click="toggleGroup(group.id)"
            >
              {{ expanded.has(group.id) ? 'Show less' : 'See all' }}
              <span class="visually-hidden">{{ group.title }}</span>
              <span class="material-symbols-outlined" aria-hidden="true">{{
                expanded.has(group.id) ? 'keyboard_arrow_up' : 'keyboard_arrow_right'
              }}</span>
            </button>
          </div>

          <ul class="templates-row" :class="{ expanded: expanded.has(group.id) }">
            <li v-for="template in group.templates" :key="template.id">
              <router-link class="templates-card" :to="createRoute">
                <span class="templates-apps">
                  <span
                    v-for="app in template.apps"
                    :key="app"
                    class="templates-app"
                    :title="TEMPLATE_APPS[app].label"
                  >
                    <span class="material-symbols-outlined" aria-hidden="true">{{
                      TEMPLATE_APPS[app].icon
                    }}</span>
                    <span class="visually-hidden">{{ TEMPLATE_APPS[app].label }}</span>
                  </span>
                </span>
                <span class="templates-card-title">{{ template.title }}</span>
                <span class="templates-card-text">{{ template.description }}</span>
                <span class="templates-author">
                  <img src="/icons/cookie-mark.svg" alt="" />
                  By Cookie
                </span>
              </router-link>
            </li>
          </ul>
        </section>
      </div>
    </div>

    <!-- Floats over the foot of the page, as the question box does in Chat. -->
    <form class="templates-prompt" @submit.prevent="submitPrompt">
      <label class="visually-hidden" for="templatesPrompt">Describe an automation</label>
      <input
        id="templatesPrompt"
        v-model="prompt"
        type="text"
        placeholder="Describe an automation you'd like to create or ask a question"
      />
      <button type="submit" aria-label="Create automation" :disabled="!prompt.trim()">
        <span class="material-symbols-outlined" aria-hidden="true">arrow_upward</span>
      </button>
    </form>
  </div>
</template>

<style scoped>
.templates-page {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.templates-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.templates-column {
  max-width: 1200px;
  margin: 0 auto;
  /* Room at the foot for the floating prompt box. */
  padding: 32px 32px 120px;
}

.templates-header h1 {
  margin: 0 0 8px;
  font-size: 26px;
  font-weight: 700;
}

.templates-header p {
  margin: 0 0 20px;
  color: var(--text-secondary);
  font-size: 15px;
}

.templates-questions {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  background-color: var(--bg-input);
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.templates-questions:hover,
.templates-questions:focus-visible {
  background-color: var(--bg-hover);
}

.templates-search {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 46px;
  margin: 32px 0 36px;
  padding: 0 14px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background-color: var(--bg-card);
}

.templates-search:focus-within {
  border-color: var(--accent);
}

.templates-search .material-symbols-outlined {
  font-size: 20px;
  color: var(--text-secondary);
}

.templates-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: none;
  color: var(--text-primary);
  font: inherit;
  font-size: 15px;
}

.templates-empty {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.templates-group {
  margin-bottom: 44px;
}

.templates-group-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.templates-group-head h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.templates-group-head p {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.templates-see-all {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-secondary);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.templates-see-all:hover,
.templates-see-all:focus-visible {
  color: var(--text-primary);
}

.templates-see-all .material-symbols-outlined {
  font-size: 18px;
}

/* One row that scrolls sideways; See all lays the same cards out as a grid. */
.templates-row {
  display: flex;
  gap: 14px;
  margin: 0;
  padding: 0 0 4px;
  list-style: none;
  overflow-x: auto;
}

.templates-row > li {
  flex: 0 0 340px;
  display: flex;
}

.templates-row.expanded {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  overflow-x: visible;
}

.templates-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background-color: var(--bg-card);
  color: var(--text-primary);
  text-decoration: none;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.templates-card:hover,
.templates-card:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.templates-apps {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.templates-app {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
}

.templates-app .material-symbols-outlined {
  font-size: 16px;
  color: var(--accent);
}

.templates-card-title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}

.templates-card-text {
  flex: 1;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
}

.templates-author {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  color: var(--text-secondary);
  font-size: 13px;
}

.templates-author img {
  width: 20px;
  height: 20px;
}

.templates-prompt {
  position: absolute;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(640px, calc(100% - 32px));
  padding: 6px 6px 6px 18px;
  border: 1px solid var(--border-color);
  border-radius: 26px;
  background-color: var(--bg-card);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14);
}

.templates-prompt:focus-within {
  border-color: var(--accent);
}

.templates-prompt input {
  flex: 1;
  min-width: 0;
  height: 36px;
  border: 0;
  outline: 0;
  background: none;
  color: var(--text-primary);
  font: inherit;
  font-size: 14px;
}

.templates-prompt button {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background-color: var(--accent);
  color: #ffffff;
  cursor: pointer;
}

.templates-prompt button:disabled {
  background-color: var(--bg-input);
  color: var(--text-secondary);
  cursor: default;
}

.templates-prompt .material-symbols-outlined {
  font-size: 18px;
}

@media (max-width: 760px) {
  .templates-column {
    padding: 20px 16px 110px;
  }

  .templates-row > li {
    flex-basis: 280px;
  }
}
</style>
