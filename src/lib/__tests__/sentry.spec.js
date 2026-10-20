import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initSentry } from '../sentry'

const init = vi.fn()
const loadSdk = vi.fn()

describe('browser error monitoring', () => {
  beforeEach(() => {
    loadSdk.mockResolvedValue({ init })
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_E2E', 'false')
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.com/1')
    vi.stubEnv('VITE_SENTRY_ENVIRONMENT', 'preview')
    vi.stubEnv('VITE_SENTRY_RELEASE', 'test-release')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetAllMocks()
    vi.restoreAllMocks()
  })

  it.each([
    ['PROD', false],
    ['VITE_E2E', 'true'],
    ['VITE_SENTRY_DSN', ''],
    ['VITE_SENTRY_DSN', '   '],
  ])('does not initialize when %s is %s', async (key, value) => {
    vi.stubEnv(key, value)
    await initSentry({}, loadSdk)
    expect(loadSdk).not.toHaveBeenCalled()
    expect(init).not.toHaveBeenCalled()
  })

  it('installs Vue error reporting with private data collection disabled', async () => {
    const app = {}
    await initSentry(app, loadSdk)
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        app,
        dsn: 'https://public@example.com/1',
        environment: 'preview',
        release: 'test-release',
        attachProps: false,
        tracesSampleRate: 0,
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: { request: false, response: false },
          httpBodies: [],
          urlQueryParams: false,
          graphQL: { document: false, variables: false },
          genAI: { inputs: false, outputs: false },
          databaseQueryData: false,
          queues: false,
          stackFrameVariables: false,
        },
      }),
    )
    const event = {
      exception: { values: [{ type: 'Error', value: 'Rendering failed' }] },
      request: { url: 'https://example.com/?code=private' },
      user: { email: 'private@example.com' },
      breadcrumbs: [{ message: 'private mail subject' }],
      tags: { existing: 'tag' },
    }
    const filtered = init.mock.calls[0][0].beforeSend(event)
    expect(filtered.exception).toEqual(event.exception)
    expect(filtered.request).toBeUndefined()
    expect(filtered.user).toBeUndefined()
    expect(filtered.breadcrumbs).toBeUndefined()
    expect(filtered.tags).toEqual({ existing: 'tag', service: 'cookie-web' })
  })

  it('defaults the environment and leaves an unset release out', async () => {
    vi.stubEnv('VITE_SENTRY_ENVIRONMENT', '')
    vi.stubEnv('VITE_SENTRY_RELEASE', '')
    await initSentry({}, loadSdk)
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'production', release: undefined }),
    )
  })

  it('allows startup to continue if the SDK chunk fails to load', async () => {
    loadSdk.mockRejectedValue(new Error('Chunk unavailable'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(initSentry({}, loadSdk)).resolves.toBeUndefined()
    expect(init).not.toHaveBeenCalled()
  })

  it('allows startup to continue if SDK initialization fails', async () => {
    init.mockImplementation(() => {
      throw new Error('SDK unavailable')
    })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(initSentry({}, loadSdk)).resolves.toBeUndefined()
    expect(warning).toHaveBeenCalledWith('Error monitoring could not be initialized.')
  })
})
