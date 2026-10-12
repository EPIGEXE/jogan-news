// ============================================================================
// LLM 사용량 저장소 테스트
//
// [역할]
// - 메모리 DB에 실제 쿼리를 돌려 사용량 기록과 비용 집계 확인
// - 기록이 없을 때의 0, 구간 시작 시각의 포함 여부, 실행별 · 용도별 합계와 정렬
// ============================================================================
import { describe, expect, it } from 'vitest'
import type { AppDatabase } from '../client'
import { llmUsage } from '../schema'
import { openTestDatabase } from '../testing'
import { createLlmUsageRepository } from './llm-usage-repository'

// 기록 시각을 정해 둔 사용량 한 건을 직접 넣음
function insertUsageAt(database: AppDatabase, at: string, role: string, costUsd: number, runId: number | null = null): void {
    database
        .insert(llmUsage)
        .values({
            at,
            runId,
            role,
            model: 'test-model',
            inputTokens: 0,
            cachedTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            latencyMs: 0,
            costUsd
        })
        .run()
}

describe('llm-usage-repository', () => {
    it('기록이 없으면 합계는 0, 용도별 목록은 비어 있다', () => {
        const llmUsageRepository = createLlmUsageRepository(openTestDatabase())
        expect(llmUsageRepository.sumCostSince('2026-10-01T00:00:00.000Z')).toBe(0)
        expect(llmUsageRepository.sumCostForRun(1)).toBe(0)
        expect(llmUsageRepository.sumCostTotal()).toBe(0)
        expect(llmUsageRepository.listCostByRole(null)).toEqual([])
    })

    it('호출 한 번의 토큰 수 · 걸린 시간 · 비용을 지금 시각으로 기록한다', () => {
        const database = openTestDatabase()
        const llmUsageRepository = createLlmUsageRepository(database)
        llmUsageRepository.insertUsage({
            runId: 7,
            role: 'summarize',
            model: 'test-model',
            usage: { input: 1000, cachedInput: 400, output: 200, reasoning: 50 },
            latencyMs: 1234,
            costUsd: 0.0125
        })
        llmUsageRepository.insertUsage({
            runId: null,
            role: 'translate',
            model: 'test-model',
            usage: { input: 1, cachedInput: 0, output: 1, reasoning: 0 },
            latencyMs: 10,
            costUsd: 0.001
        })

        const [summarizeRow, translateRow] = database.select().from(llmUsage).orderBy(llmUsage.id).all()
        expect(summarizeRow).toMatchObject({
            runId: 7,
            role: 'summarize',
            model: 'test-model',
            inputTokens: 1000,
            cachedTokens: 400,
            outputTokens: 200,
            reasoningTokens: 50,
            latencyMs: 1234,
            costUsd: 0.0125
        })
        expect(summarizeRow!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        expect(translateRow!.runId).toBeNull()
        expect(llmUsageRepository.sumCostForRun(7)).toBe(0.0125)
    })

    it('시각 이후 합계: 시작 시각과 같은 기록은 넣고 그보다 이른 기록은 뺀다', () => {
        const database = openTestDatabase()
        const llmUsageRepository = createLlmUsageRepository(database)
        insertUsageAt(database, '2026-09-30T23:59:59.999Z', 'triage', 1)
        insertUsageAt(database, '2026-10-01T00:00:00.000Z', 'triage', 0.25)
        insertUsageAt(database, '2026-10-02T00:00:00.000Z', 'summarize', 0.5)

        expect(llmUsageRepository.sumCostSince('2026-10-01T00:00:00.000Z')).toBe(0.75)
        expect(llmUsageRepository.sumCostSince('2026-10-03T00:00:00.000Z')).toBe(0)
        expect(llmUsageRepository.sumCostTotal()).toBe(1.75)
    })

    it('실행별 합계: 그 실행의 호출만 더하고 실행 밖의 호출은 뺀다', () => {
        const database = openTestDatabase()
        const llmUsageRepository = createLlmUsageRepository(database)
        insertUsageAt(database, '2026-10-01T00:00:00.000Z', 'triage', 0.25, 1)
        insertUsageAt(database, '2026-10-01T00:01:00.000Z', 'summarize', 0.5, 1)
        insertUsageAt(database, '2026-10-01T00:02:00.000Z', 'summarize', 2, 2)
        insertUsageAt(database, '2026-10-01T00:03:00.000Z', 'translate', 4, null)

        expect(llmUsageRepository.sumCostForRun(1)).toBe(0.75)
        expect(llmUsageRepository.sumCostForRun(2)).toBe(2)
        expect(llmUsageRepository.sumCostForRun(3)).toBe(0)
    })

    it('용도별 합계: 비용이 큰 용도부터, 기간을 주면 그 안의 기록만 더한다', () => {
        const database = openTestDatabase()
        const llmUsageRepository = createLlmUsageRepository(database)
        insertUsageAt(database, '2026-09-01T00:00:00.000Z', 'triage', 8)
        insertUsageAt(database, '2026-10-01T00:00:00.000Z', 'triage', 0.25)
        insertUsageAt(database, '2026-10-02T00:00:00.000Z', 'summarize', 0.5)
        insertUsageAt(database, '2026-10-03T00:00:00.000Z', 'summarize', 0.5)

        expect(llmUsageRepository.listCostByRole(null)).toEqual([
            { role: 'triage', usd: 8.25 },
            { role: 'summarize', usd: 1 }
        ])
        expect(llmUsageRepository.listCostByRole('2026-10-01T00:00:00.000Z')).toEqual([
            { role: 'summarize', usd: 1 },
            { role: 'triage', usd: 0.25 }
        ])
        expect(llmUsageRepository.listCostByRole('2026-11-01T00:00:00.000Z')).toEqual([])
    })
})
