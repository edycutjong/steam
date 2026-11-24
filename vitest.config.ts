import { defineConfig } from 'vitest/config'

// Unit and property tests only. Playwright specs in e2e/ run through `npm run e2e`.
export default defineConfig({
  // The ingest property tests take 5 to 9 s on a busy machine; the 5 s default made them flake (observed under load average 30).
  test: { include: ['src/**/*.test.{ts,tsx}', 'tools/**/*.test.ts'], testTimeout: 30_000 },
})
