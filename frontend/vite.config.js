import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the site from /<repo-name>/. The deploy workflow sets
  // BASE_PATH; local dev leaves it unset and uses the root.
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
})
