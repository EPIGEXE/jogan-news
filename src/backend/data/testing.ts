// ============================================================================
// 테스트용 DB
//
// [역할]
// - 테스트마다 쓰고 버리는 메모리 DB를 열고 스키마를 적용해 제공
// - 저장소 · 서비스 테스트가 실제 SQLite에 대고 동작을 확인하는 용도 (제품 코드에서는 쓰지 않음)
// ============================================================================
import { resolve } from 'node:path'
import { applyMigrations, openDatabase, type AppDatabase } from './client'

/**
 * 스키마를 적용한 빈 메모리 DB 열기
 *
 * @returns {AppDatabase} 테스트가 끝나면 버려지는 DB 연결
 */
export function openTestDatabase(): AppDatabase {
    const database = openDatabase(':memory:')
    applyMigrations(database, resolve('src/backend/data/migrations'))
    return database
}
