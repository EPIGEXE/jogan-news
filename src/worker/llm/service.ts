import type Groq from 'groq-sdk'
import pLimit from 'p-limit'
import type { z } from 'zod'
import { recordUsage } from '../db/repo'
import type { Db } from '../db/db'
import { completeJson, type ModelSpec } from './groq'
import { costUsd, type Pricing } from './pricing'

// 한 번의 실행(run) 동안 LLM 호출을 관리한다: 사용량 기록, 실행당 토큰 상한, 모델별 동시 호출 수 제한.
// 429 재시도는 groq-sdk가 retry-after를 보고 처리한다 (maxRetries: 3).

/** 실행 한 번에 허용하는 총 토큰 (DESIGN.md 7.5절 ⑤) */
export const RUN_TOKEN_CAP = 1_000_000
const CONCURRENCY_PER_MODEL = 4

export class RunTokenCapExceeded extends Error {
  constructor(used: number) {
    super(`실행당 토큰 상한(${RUN_TOKEN_CAP.toLocaleString()})을 넘어 중단했습니다 (사용 ${used.toLocaleString()})`)
  }
}

export class LlmSession {
  private tokens = 0
  private readonly limiters = new Map<string, ReturnType<typeof pLimit>>()

  constructor(
    private readonly groq: Groq,
    private readonly db: Db,
    private readonly pricing: Pricing,
    private readonly runId: number | null
  ) {}

  get tokensUsed(): number {
    return this.tokens
  }

  private limiter(model: string) {
    let l = this.limiters.get(model)
    if (!l) {
      l = pLimit(CONCURRENCY_PER_MODEL)
      this.limiters.set(model, l)
    }
    return l
  }

  async json<T>(
    role: string,
    spec: ModelSpec,
    messages: { system: string; user: string },
    schema: { name: string; jsonSchema: Record<string, unknown>; zod: z.ZodType<T> }
  ): Promise<T> {
    if (this.tokens > RUN_TOKEN_CAP) throw new RunTokenCapExceeded(this.tokens)
    return this.limiter(spec.model)(async () => {
      const r = await completeJson(this.groq, spec, messages, schema)
      this.tokens += r.usage.input + r.usage.output
      recordUsage(this.db, {
        runId: this.runId,
        role,
        model: spec.model,
        usage: r.usage,
        latencyMs: r.latencyMs,
        costUsd: costUsd(this.pricing, spec.model, r.usage) ?? 0
      })
      return r.data
    })
  }
}
