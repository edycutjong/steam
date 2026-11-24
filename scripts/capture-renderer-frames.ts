// Captures the six renderer-v0 evidence frames from a running `vite preview`.
//   node scripts/capture-renderer-frames.ts <baseUrl> <outDir>
import path from 'node:path'
import { DESKTOP, PIXEL5, captureFrame } from '../e2e/helpers/capture.ts'

const base = process.argv[2] ?? 'http://localhost:4318'
const out = path.resolve(process.argv[3] ?? 'docs/kiro-evidence/renderer-v0/after')
const frames = [
  ['desktop-t-600', -600, DESKTOP],
  ['desktop-t2000', 2000, DESKTOP],
  ['desktop-t4000', 4000, DESKTOP],
  ['desktop-t6500', 6500, DESKTOP],
  ['mobile-t2000', 2000, PIXEL5],
  ['mobile-t6500', 6500, PIXEL5],
] as const
for (const [name, t, vp] of frames) {
  await captureFrame(base, t, vp, path.join(out, `${name}.png`))
  console.log('wrote', name)
}
