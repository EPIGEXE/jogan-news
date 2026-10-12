// ============================================================================
// LLM 사용량 저장소
//
// [역할]
// - LLM 호출 한 번의 사용량(llm_usage)을 기록하고 비용을 집계 (Worker가 쓰는 테이블)
// - 비용 합계: 지정한 시각 이후 · 실행 한 번 · 전체 기간, 용도(role)별
// - 기록이 없는 합계는 0으로 돌려줌
// - 예산 · 하루 한도 판단, 기간의 시작 시각 계산은 하지 않음 (서비스)
// ============================================================================
import { desc, eq, gte, sql } from 'drizzle-orm'
import type { TokenUsage } from '@config/pricing'
import { nowIso, type AppDatabase } from '../client'
import { llmUsage } from '../schema'

export type LlmUsageRow = typeof llmUsage.$inferSelect // llm_usage 테이블의 한 행

// 기록할 LLM 호출 한 번
export interface LlmCallUsage {
    runId: number | null // 그 호출이 속한 브리핑 실행 번호 (실행 밖의 호출이면 null)
    role: string // 호출 용도 (선별 · 요약 · 번역 등)
    model: string // 모델 이름
    usage: TokenUsage // 토큰 수
    latencyMs: number // 걸린 시간 (밀리초)
    costUsd: number // 비용 (달러)
}

// 용도 하나의 비용 합계
export interface RoleCost {
    role: string // 호출 용도
    usd: number // 비용 합계 (달러)
}

export interface LlmUsageRepository {
    insertUsage(llmCall: LlmCallUsage): void // 호출 한 번의 사용량 기록 (기록 시각은 지금)
    sumCostSince(sinceIso: string): number // sinceIso 이후(그 시각 포함) 비용 합계 (달러, 기록이 없으면 0)
    sumCostForRun(runId: number): number // 그 실행에 속한 호출의 비용 합계 (달러, 기록이 없으면 0)
    sumCostTotal(): number // 전체 기간의 비용 합계 (달러, 기록이 없으면 0)
    listCostByRole(sinceIso: string | null): RoleCost[] // sinceIso 이후의 용도별 비용 합계 (null이면 전체 기간, 비용이 큰 용도부터)
}

/**
 * LLM 사용량 저장소 생성
 *
 * @param {AppDatabase} database - DB 연결
 * @returns {LlmUsageRepository} LLM 사용량 저장소
 */
export function createLlmUsageRepository(database: AppDatabase): LlmUsageRepository {
    const costSum = sql<number | null>`sum(${llmUsage.costUsd})` // 비용 합계 (해당하는 기록이 없으면 null)

    return {
        insertUsage(llmCall) {
            database
                .insert(llmUsage)
                .values({
                    at: nowIso(),
                    runId: llmCall.runId,
                    role: llmCall.role,
                    model: llmCall.model,
                    inputTokens: llmCall.usage.input,
                    cachedTokens: llmCall.usage.cachedInput,
                    outputTokens: llmCall.usage.output,
                    reasoningTokens: llmCall.usage.reasoning,
                    latencyMs: llmCall.latencyMs,
                    costUsd: llmCall.costUsd
                })
                .run()
        },

        sumCostSince(sinceIso) {
            return database.select({ costUsd: costSum }).from(llmUsage).where(gte(llmUsage.at, sinceIso)).get()?.costUsd ?? 0
        },

        sumCostForRun(runId) {
            return database.select({ costUsd: costSum }).from(llmUsage).where(eq(llmUsage.runId, runId)).get()?.costUsd ?? 0
        },

        sumCostTotal() {
            return database.select({ costUsd: costSum }).from(llmUsage).get()?.costUsd ?? 0
        },

        listCostByRole(sinceIso) {
            const roleCostSum = sql<number>`sum(${llmUsage.costUsd})` // 용도 하나의 비용 합계 (묶음마다 기록이 하나 이상이라 null이 아님)
            return database
                .select({ role: llmUsage.role, usd: roleCostSum })
                .from(llmUsage)
                .where(sinceIso === null ? undefined : gte(llmUsage.at, sinceIso))
                .groupBy(llmUsage.role)
                .orderBy(desc(roleCostSum))
                .all()
        }
    }
}
