// 스키마(src/backend/data/schema.ts)를 고친 뒤 `npm run db:generate`로 변경 SQL을 src/backend/data/migrations에 만든다
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
    dialect: 'sqlite',
    schema: './src/backend/data/schema.ts',
    out: './src/backend/data/migrations'
})
