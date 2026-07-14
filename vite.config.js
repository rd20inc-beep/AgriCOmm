import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Emit a precache manifest of every built file so the service worker can cache
// the WHOLE app on first online load — then every route works offline without
// having to visit it first. Also stamps the SW with a build hash so the browser
// re-installs it (and re-precaches) on each deploy.
function precachePlugin() {
  let files = []
  return {
    name: 'rf-precache',
    apply: 'build',
    generateBundle(_options, bundle) { files = Object.keys(bundle) },
    closeBundle() {
      const outDir = resolve(process.cwd(), 'dist')
      const bundleUrls = files.map((f) => '/' + f)                 // index.html + assets/*
      const extraUrls = ['/', '/index.html', '/manifest.webmanifest', '/pwa-192.png', '/pwa-512.png', '/favicon.png']
      const version = createHash('sha256').update(files.slice().sort().join('|')).digest('hex').slice(0, 12)
      writeFileSync(resolve(outDir, 'precache.json'), JSON.stringify({ version, bundleUrls, extraUrls }))
      const swPath = resolve(outDir, 'sw.js')
      if (existsSync(swPath)) {
        writeFileSync(swPath, readFileSync(swPath, 'utf8').replace(/__BUILD__/g, version))
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), precachePlugin()],
})
