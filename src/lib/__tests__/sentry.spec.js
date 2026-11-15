import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import { initSentry } from '../sentry'
import { start } from '../sentryClient'

const init = vi.fn()
const loadSdk = vi.fn()
const captureException = vi.fn()
const browserTracingIntegration = vi.fn()
const replayIntegration = vi.fn()
const client = {
  start: (app) =>
    start(app, {
      init,
      captureException,
      browserTracingIntegration,
      replayIntegration,
    }),
}

describe('browser error monitoring', () => {
  beforeEach(() => {
    browserTracingIntegration.mockReturnValue({ name: 'BrowserTracing' })
    replayIntegration.mockReturnValue({ name: 'Replay' })
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
    expect(replayIntegration).toHaveBeenCalledWith({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
      maskAttributes: ['title', 'placeholder', 'aria-label', 'alt'],
      block: ['.ni-email-frame'],
      beforeAddRecordingEvent: expect.any(Function),
    })
    const options = init.mock.calls[0][0]
    expect(options).not.toHaveProperty('profileSessionSampleRate')
    expect(options).not.toHaveProperty('profileLifecycle')
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        app,
        dsn: 'https://public@example.com/1',
        environment: 'preview',
        release: 'test-release',
        attachProps: false,
        tracesSampleRate: 0.1,
        tracePropagationTargets: [],
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1,
        integrations: [
          { name: 'BrowserTracing' },
          { name: 'Replay' },
          { name: 'ReplayPrivacy', processEvent: expect.any(Function) },
        ],
        tunnel: '/monitoring',
        beforeSendSpan: expect.any(Function),
        beforeSendMetric: expect.any(Function),
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

  // The SDK chunk must not compete with the first view: nothing is fetched
  // until the scheduled idle task runs.
  it('waits for the browser to be idle before loading the SDK', async () => {
    let runWhenIdle
    const schedule = vi.fn((task) => {
      runWhenIdle = task
    })
    const ready = initSentry({ config: {} }, loadSdk, schedule)
    await Promise.resolve()
    expect(schedule).toHaveBeenCalledOnce()
    expect(loadSdk).not.toHaveBeenCalled()

    runWhenIdle()
    await ready
    expect(loadSdk).toHaveBeenCalledOnce()
    expect(init).toHaveBeenCalledOnce()
  })

  // The SDK's own global handlers do not exist until it has loaded.
  it('reports uncaught errors and unhandled rejections raised before the SDK is ready', async () => {
    let runWhenIdle
    const schedule = (task) => {
      runWhenIdle = task
    }
    const ready = initSentry({ config: {} }, loadSdk, schedule)
    const uncaught = new Error('uncaught before the SDK')
    const rejected = new Error('rejected before the SDK')
    window.dispatchEvent(Object.assign(new Event('error'), { error: uncaught }))
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: rejected }))
    // A cross-origin "Script error." carries no error object to report.
    window.dispatchEvent(Object.assign(new Event('error'), { error: null }))
    expect(captureException).not.toHaveBeenCalled()

    runWhenIdle()
    await ready
    expect(captureException.mock.calls).toEqual([[uncaught], [rejected]])

    // From here the SDK listens for itself; nothing is reported twice. (The
    // listener stands in for the SDK's: the test environment treats an error
    // event nobody listens for as a failure.)
    const sdkListener = vi.fn()
    window.addEventListener('error', sdkListener)
    window.dispatchEvent(Object.assign(new Event('error'), { error: new Error('later') }))
    window.removeEventListener('error', sdkListener)
    expect(sdkListener).toHaveBeenCalledOnce()
    expect(captureException).toHaveBeenCalledTimes(2)
  })

  it('stops listening for early errors when the SDK cannot be loaded', async () => {
    loadSdk.mockRejectedValue(new Error('Chunk unavailable'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const removed = vi.spyOn(window, 'removeEventListener')
    await initSentry({ config: {} }, loadSdk)
    expect(removed.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(['error', 'unhandledrejection']),
    )
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
