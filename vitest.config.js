import { defineConfig } from 'vitest/config'

// Standalone Vitest config (does not load the app's build-time vite.config so the
// precache plugin never runs in tests). Node environment; the offline modules are
// plain JS and use an in-memory IndexedDB shim from the setup file.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
    setupFiles: ['./src/test/setup.js'],
  },
})
