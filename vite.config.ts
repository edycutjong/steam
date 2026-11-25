import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import offlineShell from './tools/offline/vite-plugin.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), offlineShell()],
})
