<script setup>
import { computed } from 'vue'
import {
  INVITATION_RESPONSES,
  invitationAnswer,
  invitationBlockedReason,
  invitationHeading,
  invitationWhen,
  parseCalendarInvitation,
} from '../lib/calendarInvitation'

// A calendar invitation in the reader: what it is, the answer on record, and
// Accept / Maybe / Decline. Nothing is sent until one of those is pressed;
// the organiser is then mailed a calendar reply (the send Worker).
//
// Loaded on demand by the inbox view, which hands over the messages Worker's
// payload as it arrived; parsing it here keeps that out of the view's chunk.
const props = defineProps({
  payload: { type: Object, required: true },
  // The answer being sent, or '' when idle.
  sending: { type: String, default: '' },
  error: { type: String, default: '' },
})
defineEmits(['respond', 'open-event'])

const invitation = computed(() => parseCalendarInvitation(props.payload))
const heading = computed(() => invitationHeading(invitation.value))
const when = computed(() => invitationWhen(invitation.value))
const answer = computed(() => invitationAnswer(invitation.value))
const blockedReason = computed(() => invitationBlockedReason(invitation.value))
const canAnswer = computed(() => invitation.value.canReply && !invitation.value.cancelled)
// Which of the two icons the card wears. Decided here, not in the template:
// the icon-font subset check reads every quoted word inside an icon span as
// an icon name.
const onCalendarIcon = computed(
  () => invitation.value.response === 'accepted' && !invitation.value.cancelled,
)
const details = computed(() =>
  [when.value, invitation.value.recurring ? 'Repeats' : '', invitation.value.location]
    .filter(Boolean)
    .join(' · '),
)
</script>

<template>
  <section
    v-if="invitation"
    class="invitation-card"
    :class="{
      'invitation-card-cancelled': invitation.cancelled,
      'invitation-card-answered': invitation.response && !invitation.cancelled,
    }"
    aria-label="Calendar invitation"
    data-testid="invitation-card"
  >
    <span class="material-symbols-outlined invitation-card-icon" aria-hidden="true">
      <template v-if="onCalendarIcon">event_available</template>
      <template v-else>calendar_month</template>
    </span>
    <div class="invitation-card-body">
      <strong class="invitation-card-heading">{{ heading }}</strong>
      <span class="invitation-card-title">{{ invitation.title }}</span>
      <span class="invitation-card-details">{{ details }}</span>
      <p v-if="!invitation.current" class="invitation-card-note">
        This message has an earlier version of the invitation. The details here are the latest.
      </p>
      <p v-if="blockedReason" class="invitation-card-note" data-testid="invitation-blocked">
        {{ blockedReason }}
      </p>
      <p
        v-if="answer && !invitation.cancelled"
        class="invitation-card-answer"
        data-testid="invitation-answer"
      >
        {{ answer }}
      </p>
      <p v-if="error" class="invitation-card-error" role="alert">{{ error }}</p>
      <div v-if="canAnswer || invitation.event" class="invitation-card-actions">
        <template v-if="canAnswer">
          <button
            v-for="option in INVITATION_RESPONSES"
            :key="option.value"
            type="button"
            class="invitation-card-response"
            :class="{ 'invitation-card-response-chosen': invitation.response === option.value }"
            :aria-pressed="invitation.response === option.value"
            :disabled="Boolean(sending)"
            @click="$emit('respond', option.value)"
          >
            <span
              v-if="invitation.response === option.value"
              class="material-symbols-outlined invitation-card-chosen-icon"
              aria-hidden="true"
              >check</span
            >
            {{ sending === option.value ? 'Sending…' : option.label }}
          </button>
        </template>
        <button
          v-if="invitation.event"
          type="button"
          class="invitation-card-event"
          @click="$emit('open-event', invitation.event)"
        >
          Go to event
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.invitation-card {
  display: flex;
  flex-shrink: 0;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 22px;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--text-blue) 30%, var(--border-color));
  border-radius: 12px;
  background: color-mix(in srgb, var(--text-blue) 7%, var(--bg-card));
  color: var(--text-primary);
}

.invitation-card-answered {
  border-color: color-mix(in srgb, var(--text-green) 40%, var(--border-color));
  background: color-mix(in srgb, var(--text-green) 9%, var(--bg-card));
}

.invitation-card-cancelled {
  border-color: var(--border-color);
  background: var(--bg-card);
}

.invitation-card-icon {
  color: var(--text-blue);
  font-size: 23px;
}

.invitation-card-answered .invitation-card-icon {
  color: var(--text-green);
}

.invitation-card-cancelled .invitation-card-icon {
  color: var(--text-secondary);
}

.invitation-card-body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.invitation-card-heading {
  font-size: 14px;
}

.invitation-card-title {
  overflow-wrap: anywhere;
  font-size: 14px;
}

.invitation-card-cancelled .invitation-card-title {
  text-decoration: line-through;
}

.invitation-card-details,
.invitation-card-note,
.invitation-card-answer {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.invitation-card-note,
.invitation-card-answer,
.invitation-card-error {
  margin-top: 4px;
}

.invitation-card-error {
  margin-bottom: 0;
  color: var(--danger, #e5484d);
  font-size: 13px;
}

.invitation-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.invitation-card-response,
.invitation-card-event {
  padding: 7px 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}

.invitation-card-response:hover,
.invitation-card-response:focus-visible,
.invitation-card-event:hover,
.invitation-card-event:focus-visible {
  border-color: var(--text-blue);
  outline: 2px solid color-mix(in srgb, var(--text-blue) 28%, transparent);
  outline-offset: 2px;
}

.invitation-card-response {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* The answer on record keeps the page's own text colour on a tint, so it
   stays readable in both themes; the tick and aria-pressed carry the state. */
.invitation-card-response-chosen {
  border-color: var(--text-green);
  background: color-mix(in srgb, var(--text-green) 18%, var(--bg-card));
}

.invitation-card-chosen-icon {
  color: var(--text-green);
  font-size: 16px;
}

.invitation-card-response:disabled {
  cursor: progress;
  opacity: 0.6;
}

.invitation-card-event {
  margin-left: auto;
  border-color: transparent;
  background: transparent;
  color: var(--text-blue);
}

@media (max-width: 720px) {
  .invitation-card-event {
    margin-left: 0;
  }
}
</style>
