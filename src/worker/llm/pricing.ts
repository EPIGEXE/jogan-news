import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { z } from 'zod'

const PriceSchema = z.object({ input: z.number(), cached_input: z.number(), output: z.number() })
const PricingSchema = z.record(z.string(), PriceSchema)

export type Pricing = z.infer<typeof PricingSchema>

export interface TokenUsage {
  input: number
  cachedInput: number
  output: number
  reasoning: number
}

export function loadPricing(path: string): Pricing {
  return PricingSchema.parse(parse(readFileSync(path, 'utf8')))
}

/** 토큰 사용량으로 비용(USD)을 계산한다. 단가가 없는 모델은 null. 추론 토큰은 output에 이미 포함돼 있다. */
export function costUsd(pricing: Pricing, model: string, u: TokenUsage): number | null {
  const p = pricing[model]
  if (!p) return null
  const uncached = Math.max(0, u.input - u.cachedInput)
  return (uncached * p.input + u.cachedInput * p.cached_input + u.output * p.output) / 1_000_000
}
