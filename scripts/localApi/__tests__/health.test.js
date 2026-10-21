import { describe, expect, it, vi } from 'vitest'
import { responseRecorder } from '../../../api/__tests__/sendTestResponse.js'
import { localApiPlugin } from '../plugin.js'

describe('local health routing', () => {
  it.each(['configureServer', 'configurePreviewServer'])(
    'mounts the real health handler in %s without fixtures',
    async (hook) => {
      const middleware = []
      localApiPlugin('e2e')[hook]({ middlewares: { use: (...args) => middleware.push(args) } })
      const route = middleware[0][0]
      const res = responseRecorder()
      const next = vi.fn()
      // An unsupported method exercises the real handler without probing live services.
      await route({ url: '/api/health?monitor=1', method: 'POST' }, res, next)
      expect(res.statusCode).toBe(405)
      expect(res.headers.Allow).toBe('GET, HEAD')
      expect(res.headers['Cache-Control']).toBe('no-store')
      expect(next).not.toHaveBeenCalled()
      await route({ url: '/api/health/other' }, res, next)
      expect(next).toHaveBeenCalledOnce()
    },
  )
})
