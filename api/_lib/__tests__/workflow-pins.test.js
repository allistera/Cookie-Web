import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

const workflowsDirectory = path.resolve(process.cwd(), '.github/workflows')

describe('GitHub Actions supply-chain policy', () => {
  it('pins every external action to an immutable full commit SHA', async () => {
    const workflowNames = (await readdir(workflowsDirectory)).filter((name) =>
      name.endsWith('.yml'),
    )

    for (const workflowName of workflowNames) {
      const workflow = await readFile(path.join(workflowsDirectory, workflowName), 'utf8')
      const references = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)]

      for (const [, reference] of references) {
        const separator = reference.lastIndexOf('@')
        expect(separator, `${workflowName}: ${reference} has no ref`).toBeGreaterThan(0)
        expect(reference.slice(separator + 1), `${workflowName}: ${reference}`).toMatch(
          /^[0-9a-f]{40}$/,
        )
      }
    }
  })
})
