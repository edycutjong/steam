// Canonical JSON (R9.5): sorted keys, two-space indent, trailing newline. Pure, so the segment run id can be computed anywhere.

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k]
      if (x !== undefined) o[k] = sortKeys(x)
    }
    return o
  }
  return v
}

export function canonicalJson(v: unknown): string {
  return JSON.stringify(sortKeys(v), null, 2) + '\n'
}
