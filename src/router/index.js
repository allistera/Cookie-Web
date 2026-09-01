import { watch } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'

import { getAuth0 } from '../auth0-client'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'ai-inbox',
      component: () => import('../views/AIInboxView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/inbox',
      name: 'traditional-inbox',
      component: () => import('../views/TraditionalInboxView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/calendar',
      name: 'calendar',
      component: () => import('../views/CalendarView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/scheduled',
      name: 'scheduled-sends',
      component: () => import('../views/ScheduledSendsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/documents/:id?',
      name: 'documents',
      component: () => import('../views/DocumentsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/search',
      name: 'search',
      component: () => import('../views/SearchResultsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/tasks',
      name: 'tasks',
      component: () => import('../views/TasksView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/settings/:section?',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
      meta: { requiresAuth: true, layout: 'settings' },
    },
  ],
})

// Structural backstop alongside App.vue's template-level gating (which already
// keeps <router-view> unmounted while unauthenticated, by nesting it inside
// v-else-if="!isAuthenticated"). This guard never itself calls
// loginWithRedirect — the app's own "Log In with Auth0" button still owns
// that — it only blocks navigation into an authenticated route if one is ever
// reached before or without that template gate, so protection isn't solely
// incidental to App.vue's current structure. getAuth0() returns the same
// singleton client instance installed via app.use() in main.js, so this reads
// the identical isLoading/isAuthenticated state components observe through
// useAuth0(). Returns null in E2E mode, where auth is stubbed as always
// authenticated.
router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true
  const auth0 = getAuth0()
  if (!auth0) return true

  if (auth0.isLoading.value) {
    await new Promise((resolve) => {
      const stop = watch(auth0.isLoading, (loading) => {
        if (!loading) {
          stop()
          resolve()
        }
      })
    })
  }
  return auth0.isAuthenticated.value
})

export default router
