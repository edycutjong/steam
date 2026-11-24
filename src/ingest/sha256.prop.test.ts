// S1: for all byte arrays, the pure SHA-256 equals node:crypto (test files may import it).
import { createHash } from 'node:crypto'
import fc from 'fast-check'
import { describe, it } from 'vitest'
import { sha256Hex } from './sha256.ts'

describe('S1 sha256 equals node:crypto', () => {
  it('for all byte arrays up to 4 KB', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 4096 }), (bytes) => {
        return sha256Hex(bytes) === createHash('sha256').update(bytes).digest('hex')
      }),
      { numRuns: 300 },
    )
  })
})
