import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'pkg-playground': resolve(projectRoot, '../pkg-playground/src'),
      'baml-runtime-wasm': resolve(projectRoot, '../pkg-playground/wasm/baml_runtime_wasm.js'),
    },
  },
  test: {
    name: 'hmr',
    globals: true,
    include: ['src/**/*.hmr.test.ts'],
    testTimeout: 120_000,  // 2 minutes for WASM rebuilds
    hookTimeout: 60_000,   // 1 minute for setup/teardown
    // Run sequentially - these tests modify shared state (Rust source files)
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Retry once in case of flaky timing
    retry: 1,
  },
})
