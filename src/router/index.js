import { createRouter, createWebHistory } from 'vue-router'
import TraditionalInboxView from '../views/TraditionalInboxView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/inbox' },
    {
      path: '/inbox',
      name: 'traditional-inbox',
      component: TraditionalInboxView,
    },
  ],
})

export default router
