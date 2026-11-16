import { Buffer } from 'node:buffer'

// Count each statically imported chunk once, including shared chunks and
// cycles. Dynamic imports have their own feature budgets.
export function staticGraphBytes(bundle, fileName, visited = new Set()) {
  if (visited.has(fileName)) return 0
  const chunk = bundle[fileName]
  if (!chunk || chunk.type !== 'chunk') return 0
  visited.add(fileName)
  return (
    Buffer.byteLength(chunk.code) +
    chunk.imports.reduce(
      (bytes, dependency) => bytes + staticGraphBytes(bundle, dependency, visited),
      0,
    )
  )
}

export function bundleBudgetPlugin() {
  return {
    name: 'bundle-budgets',
    generateBundle(_, bundle) {
      const measurements = []
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        const id = (chunk.facadeModuleId ?? '').split('?')[0]
        // The entry carries the inbox store and, with it, the offline cache,
        // outbox and connectivity modules (about 8 KB) added in October 2026
        // when main sat 2 KB under the previous 500 KB. The Auth0 SPA SDK
        // (statically imported by @auth0/auth0-vue) grew by 8.6 KB between
        // auth0-vue 2.11 and 2.13, taking the entry from 516 KB past 520 KB
        // with no change on the app side. By November 2026 Vercel's build of
        // main sat about 190 bytes under 530 KB, and the Paper Trail sidebar
        // item (about 340 bytes of always-visible chrome) took it 146 over,
        // so both budgets that carry the entry moved up by 1 KB. The window
        // dock (tabs for several open messages and emails) added 1.7 KB to
        // the inbox store: parking a message has to be there, because an
        // undone send or an opened draft can displace the composer from
        // anywhere. That put Vercel's build about 0.9 KB over, so the entry
        // moved up by 2 KB.
        const budget = chunk.isEntry
          ? 533_000
          : // The inbox view statically imports the entry, so it carries the
            // same Auth0 growth: 646 KB plain, about 654 KB with Vercel's
            // Sentry debug IDs. With the window dock's share of the entry and
            // the reader's own minimise control it reached 662.5 KB, 1.5 KB
            // over, and moved up by 3 KB. The Feed's blog of open posts is
            // a lazy chunk of its own, but the view's share of it (the
            // branch that swaps the list for it, the shared image rule and
            // the keys it leaves to scrolling) is 0.9 KB, which put Vercel's
            // build about 0.3 KB over, so the view moved up by 2 KB.
            id.endsWith('/views/TraditionalInboxView.vue')
            ? 666_000
            : id.endsWith('/components/DocumentEditor.vue') || chunk.name === 'DocumentEditor'
              ? 1_000_000
              : chunk.name === 'facade' &&
                  chunk.moduleIds?.some((module) => module.includes('/@univerjs/'))
                ? 6_000_000
                : null
        if (budget === null) continue
        const bytes = staticGraphBytes(bundle, chunk.fileName)
        measurements.push({ file: chunk.fileName, bytes, budget })
        if (bytes > budget) {
          this.error(
            `${chunk.fileName} and its static imports total ${bytes} bytes, over the ${budget}-byte budget.`,
          )
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: 'bundle-budgets.json',
        source: JSON.stringify(measurements, null, 2),
      })
    },
  }
}
