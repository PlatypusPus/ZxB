import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev only. Never run `vite dev` on the VPS (CVE-2026-39363); prod serves the built dist/.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8010', ws: true }, '/media': 'http://127.0.0.1:8010' } },
})
