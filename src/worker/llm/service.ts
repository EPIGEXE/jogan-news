// ============================================================================
// LLM 호출 세션
//
// [역할]
// - 한 번의 실행(run) 동안의 LLM 호출 관리 (브리핑 생성 한 번, 또는 번역 · 태그 추천 · 질문 한 건)
// - 호출마다 사용량(토큰 · 걸린 시간 · 비용)을 DB에 기록 (단가가 없는 모델의 비용은 0으로 기록)
// - 실행당 토큰 상한: 세션이 쓴 토큰이 100만을 넘으면 다음 호출부터 오류로 중단 (DESIGN.md 7.5절 ⑤)
// - 모델별 동시 호출 수 제한 (JSON 호출만. 스트리밍 답변은 제한 없이 바로 호출)
// - 429 재시도는 하지 않음 (groq-sdk가 retry-after를 보고 처리, maxRetries: 3)
// ============================================================================
import type Groq from 'groq-sdk'
import pLimit from 'p-limit'
import type { z } from 'zod'
import { recordUsage } from '../db/repo'
import type { Db } from '../db/db'
import { completeJson, streamChat, type ChatTurn, type ModelSpec } from './groq'
import { calculateCostUsd, type Pricing } from './pricing'

/** 실행 한 번에 허용하는 총 토큰 (입력 + 출력, DESIGN.md 7.5절 ⑤) */
export const RUN_TOKEN_CAP = 1_000_000
const CONCURRENCY_PER_MODEL = 4 // 한 모델에 동시에 보내는 JSON 호출 수

/**
 * 실행당 토큰 상한을 넘었을 때의 오류
 */
export class RunTokenCapExceededError extends Error {
    constructor(usedTokens: number) {
        super(`실행당 토큰 상한(${RUN_TOKEN_CAP.toLocaleString()})을 넘어 중단했습니다 (사용 ${usedTokens.toLocaleString()})`)
    }
}

/**
 * 한 번의 실행 동안 LLM 호출을 맡는 세션
 *
 * - 호출마다 사용량을 기록하고 세션이 쓴 토큰을 누적
 * - 누적 토큰이 실행당 상한을 넘으면 그 뒤의 호출은 RunTokenCapExceededError
 * - runId가 null이면 브리핑 생성 밖의 호출 (번역 · 태그 추천 · 질문)
 */
export class LlmSession {
    private usedTokens = 0 // 이 세션이 지금까지 쓴 토큰 (입력 + 출력)
    private readonly limitersByModel = new Map<string, ReturnType<typeof pLimit>>() // 모델 ID별 동시 호출 제한기

    constructor(
        private readonly groq: Groq,
        private readonly db: Db,
        private readonly pricing: Pricing, // 비용 계산에 쓰는 단가표
        private readonly runId: number | null // 사용량 기록에 남길 실행 번호 (브리핑 생성이 아니면 null)
    ) {}

    // 이 세션이 지금까지 쓴 토큰 (실행 기록에 남김)
    get tokensUsed(): number {
        return this.usedTokens
    }

    // 그 모델의 동시 호출 제한기 (처음 쓰는 모델이면 새로 만듦)
    private limiterFor(model: string) {
        let modelLimiter = this.limitersByModel.get(model)
        if (!modelLimiter) {
            modelLimiter = pLimit(CONCURRENCY_PER_MODEL)
            this.limitersByModel.set(model, modelLimiter)
        }
        return modelLimiter
    }

    /**
     * 구조화 출력(JSON) 호출
     *
     * - 같은 모델로 가는 호출은 동시에 4개까지만 보내고 나머지는 차례를 기다림
     *
     * @param {string} role - 사용량 기록에 남길 역할 이름 (triage · summary · digest 등)
     * @param {ModelSpec} modelSpec - 호출할 모델과 추론 강도 · 출력 상한
     * @param prompt - 시스템 프롬프트와 사용자 입력
     * @param outputSchema - 응답 형식 (LLM에 보내는 JSON 스키마와 검증용 zod)
     * @returns {Promise<T>} 검증을 통과한 응답 값 (토큰 상한을 넘었으면 RunTokenCapExceededError)
     */
    async completeJson<T>(
        role: string,
        modelSpec: ModelSpec,
        prompt: { system: string; user: string },
        outputSchema: { name: string; jsonSchema: Record<string, unknown>; zod: z.ZodType<T> }
    ): Promise<T> {
        // 이미 상한을 넘었으면 호출하지 않고 중단 (차례를 기다리기 전에 확인)
        if (this.usedTokens > RUN_TOKEN_CAP) throw new RunTokenCapExceededError(this.usedTokens)

        // 그 모델의 동시 호출 제한 안에서 실행
        return this.limiterFor(modelSpec.model)(async () => {
            const jsonCallResult = await completeJson(this.groq, modelSpec, prompt, outputSchema)

            // 쓴 토큰 누적 (다음 호출의 상한 확인에 쓰임)
            this.usedTokens += jsonCallResult.usage.input + jsonCallResult.usage.output

            // 사용량 기록 (단가가 없는 모델이면 비용 0)
            recordUsage(this.db, {
                runId: this.runId,
                role,
                model: modelSpec.model,
                usage: jsonCallResult.usage,
                latencyMs: jsonCallResult.latencyMs,
                costUsd: calculateCostUsd(this.pricing, modelSpec.model, jsonCallResult.usage) ?? 0
            })
            return jsonCallResult.data
        })
    }

    /**
     * 스트리밍 답변 호출
     *
     * - 사용량 기록과 토큰 상한은 json()과 같음 (동시 호출 제한은 거치지 않음)
     *
     * @param {string} role - 사용량 기록에 남길 역할 이름
     * @param {ModelSpec} modelSpec - 호출할 모델과 추론 강도 · 출력 상한
     * @param {ChatTurn[]} chatTurns - 보낼 대화
     * @param onDelta - 답변 조각이 올 때마다 부르는 함수
     * @returns {Promise<string>} 전체 답변
     */
    async streamAnswer(role: string, modelSpec: ModelSpec, chatTurns: ChatTurn[], onDelta: (deltaText: string) => void): Promise<string> {
        // 이미 상한을 넘었으면 호출하지 않고 중단
        if (this.usedTokens > RUN_TOKEN_CAP) throw new RunTokenCapExceededError(this.usedTokens)

        // 답변이 끝날 때까지 받은 뒤 쓴 토큰 누적
        const streamResult = await streamChat(this.groq, modelSpec, chatTurns, onDelta)
        this.usedTokens += streamResult.usage.input + streamResult.usage.output

        // 사용량 기록 (단가가 없는 모델이면 비용 0)
        recordUsage(this.db, {
            runId: this.runId,
            role,
            model: modelSpec.model,
            usage: streamResult.usage,
            latencyMs: streamResult.latencyMs,
            costUsd: calculateCostUsd(this.pricing, modelSpec.model, streamResult.usage) ?? 0
        })
        return streamResult.text
    }
}
