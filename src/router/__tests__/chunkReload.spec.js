import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { RELOAD_KEY } from '../../lib/staleChunkReload'
import {
  installRouterChunkReload,
  isChunkLoadError,
  lazyComponent,
  reloadForStaleChunk,
} from '../chunkReload'

function makeStorage(initial = {}) {
  const data = { ...initial }
  return {
    getItem: vi.fn((key) => data[key] ?? null),
    setItem: vi.fn((key, value) => {
      data[key] = String(value)
    }),
  }
}

const staleChunk = () => new TypeError('Failed to fetch dynamically imported module: /x.js')

describe('isChunkLoadError', () => {
  it('recognises each browser’s failed dynamic import', () => {
    expect(isChunkLoadError(staleChunk())).toBe(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /a.css'))).toBe(true)
  })

  it('ignores other errors', () => {
    expect(isChunkLoadError(new Error('Network down'))).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
  })
})

describe('reloadForStaleChunk', () => {
  it('reloads once, then holds off within the cooldown', () => {
    const storage = makeStorage()
    const navigate = vi.fn()

    expect(reloadForStaleChunk('/tasks', { storage, navigate, now: 1_000_000 })).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/tasks')
    expect(storage.setItem).toHaveBeenCalledWith(RELOAD_KEY, '1000000')

    expect(reloadForStaleChunk('/tasks', { storage, navigate, now: 1_010_000 })).toBe(false)
    expect(navigate).toHaveBeenCalledTimes(1)

    expect(reloadForStaleChunk('/tasks', { storage, navigate, now: 1_040_000 })).toBe(true)
    expect(navigate).toHaveBeenCalledTimes(2)
  })

  it('still reloads when storage is blocked', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked')
      },
    }
    const navigate = vi.fn()

    expect(reloadForStaleChunk('/', { storage, navigate })).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/')
  })
})

describe('installRouterChunkReload', () => {
  function routerWith(component) {
    return createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { render: () => null } },
        { path: '/tasks', component },
      ],
    })
  }

  it('reloads onto the route being opened when its chunk fails to load', async () => {
    const router = routerWith(() => Promise.reject(staleChunk()))
    const navigate = vi.fn()
    installRouterChunkReload(router, { storage: makeStorage(), navigate })
    await router.push('/')

    await router.push('/tasks?project=p1').catch(() => {})

    expect(navigate).toHaveBeenCalledWith('/tasks?project=p1')
  })

  it('leaves other navigation errors alone', async () => {
    const router = routerWith(() => Promise.reject(new Error('Boom')))
    const navigate = vi.fn()
    installRouterChunkReload(router, { storage: makeStorage(), navigate })
    await router.push('/')

    await router.push('/tasks').catch(() => {})

    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('lazyComponent', () => {
  const Loaded = { render: () => h('p', { class: 'loaded' }, 'Loaded') }

  it('retries a failed chunk once before giving up on it', async () => {
    const loader = vi.fn().mockRejectedValueOnce(staleChunk()).mockResolvedValue(Loaded)
    const navigate = vi.fn()
    const wrapper = mount(lazyComponent(loader, { storage: makeStorage(), navigate }))
    await flushPromises()

    expect(loader).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.loaded').exists()).toBe(true)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('reloads when the retry fails too', async () => {
    const loader = vi.fn().mockRejectedValue(staleChunk())
    const navigate = vi.fn()
    mount(lazyComponent(loader, { storage: makeStorage(), navigate }))
    await flushPromises()

    expect(loader).toHaveBeenCalledTimes(2)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('renders nothing instead of looping when a reload already happened', async () => {
    const loader = vi.fn().mockRejectedValue(staleChunk())
    const navigate = vi.fn()
    const storage = makeStorage({ [RELOAD_KEY]: String(Date.now()) })
    const errorHandler = vi.fn()
    const wrapper = mount(lazyComponent(loader, { storage, navigate }), {
      global: { config: { errorHandler } },
    })
    await flushPromises()

    expect(navigate).not.toHaveBeenCalled()
    expect(wrapper.find('.loaded').exists()).toBe(false)
    expect(errorHandler).toHaveBeenCalled()
  })
})
