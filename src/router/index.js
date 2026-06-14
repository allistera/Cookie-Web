import { createRouter, createWebHistory } from 'vue-router'
import TodayView from '@/views/TodayView.vue'

export default createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: { name: 'today' } },
    { path: '/today', name: 'today', component: TodayView },
    { path: '/digest', name: 'digest', component: () => import('@/views/DigestView.vue') },
    { path: '/calendar', name: 'calendar', component: () => import('@/views/CalendarView.vue') },
    { path: '/sent', name: 'sent', component: () => import('@/views/SentView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
  ],
})
