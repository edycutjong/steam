// R30.8: a change to the property definitions must bump PROPS_VERSION. When props.ts changes, this test fails until the
// recorded hash is updated together with a decision: bump PROPS_VERSION (definitions changed) or not (comments only).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PROPS_VERSION } from './props.ts'

const RECORDED = { version: '1', sha256: 'dd42696f6f63a6f4145cbd2f5fab6a22b210e11e7f05f76fa4dd1822e0017e03' }

describe('PROPS_VERSION (R30.8)', () => {
  it('props.ts is the file recorded for this version', () => {
    const h = createHash('sha256').update(readFileSync(new URL('./props.ts', import.meta.url))).digest('hex')
    expect(PROPS_VERSION).toBe(RECORDED.version)
    expect(h, 'props.ts changed: bump PROPS_VERSION if a definition changed, then record the new hash').toBe(RECORDED.sha256)
  })
})
