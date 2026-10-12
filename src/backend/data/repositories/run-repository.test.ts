// ============================================================================
// 실행 기록 저장소 테스트
//
// [역할]
// - 메모리 DB에 실제 쿼리를 돌려 실행 기록의 시작 · 마무리 · 조회 확인
// - 성공한 마지막 실행 조회의 조건(성공만, 기준 시각보다 먼저)과 'running'으로 남은 실행의 정리
// ============================================================================
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { AppDatabase } from '../client'
import { runs } from '../schema'
import { openTestDatabase } from '../testing'
import { createRunRepository } from './run-repository'

// 실행 기록 한 행을 그대로 읽음
const readRun = (database: AppDatabase, runId: number) => database.select().from(runs).where(eq(runs.id, runId)).get()!

describe('run-repository', () => {
    it('실행을 시작하면 running 상태로 저장하고 번호를 돌려준다', () => {
        const database = openTestDatabase()
        const runRepository = createRunRepository(database)
        const firstRunId = runRepository.insertRun('schedule', '2026-10-06T00:00:00.000Z')
        const secondRunId = runRepository.insertRun('manual', '2026-10-07T00:00:00.000Z')

        expect(secondRunId).not.toBe(firstRunId)
        const runRow = readRun(database, firstRunId)
        expect(runRow).toMatchObject({
            reason: 'schedule',
            status: 'running',
            since: '2026-10-06T00:00:00.000Z',
            finishedAt: null,
            error: null,
            stats: null
        })
        expect(runRow.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('성공으로 마무리하면 끝난 시각 · 상태 · 통계를 저장하고 실패 이유는 비운다', () => {
        const database = openTestDatabase()
        const runRepository = createRunRepository(database)
        const runId = runRepository.insertRun('schedule', '2026-10-06T00:00:00.000Z')
        runRepository.updateRunFinished(runId, 'ok', { selected: 12, tokens: 3400 })

        const runRow = readRun(database, runId)
        expect(runRow).toMatchObject({ status: 'ok', error: null, stats: { selected: 12, tokens: 3400 } })
        expect(runRow.finishedAt).not.toBeNull()
    })

    it('실패로 마무리하면 실패 이유를 저장하고, 통계가 없으면 null로 둔다', () => {
        const database = openTestDatabase()
        const runRepository = createRunRepository(database)
        const runId = runRepository.insertRun('schedule', '2026-10-06T00:00:00.000Z')
        runRepository.updateRunFinished(runId, 'error', undefined, '네트워크 끊김')
        expect(readRun(database, runId)).toMatchObject({ status: 'error', error: '네트워크 끊김', stats: null })
    })

    it('성공한 마지막 실행: 기준 시각보다 먼저 시작한 성공 실행 중 가장 늦은 것, 없으면 null', () => {
        const database = openTestDatabase()
        const runRepository = createRunRepository(database)
        expect(runRepository.findLastSuccessfulRunStartedAt('2026-10-08T00:00:00.000Z')).toBeNull()

        // 시작 시각을 정해 둔 실행 넣기 (성공 둘 · 실패 하나 · 진행 중 하나)
        const insertRunAt = (startedAt: string, status: 'running' | 'ok' | 'error') =>
            database.insert(runs).values({ reason: 'schedule', startedAt, status, since: startedAt }).run()
        insertRunAt('2026-10-05T09:00:00.000Z', 'ok')
        insertRunAt('2026-10-06T09:00:00.000Z', 'ok')
        insertRunAt('2026-10-07T09:00:00.000Z', 'error')
        insertRunAt('2026-10-07T10:00:00.000Z', 'running')

        expect(runRepository.findLastSuccessfulRunStartedAt('2026-10-08T00:00:00.000Z')).toBe('2026-10-06T09:00:00.000Z')
        // 기준 시각과 같은 시각에 시작한 실행은 빠짐
        expect(runRepository.findLastSuccessfulRunStartedAt('2026-10-06T09:00:00.000Z')).toBe('2026-10-05T09:00:00.000Z')
        expect(runRepository.findLastSuccessfulRunStartedAt('2026-10-05T09:00:00.000Z')).toBeNull()
    })

    it('running으로 남은 실행만 실패로 바꾸고 바꾼 개수를 돌려준다', () => {
        const database = openTestDatabase()
        const runRepository = createRunRepository(database)
        const finishedRunId = runRepository.insertRun('schedule', '2026-10-06T00:00:00.000Z')
        runRepository.updateRunFinished(finishedRunId, 'ok', null)
        const staleRunId = runRepository.insertRun('schedule', '2026-10-07T00:00:00.000Z')

        expect(runRepository.updateRunningRunsFailed('앱 종료로 중단됨')).toBe(1)
        const staleRunRow = readRun(database, staleRunId)
        expect(staleRunRow).toMatchObject({ status: 'error', error: '앱 종료로 중단됨' })
        expect(staleRunRow.finishedAt).not.toBeNull()
        expect(readRun(database, finishedRunId)).toMatchObject({ status: 'ok', error: null })
        expect(runRepository.updateRunningRunsFailed('앱 종료로 중단됨')).toBe(0)
    })
})
