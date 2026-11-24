import { defineConfig } from 'vitest/config'

// Unit and property tests only. Playwright specs in e2e/ run through `npm run e2e`.
export default defineConfig({
  test: { include: ['src/**/*.test.{ts,tsx}'] },
})
