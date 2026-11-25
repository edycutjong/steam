// Captures the eight renderer evidence frames (desktop and phone, t = -600, 2000, 4000, 6500) from a running `vite preview`.
//   node scripts/capture-renderer-frames.ts <baseUrl> <outDir>
import path from 'node:path'
import { captureFrame } from '../e2e/helpers/capture.ts'
import { FRAMES } from '../e2e/helpers/frames.ts'

const base = process.argv[2] ?? 'http://localhost:4318'
const out = path.resolve(process.argv[3] ?? 'docs/kiro-evidence/renderer-v1/after')
for (const { name, t, viewport } of FRAMES) {
  await captureFrame(base, t, viewport, path.join(out, `${name}.png`))
  console.log('wrote', name)
}
