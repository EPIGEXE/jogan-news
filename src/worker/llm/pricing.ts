// ============================================================================
// LLM 단가와 비용 계산
//
// [역할]
// - 모델별 단가 파일(config/pricing.yaml) 읽기 · 형식 검증
// - 토큰 사용량으로 호출 한 번의 비용(달러) 계산
// - 단가는 토큰 100만 개당 달러, 캐시된 입력은 할인 단가(cached_input)로 계산
// - 단가 파일에 없는 모델은 비용을 알 수 없음(null)으로 답함
// ============================================================================
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { z } from 'zod'

// 모델 하나의 단가 (토큰 100만 개당 달러. 키는 pricing.yaml의 키 그대로)
const ModelPriceSchema = z.object({ input: z.number(), cached_input: z.number(), output: z.number() })
const PricingSchema = z.record(z.string(), ModelPriceSchema) // 모델 ID별 단가

export type Pricing = z.infer<typeof PricingSchema> // 모델 ID별 단가표

// LLM 호출 한 번의 토큰 사용량
export interface TokenUsage {
    input: number // 입력 토큰 (캐시된 입력 포함)
    cachedInput: number // 그중 프롬프트 캐싱이 적용된 입력 토큰
    output: number // 출력 토큰 (추론 토큰 포함)
    reasoning: number // 그중 추론에 쓴 토큰
}

/**
 * 단가 파일 읽기
 *
 * @param {string} pricingFilePath - pricing.yaml의 경로
 * @returns {Pricing} 모델 ID별 단가표 (형식이 맞지 않으면 오류)
 */
export function loadPricing(pricingFilePath: string): Pricing {
    return PricingSchema.parse(parse(readFileSync(pricingFilePath, 'utf8')))
}

/**
 * 토큰 사용량으로 비용 계산
 *
 * - 추론 토큰은 output에 이미 포함돼 있어 따로 더하지 않음
 *
 * @param {Pricing} pricing - 모델 ID별 단가표
 * @param {string} model - 호출한 모델 ID
 * @param {TokenUsage} tokenUsage - 그 호출의 토큰 사용량
 * @returns {number | null} 비용(USD). 단가가 없는 모델이면 null
 */
export function calculateCostUsd(pricing: Pricing, model: string, tokenUsage: TokenUsage): number | null {
    // 단가표에 없는 모델 → 비용을 알 수 없음
    const modelPrice = pricing[model]
    if (!modelPrice) return null

    // 입력을 캐시 안 된 것 · 캐시된 것으로 나눠 각각의 단가 적용 (단가가 100만 토큰당이라 100만으로 나눔)
    const uncachedInputTokens = Math.max(0, tokenUsage.input - tokenUsage.cachedInput)
    return (
        (uncachedInputTokens * modelPrice.input +
            tokenUsage.cachedInput * modelPrice.cached_input +
            tokenUsage.output * modelPrice.output) /
        1_000_000
    )
}
