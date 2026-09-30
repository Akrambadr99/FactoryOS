import { defineConfig } from 'vite'

export default defineConfig({ build: {
  ssr: true, outDir: 'dist-server', target: 'node24', emptyOutDir: true,
  rollupOptions: { input: { index: 'server/index.ts', reservationMigrationCli: 'server/reservationMigrationCli.ts' },
    external: ['better-sqlite3'], output: { entryFileNames: '[name].js' } },
} })
