import { defineConfig } from 'vite'

export default defineConfig({ build: {
  ssr: 'server/index.ts', outDir: 'dist-server', target: 'node20', emptyOutDir: true,
  rollupOptions: { output: { entryFileNames: 'index.js' } },
} })
