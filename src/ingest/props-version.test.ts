// R30.8: a change to the property definitions must bump PROPS_VERSION. When props.ts changes, this test fails until the
// recorded hash is updated together with a decision: bump PROPS_VERSION (definitions changed) or not (comments only).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PROPS_VERSION } from './props.ts'

const RECORDED = { version: '2', sha256: 'fac6ade768aa951965d39496794f05b3ff632bf2b7f2b50eddfb1bce6f99da49' }

describe('PROPS_VERSION (R30.8)', () => {
  it('props.ts is the file recorded for this version', () => {
    const h = createHash('sha256').update(readFileSync(new URL('./props.ts', import.meta.url))).digest('hex')
    expect(PROPS_VERSION).toBe(RECORDED.version)
    expect(h, 'props.ts changed: bump PROPS_VERSION if a definition changed, then record the new hash').toBe(RECORDED.sha256)
  })
})
