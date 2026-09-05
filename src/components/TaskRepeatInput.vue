<script setup>
import { useId } from 'vue'

const model = defineModel({ type: String, default: '' })
defineProps({ disabled: Boolean })
const id = useId()
</script>

<template>
  <div class="task-repeat">
    <label :for="id">Repeat</label>
    <input
      :id="id"
      v-model="model"
      :list="`${id}-suggestions`"
      :aria-describedby="`${id}-help`"
      :disabled="disabled"
      type="text"
      maxlength="100"
      placeholder="Does not repeat"
      autocomplete="off"
    />
    <datalist :id="`${id}-suggestions`">
      <option value="every day" />
      <option value="every Monday" />
      <option value="every 2nd Tuesday" />
      <option value="every 3 days" />
      <option value="every 2 weeks" />
      <option value="every last Friday" />
    </datalist>
    <p :id="`${id}-help`">
      Try “every Monday”, “every 2nd Tuesday” (monthly), or “every 3 days”. Leave blank to stop
      repeating.
    </p>
  </div>
</template>

<style scoped>
.task-repeat label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
.task-repeat input {
  width: 100%;
  box-sizing: border-box;
  padding: 4px 6px;
  font: inherit;
  font-size: 14px;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
}
.task-repeat p {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}
</style>
