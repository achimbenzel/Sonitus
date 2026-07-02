import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative asset paths so the built app also loads from file://
  // inside Electron. Harmless for the normal web/dev server build.
  base: './',
  plugins: [react()],
  worker: {
    format: 'es',
  },
})
