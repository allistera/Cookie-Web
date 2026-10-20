import { describe, expect, it } from 'vitest'
import { sentryBuildConfig } from '../sentryBuild.js'

const env = {
  SENTRY_DSN: 'https://public@example.com/1',
  SENTRY_AUTH_TOKEN: 'build-only-test-token',
  SENTRY_ORG: 'test-org',
  SENTRY_PROJECT: 'test-project',
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_SHA: 'test-commit',
  SENTRY_PUBLIC_KEY: 'unused-public-key',
  SENTRY_OTLP_TRACES_URL: 'https://example.com/private-otlp',
  SENTRY_VERCEL_LOG_DRAIN_URL: 'https://example.com/private-drain',
}

describe('Sentry Vercel build configuration', () => {
  it('maps only the public DSN, environment and release into browser code', () => {
    const config = sentryBuildConfig(env, 'build', 'production')
    expect(config.define).toEqual({
      'import.meta.env.VITE_SENTRY_DSN': JSON.stringify(env.SENTRY_DSN),
      'import.meta.env.VITE_SENTRY_ENVIRONMENT': '"preview"',
      'import.meta.env.VITE_SENTRY_RELEASE': '"test-commit"',
    })
    expect(JSON.stringify(config.define)).not.toContain(env.SENTRY_AUTH_TOKEN)
    expect(JSON.stringify(config.define)).not.toContain('private-otlp')
    expect(JSON.stringify(config.define)).not.toContain('private-drain')
    expect(config.upload).toBe(true)
    expect(config.pluginOptions).toMatchObject({
      authToken: env.SENTRY_AUTH_TOKEN,
      org: 'test-org',
      project: 'test-project',
      release: { name: 'test-commit', inject: false },
      sourcemaps: { filesToDeleteAfterUpload: './dist/**/*.map' },
    })
  })

  it('preserves explicit VITE overrides, including disabling the DSN', () => {
    const config = sentryBuildConfig(
      {
        ...env,
        VITE_SENTRY_DSN: '',
        VITE_SENTRY_ENVIRONMENT: 'staging',
        VITE_SENTRY_RELEASE: 'v1',
      },
      'build',
      'production',
    )
    expect(config.define['import.meta.env.VITE_SENTRY_DSN']).toBe('""')
    expect(config.define['import.meta.env.VITE_SENTRY_ENVIRONMENT']).toBe('"staging"')
    expect(config.define['import.meta.env.VITE_SENTRY_RELEASE']).toBe('"v1"')
    expect(config.upload).toBe(false)
  })

  it.each(['SENTRY_DSN', 'SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'])(
    'does not generate/upload source maps without %s',
    (key) => {
      expect(sentryBuildConfig({ ...env, [key]: '' }, 'build', 'production').upload).toBe(false)
    },
  )

  it('treats a whitespace-only DSN as disabled', () => {
    const config = sentryBuildConfig({ ...env, SENTRY_DSN: '   ' }, 'build', 'production')
    expect(config.define['import.meta.env.VITE_SENTRY_DSN']).toBe('""')
    expect(config.upload).toBe(false)
  })

  it('never uploads during development, tests or E2E builds', () => {
    expect(sentryBuildConfig(env, 'serve', 'development').upload).toBe(false)
    expect(sentryBuildConfig(env, 'serve', 'test').upload).toBe(false)
    expect(sentryBuildConfig(env, 'build', 'e2e').upload).toBe(false)
    expect(sentryBuildConfig({ ...env, VITE_E2E: 'true' }, 'build', 'production').upload).toBe(
      false,
    )
  })
})
