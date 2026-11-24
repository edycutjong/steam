import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// R2.6: every archive and licence host comes from bundle data; the source names none.
const walk = (d: string): string[] => readdirSync(d).flatMap((e) => { const p = join(d, e); return statSync(p).isDirectory() ? walk(p) : [p] })

describe('hosts named in src', () => {
  it('no non-test file under src/ names an https:// host (the ingest code, which runs at build time, is excepted)', () => {
    const hosts = walk('src')
      .filter((f) => /\.(ts|tsx|css)$/.test(f) && !/\.(test|fixture)\.|\/ingest\//.test(f))
      .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/https:\/\/([a-z0-9.-]+)/gi)].map((m) => `${f}: ${m[1]}`))
    expect(hosts).toEqual([])
  })
})
