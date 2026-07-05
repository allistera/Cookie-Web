import { createRouter, createWebHistory } from 'vue-router'
import AIInboxView from '../views/AIInboxView.vue'
import TraditionalInboxView from '../views/TraditionalInboxView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'ai-inbox',
      component: AIInboxView,
    },
    {
      path: '/inbox',
      name: 'traditional-inbox',
      component: TraditionalInboxView,
    },
  ],
})

export default router
