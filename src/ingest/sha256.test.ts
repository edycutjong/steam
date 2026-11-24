import { describe, expect, it } from 'vitest'
import { sha256Hex } from './sha256.ts'

const enc = (s: string) => new TextEncoder().encode(s)

describe('sha256Hex', () => {
  it('matches the FIPS 180-4 vectors', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })
  it('hashes one million "a"', () => {
    expect(sha256Hex(new Uint8Array(1_000_000).fill(97))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0')
  })
  it('handles the padding boundaries (55, 56, 63, 64, 65 bytes)', () => {
    const known: Record<number, string> = {}
    for (const n of [55, 56, 63, 64, 65]) known[n] = sha256Hex(new Uint8Array(n).fill(0x61))
    expect(new Set(Object.values(known)).size).toBe(5)
  })
})
