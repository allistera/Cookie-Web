import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { FEED } from '@/data/sample.js'

export const useFeedStore = defineStore('feed', () => {
  const items = ref([...FEED])
  const activeItem = ref(null)
  const composerOpen = ref(false)
  const toast = ref(null)
  let toastTimer = null

  const replyCount = computed(() => items.value.filter((i) => i.kind === 'reply').length)

  function dismiss(id) {
    items.value = items.value.filter((x) => x.id !== id)
  }

  function openReply(item) {
    activeItem.value = item
    composerOpen.value = true
  }

  function closeReply() {
    composerOpen.value = false
  }

  function send(item) {
    composerOpen.value = false
    items.value = items.value.filter((x) => x.id !== item.id)
    fireToast({ icon: 'check', title: 'Reply sent', message: `Filed under ${item.org}` })
  }

  function fireToast(t) {
    toast.value = t
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      toast.value = null
    }, 3200)
  }

  return { items, activeItem, composerOpen, toast, replyCount, dismiss, openReply, closeReply, send, fireToast }
})
