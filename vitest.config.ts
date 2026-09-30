import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({ plugins: [react()], test: {
  environment: 'jsdom', exclude: ['e2e/**', 'server/**', 'dist-server/**', 'node_modules/**'],
  setupFiles: ['./src/test/setup.ts'],
  coverage: { provider: 'v8', reporter: ['text', 'html'], reportsDirectory: 'coverage',
    include: ['src/production-order/policy.ts'],
    thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 } },
} })
