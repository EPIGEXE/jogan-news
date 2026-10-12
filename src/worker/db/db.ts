// ============================================================================
// DB 연결
//
// [역할]
// - SQLite 파일을 열고 아직 적용하지 않은 마이그레이션을 앞에서부터 차례로 적용
// - Node 내장 SQLite(node:sqlite) 사용 (네이티브 모듈 빌드가 필요 없고 FTS5도 들어 있음)
// - 연결 설정: WAL 모드, 외래 키 사용, 잠금 대기 5초
// - 여러 변경을 하나로 묶는 트랜잭션 도우미 제공 (중간에 실패하면 모두 되돌림)
// ============================================================================
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './schema'

export type Db = DatabaseSync // DB 연결

/**
 * DB 열기
 * - 파일이 들어갈 폴더가 없으면 생성
 * - 연 뒤 마이그레이션을 최신 버전까지 적용
 *
 * @param {string} dbFilePath - DB 파일 경로 (':memory:'면 파일 없이 메모리에만 만듦)
 * @returns {Db} 열린 DB 연결
 */
export function openDb(dbFilePath: string): Db {
    // 파일로 여는 경우 폴더부터 준비 (메모리 DB는 폴더가 필요 없음)
    if (dbFilePath !== ':memory:') mkdirSync(dirname(dbFilePath), { recursive: true })

    // 연결 후 설정: WAL 모드, 외래 키 사용, 잠금 대기 5000ms
    const db = new DatabaseSync(dbFilePath)
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

    // 스키마를 최신 버전으로
    migrate(db)
    return db
}

// 아직 적용하지 않은 마이그레이션을 앞에서부터 차례로 적용
// 마이그레이션 하나와 버전 올리기를 한 트랜잭션으로 묶어, 실패하면 그 마이그레이션만 되돌리고 오류를 그대로 던짐
function migrate(db: Db): void {
    // 지금까지 적용한 개수 (PRAGMA user_version, 새 DB는 0)
    const versionRow = db.prepare('PRAGMA user_version').get() as { user_version: number }

    for (let migrationIndex = versionRow.user_version; migrationIndex < MIGRATIONS.length; migrationIndex++) {
        db.exec('BEGIN')
        try {
            // 마이그레이션 실행 후 버전을 하나 올림
            db.exec(MIGRATIONS[migrationIndex]!)
            db.exec(`PRAGMA user_version = ${migrationIndex + 1}`)
            db.exec('COMMIT')
        } catch (migrationError) {
            // 실패 → 이 마이그레이션에서 바꾼 것을 되돌림
            db.exec('ROLLBACK')
            throw migrationError
        }
    }
}

/**
 * 여러 변경을 한 트랜잭션으로 실행
 * - 끝까지 성공하면 확정, 중간에 예외가 나면 모두 되돌리고 예외를 그대로 던짐
 * - 중첩해서 쓸 수 없음 (트랜잭션 안에서 다시 BEGIN을 실행하게 됨)
 *
 * @param {Db} db - DB 연결
 * @param {() => T} transactionBody - 트랜잭션 안에서 실행할 작업
 * @returns {T} 작업이 돌려준 값
 */
export function runInTransaction<T>(db: Db, transactionBody: () => T): T {
    db.exec('BEGIN')
    try {
        const transactionResult = transactionBody()
        db.exec('COMMIT')
        return transactionResult
    } catch (transactionError) {
        db.exec('ROLLBACK')
        throw transactionError
    }
}
