// ============================================================================
// DB 연결
//
// [역할]
// - SQLite 파일을 열고 Drizzle로 감싼 연결 제공 (드라이버: better-sqlite3, 동기 방식)
// - 연결 설정: WAL 모드 · 외래 키 사용 · 잠금 대기 5초
// - Main과 Worker가 각자 연결을 하나씩 열어 같은 파일을 사용
// - WAL이라 한쪽이 쓰는 동안에도 다른 쪽이 읽을 수 있고, 동시에 쓰려 하면 잠금 대기 시간만큼 기다림
// - 스키마 변경 적용(마이그레이션)은 Main만 실행 (Worker를 띄우기 전에 끝냄)
// - 저장소가 쓰는 공용 도우미 제공 (지금 시각, 트랜잭션)
// ============================================================================
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type AppDatabase = BetterSQLite3Database<typeof schema> & { $client: Database.Database } // 저장소가 받는 DB 연결

const LOCK_WAIT_MS = 5000 // 다른 프로세스가 쓰는 중일 때 기다리는 시간

/**
 * DB 열기
 *
 * @param {string} dbFilePath - DB 파일 경로 (테스트는 ':memory:')
 * @returns {AppDatabase} 연결 설정을 마친 DB 연결
 */
export function openDatabase(dbFilePath: string): AppDatabase {
    // 파일이 들어갈 폴더가 없으면 생성 (메모리 DB는 해당 없음)
    if (dbFilePath !== ':memory:') mkdirSync(dirname(dbFilePath), { recursive: true })

    const sqlite = new Database(dbFilePath)
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma(`busy_timeout = ${LOCK_WAIT_MS}`)

    return drizzle(sqlite, { schema })
}

/**
 * 아직 적용하지 않은 스키마 변경 적용
 *
 * - Main이 시작할 때 한 번 호출 (Worker는 호출하지 않음)
 *
 * @param {AppDatabase} database - DB 연결
 * @param {string} migrationsDir - 변경 SQL이 들어 있는 폴더 (src/backend/data/migrations, 설치판은 resources/migrations)
 */
export function applyMigrations(database: AppDatabase, migrationsDir: string): void {
    migrate(database, { migrationsFolder: migrationsDir })
}

/**
 * DB 닫기
 *
 * @param {AppDatabase} database - DB 연결
 */
export function closeDatabase(database: AppDatabase): void {
    database.$client.close()
}

/**
 * 여러 쓰기를 한 묶음으로 실행 (중간에 실패하면 모두 되돌림)
 *
 * - 같은 연결로 실행하는 저장소 호출은 모두 이 묶음에 포함
 * - 동기 함수만 받음 (묶음 안에서 네트워크 · LLM을 기다릴 수 없어, 잠금을 오래 쥐는 일이 없음)
 *
 * @param {AppDatabase} database - DB 연결
 * @param {() => T} transactionBody - 묶어서 실행할 일
 * @returns {T} transactionBody의 결과
 */
export function runInTransaction<T>(database: AppDatabase, transactionBody: () => T): T {
    return database.transaction(() => transactionBody())
}

/**
 * 지금 시각
 *
 * @returns {string} ISO 문자열 (DB에 저장하는 시각의 형식)
 */
export function nowIso(): string {
    return new Date().toISOString()
}
