<script setup>
import { computed } from 'vue'

import { parseDocumentIcon } from '../lib/documentIcons'

// A document's stored icon: an emoji renders as text, an `ms:<icon_name>`
// value as a Material Symbols glyph sized relative to the surrounding text, so
// callers keep sizing it with font-size exactly as they did the emoji. It is
// decorative: every caller shows the document title beside it.
const props = defineProps({
  value: { type: String, default: '' },
  // Shown when `value` is empty or malformed, e.g. a template's default 📄.
  fallback: { type: String, default: '' },
})

const icon = computed(() => parseDocumentIcon(props.value) ?? parseDocumentIcon(props.fallback))
</script>

<template>
  <span class="document-icon" aria-hidden="true">
    <span v-if="icon?.symbol" class="material-symbols-outlined document-icon-glyph">{{
      icon.symbol
    }}</span>
    <template v-else>{{ icon?.emoji }}</template>
  </span>
</template>

<style scoped>
/* Two classes so this beats contextual rules such as
   `.nav-item .material-symbols-outlined`, which pin a fixed pixel size. */
.document-icon .document-icon-glyph {
  font-size: 1.2em;
  vertical-align: middle;
}
</style>
