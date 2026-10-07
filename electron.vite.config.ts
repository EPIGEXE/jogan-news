import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    // Worker(utilityProcess)는 Main과 같은 빌드에서 별도 진입점으로 묶는다 → out/main/worker.js
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), worker: resolve('src/worker/index.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    // sandbox: true인 preload는 CommonJS여야 한다.
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  }
})
