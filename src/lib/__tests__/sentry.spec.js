import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import { initSentry } from '../sentry'
import { start } from '../sentryClient'

const init = vi.fn()
const loadSdk = vi.fn()
const captureException = vi.fn()
const browserTracingIntegration = vi.fn()
const browserProfilingIntegration = vi.fn()
const client = {
  start: (app) =>
    start(app, {
      init,
      captureException,
      browserTracingIntegration,
      browserProfilingIntegration,
    }),
}

describe('browser error monitoring', () => {
  beforeEach(() => {
    browserTracingIntegration.mockReturnValue({ name: 'BrowserTracing' })
    browserProfilingIntegration.mockReturnValue({ name: 'BrowserProfiling' })
    loadSdk.mockResolvedValue(client)
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
  ])('does not initialize when %s is %s', async (key, value) => {
    vi.stubEnv(key, value)
    await initSentry({ config: {} }, loadSdk)
    expect(loadSdk).not.toHaveBeenCalled()
    expect(init).not.toHaveBeenCalled()
  })

  it('installs Vue error reporting with private data collection disabled', async () => {
    const router = {}
    const app = { config: { globalProperties: { $router: router } } }
    await initSentry(app, loadSdk)
    expect(browserTracingIntegration).toHaveBeenCalledWith({
      router,
      beforeStartSpan: expect.any(Function),
    })
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        app,
        dsn: 'https://public@example.com/1',
        environment: 'preview',
        release: 'test-release',
        attachProps: false,
        tracesSampleRate: 0.1,
        tracePropagationTargets: [],
        integrations: [{ name: 'BrowserTracing' }, { name: 'BrowserProfiling' }],
        profileSessionSampleRate: 0.1,
        profileLifecycle: 'trace',
        beforeSendSpan: expect.any(Function),
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
    expect(filtered.exception.values[0]).toEqual({
      type: 'Error',
      value: '[Redacted]',
      stacktrace: { frames: [] },
    })
    expect(filtered.request).toBeUndefined()
    expect(filtered.user).toBeUndefined()
    expect(filtered.breadcrumbs).toBeUndefined()
    expect(filtered.tags).toEqual({ service: 'cookie-web' })
  })

  it('renders while the SDK is pending and reports buffered Vue errors when it arrives', async () => {
    let resolveSdk
    loadSdk.mockReturnValue(
      new Promise((resolve) => {
        resolveSdk = resolve
      }),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('private mail')
    const app = createApp({
      setup() {
        throw error
      },
      render() {
        return h('div', 'Inbox available')
      },
    })
    const host = document.createElement('div')
    const ready = initSentry(app, loadSdk)
    app.mount(host)
    expect(host.textContent).toBe('Inbox available')
    expect(init).not.toHaveBeenCalled()
    resolveSdk(client)
    await ready
    expect(captureException).toHaveBeenCalledWith(error)
    app.unmount()
  })

  it('bounds the early error queue and preserves the previous handler', async () => {
    let resolveSdk
    loadSdk.mockReturnValue(
      new Promise((resolve) => {
        resolveSdk = resolve
      }),
    )
    const previousHandler = vi.fn()
    const app = { config: { errorHandler: previousHandler } }
    const ready = initSentry(app, loadSdk)
    for (let i = 0; i < 25; i++) app.config.errorHandler(new Error('failure'), null, 'render')
    expect(previousHandler).toHaveBeenCalledTimes(25)
    resolveSdk(client)
    await ready
    expect(captureException).toHaveBeenCalledTimes(20)
    expect(app.config.errorHandler).toBe(previousHandler)
  })

  it('defaults the environment and leaves an unset release out', async () => {
    vi.stubEnv('VITE_SENTRY_ENVIRONMENT', '')
    vi.stubEnv('VITE_SENTRY_RELEASE', '')
    await initSentry({ config: {} }, loadSdk)
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'production', release: undefined }),
    )
  })

  it('allows startup to continue if the SDK chunk fails to load', async () => {
    loadSdk.mockRejectedValue(new Error('Chunk unavailable'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(initSentry({ config: {} }, loadSdk)).resolves.toBeUndefined()
    expect(init).not.toHaveBeenCalled()
  })

  it('allows startup to continue if SDK initialization fails', async () => {
    init.mockImplementation(() => {
      throw new Error('SDK unavailable')
    })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(initSentry({ config: {} }, loadSdk)).resolves.toBeUndefined()
    expect(warning).toHaveBeenCalledWith('Sentry unavailable.')
  })
})
