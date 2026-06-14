<script setup>
import { useRouter } from 'vue-router'
import CkBtn from '@/components/ui/CkBtn.vue'
import CkIcon from '@/components/ui/CkIcon.vue'

const router = useRouter()
</script>

<template>
  <div class="feed">
    <div class="ck-empty" style="margin-top: 40px">
      <span class="ck-empty__icon"><CkIcon name="send" :size="24" /></span>
      <div class="ck-empty__title">Sent</div>
      <p class="ck-empty__text">Replies Cookie has sent on your behalf will appear here.</p>
      <CkBtn variant="outline" size="sm" @click="router.push({ name: 'today' })">Back to Today</CkBtn>
    </div>
  </div>
</template>
