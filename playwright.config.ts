import { defineConfig } from '@playwright/test'

// 4173 unless PW_PORT says otherwise: another project's preview server may already hold it on a shared machine.
const PORT = Number(process.env.PW_PORT ?? 4173)

// Production build served by `vite preview`. Software GL keeps frames reproducible without a GPU.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
