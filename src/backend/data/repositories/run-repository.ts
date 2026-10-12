// ============================================================================
// 실행 기록 저장소
//
// [역할]
// - 브리핑 생성 실행 기록(runs)을 읽고 씀 (Worker가 쓰는 테이블)
// - 실행 시작('running') · 마무리('ok' 또는 'error') 기록, 성공한 마지막 실행의 시작 시각 조회
// - 끝나지 못하고 'running'으로 남은 실행을 실패로 바꾸는 쓰기 제공 (언제 정리할지 · 실패 이유 문구는 서비스)
// - 시작 · 끝난 시각은 이 저장소가 지금 시각으로 채움
// ============================================================================
import { and, desc, eq, lt } from 'drizzle-orm'
import { nowIso, type AppDatabase } from '../client'
import { runs } from '../schema'

export type RunRow = typeof runs.$inferSelect // runs 테이블의 한 행

export type FinishedRunStatus = 'ok' | 'error' // 끝난 실행의 상태 (ok: 브리핑 게시까지 성공, error: 실패)

export interface RunRepository {
    insertRun(reason: string, sinceIso: string): number // 'running' 상태의 실행 기록 생성 (sinceIso: 이번 수집 구간의 시작) → 실행 번호
    // 실행 마무리: 끝난 시각(지금) · 상태 · 통계 · 실패 이유 저장 (통계 · 실패 이유는 없으면 null)
    updateRunFinished(runId: number, status: FinishedRunStatus, runStats: unknown, errorMessage?: string): void
    findLastSuccessfulRunStartedAt(beforeIso: string): string | null // beforeIso보다 먼저 시작해 성공한 실행 중 가장 늦은 것의 시작 시각 (없으면 null)
    updateRunningRunsFailed(errorMessage: string): number // 'running'으로 남은 실행을 모두 'error'로 바꾸고 끝난 시각을 지금으로 → 바꾼 개수
}

/**
 * 실행 기록 저장소 생성
 *
 * @param {AppDatabase} database - DB 연결
 * @returns {RunRepository} 실행 기록 저장소
 */
export function createRunRepository(database: AppDatabase): RunRepository {
    return {
        insertRun(reason, sinceIso) {
            return database
                .insert(runs)
                .values({ reason, startedAt: nowIso(), status: 'running', since: sinceIso })
                .returning({ id: runs.id })
                .get().id
        },

        updateRunFinished(runId, status, runStats, errorMessage) {
            database
                .update(runs)
                .set({
                    finishedAt: nowIso(),
                    status,
                    // 실행 통계는 브리핑 수치에 토큰 수가 붙거나(성공) 토큰 수만 있어(실패) 컬럼 타입과 모양이 다름
                    stats: (runStats ?? null) as RunRow['stats'],
                    error: errorMessage ?? null
                })
                .where(eq(runs.id, runId))
                .run()
        },

        findLastSuccessfulRunStartedAt(beforeIso) {
            return (
                database
                    .select({ startedAt: runs.startedAt })
                    .from(runs)
                    .where(and(eq(runs.status, 'ok'), lt(runs.startedAt, beforeIso)))
                    .orderBy(desc(runs.startedAt))
                    .limit(1)
                    .get()?.startedAt ?? null
            )
        },

        updateRunningRunsFailed(errorMessage) {
            return database
                .update(runs)
                .set({ status: 'error', error: errorMessage, finishedAt: nowIso() })
                .where(eq(runs.status, 'running'))
                .run().changes
        }
    }
}
