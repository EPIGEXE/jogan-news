import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // @data = Main과 Worker가 같이 쓰는 DB 계층 (스키마 · 저장소), @config = 설정 파일(YAML · 프롬프트) 읽기, @domain = 두 프로세스가 같이 쓰는 업무 규칙
    resolve: { alias: { '@shared': resolve('src/shared'), '@data': resolve('src/backend/data'), '@config': resolve('src/backend/config'), '@domain': resolve('src/backend/domain') } },
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
    // @/ = 화면 코드 루트 (app · screens · domains · common)
    resolve: { alias: { '@shared': resolve('src/shared'), '@': resolve('src/renderer/src') } }
  }
})
