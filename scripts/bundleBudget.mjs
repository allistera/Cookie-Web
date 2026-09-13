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
        const budget = chunk.isEntry
          ? 500_000
          : id.endsWith('/views/TraditionalInboxView.vue')
            ? 650_000
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
