// Explicitly expose only public browser configuration. Never broaden Vite's
// envPrefix to SENTRY_: the auth token belongs exclusively to the build plugin.
export function sentryBuildConfig(env, command, mode) {
  const dsn = (env.VITE_SENTRY_DSN ?? env.SENTRY_DSN ?? '').trim()
  const environment =
    env.VITE_SENTRY_ENVIRONMENT ?? env.SENTRY_ENVIRONMENT ?? env.VERCEL_ENV ?? 'production'
  const release = env.VITE_SENTRY_RELEASE ?? env.SENTRY_RELEASE ?? env.VERCEL_GIT_COMMIT_SHA ?? ''
  const upload = Boolean(
    command === 'build' &&
    mode !== 'e2e' &&
    env.VITE_E2E !== 'true' &&
    dsn.trim() &&
    env.SENTRY_AUTH_TOKEN &&
    env.SENTRY_ORG &&
    env.SENTRY_PROJECT,
  )
  return {
    define: {
      'import.meta.env.VITE_SENTRY_DSN': JSON.stringify(dsn),
      'import.meta.env.VITE_SENTRY_ENVIRONMENT': JSON.stringify(environment),
      'import.meta.env.VITE_SENTRY_RELEASE': JSON.stringify(release),
    },
    upload,
    pluginOptions: {
      authToken: env.SENTRY_AUTH_TOKEN,
      org: env.SENTRY_ORG,
      project: env.SENTRY_PROJECT,
      telemetry: false,
      release: { name: release || undefined, inject: false },
      sourcemaps: {
        assets: './dist/**',
        filesToDeleteAfterUpload: './dist/**/*.map',
      },
    },
  }
}
