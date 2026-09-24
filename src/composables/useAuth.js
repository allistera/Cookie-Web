import { ref } from 'vue'
import { useAuth0 } from '@auth0/auth0-vue'

// E2E mode (vite --mode e2e) stubs authentication so Playwright can exercise
// the app without a real Auth0 session.
const isE2E = import.meta.env.VITE_E2E === 'true'

const e2eAuth = {
  isAuthenticated: ref(true),
  isLoading: ref(false),
  user: ref({
    sub: 'auth0|e2e-user',
    name: 'Allister',
    email: 'allisteraall@gmail.com',
    picture: '/rose_avatar.webp',
  }),
  loginWithRedirect: async () => {},
  logout: async () => {},
  getAccessTokenSilently: async () => {
    throw new Error('Authentication is stubbed in E2E mode')
  },
}

export function useAuth() {
  return isE2E ? e2eAuth : useAuth0()
}
