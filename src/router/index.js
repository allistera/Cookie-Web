import { createRouter, createWebHistory } from 'vue-router'
import AIInboxView from '../views/AIInboxView.vue'
import CalendarView from '../views/CalendarView.vue'
import TraditionalInboxView from '../views/TraditionalInboxView.vue'
import ScheduledSendsView from '../views/ScheduledSendsView.vue'

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
    {
      path: '/calendar',
      name: 'calendar',
      component: CalendarView,
    },
    {
      path: '/scheduled',
      name: 'scheduled-sends',
      component: ScheduledSendsView,
    },
  ],
})

export default router
