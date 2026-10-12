import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared'), '@data': resolve('src/backend/data'), '@config': resolve('src/backend/config'), '@domain': resolve('src/backend/domain'), '@': resolve('src/renderer/src') } },
  test: { include: ['src/**/*.test.ts'] }
})
