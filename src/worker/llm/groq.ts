import Groq, { BadRequestError } from 'groq-sdk'
import type { ChatCompletionCreateParamsNonStreaming } from 'groq-sdk/resources/chat/completions'
import type { z } from 'zod'
import type { TokenUsage } from './pricing'

// Groq 호출 계층. 역할별 모델 설정은 호출하는 쪽에서 넘긴다 (DESIGN.md 7.6절).

export interface ModelSpec {
  model: string
  /** GPT-OSS: low | medium | high, Qwen: none | default | low | medium | high */
  reasoningEffort?: 'none' | 'default' | 'low' | 'medium' | 'high'
  maxCompletionTokens: number
}

export interface JsonCallResult<T> {
  data: T
  usage: TokenUsage
  latencyMs: number
}

export function createGroq(apiKey: string): Groq {
  return new Groq({ apiKey, maxRetries: 3, timeout: 60_000 })
}

function reasoningParams(spec: ModelSpec): Partial<ChatCompletionCreateParamsNonStreaming> {
  if (!spec.reasoningEffort) return {}
  // GPT-OSS는 include_reasoning, Qwen 등은 reasoning_format으로 추론 내용을 응답에서 뺀다.
  const hide = spec.model.startsWith('openai/gpt-oss')
    ? { include_reasoning: false }
    : { reasoning_format: 'hidden' as const }
  return { reasoning_effort: spec.reasoningEffort, ...hide }
}

/** strict json_schema 구조화 출력으로 호출하고 zod로 한 번 더 검증한다. */
export async function completeJson<T>(
  groq: Groq,
  spec: ModelSpec,
  messages: { system: string; user: string },
  schema: { name: string; jsonSchema: Record<string, unknown>; zod: z.ZodType<T> }
): Promise<JsonCallResult<T>> {
  const started = Date.now()
  const res = await groq.chat.completions
    .create({
      model: spec.model,
      messages: [
        { role: 'system', content: messages.system },
        { role: 'user', content: messages.user }
      ],
      max_completion_tokens: spec.maxCompletionTokens,
      response_format: {
        type: 'json_schema',
        json_schema: { name: schema.name, strict: true, schema: schema.jsonSchema }
      },
      ...reasoningParams(spec)
    })
    .catch((err: unknown) => {
      // strict 모드에서 모델이 배열을 {items: [...]}로 감싸면 Groq이 400(json_validate_failed)을 준다.
      // 응답에 실린 failed_generation을 풀어서 쓸 수 있으면 살린다. 이 경우 토큰 사용량은 알 수 없다.
      const recovered = recoverFailedGeneration(err, schema)
      if (recovered === undefined) throw err
      return { recovered }
    })
  if ('recovered' in res) {
    return { data: res.recovered, latencyMs: Date.now() - started, usage: { input: 0, cachedInput: 0, output: 0, reasoning: 0 } }
  }
  const latencyMs = Date.now() - started
  const content = res.choices[0]?.message.content
  if (!content) throw new Error(`빈 응답 (finish_reason=${res.choices[0]?.finish_reason})`)
  const data = schema.zod.parse(unwrapArrays(JSON.parse(content), schema.jsonSchema))
  const u = res.usage
  return {
    data,
    latencyMs,
    usage: {
      input: u?.prompt_tokens ?? 0,
      cachedInput: u?.prompt_tokens_details?.cached_tokens ?? 0,
      output: u?.completion_tokens ?? 0,
      reasoning: u?.completion_tokens_details?.reasoning_tokens ?? 0
    }
  }
}

/**
 * 스키마가 배열을 기대하는 자리에 {items: [...]} 같은 객체 하나로 감싼 값이 오면 안의 배열로 바꾼다.
 * gpt-oss가 strict 모드에서 자주 보이는 실수다.
 */
export function unwrapArrays(value: unknown, schema: Record<string, unknown>): unknown {
  if (schema['type'] === 'array') {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const arrays = Object.values(value).filter(Array.isArray)
      if (arrays.length === 1) value = arrays[0]
    }
    const items = schema['items'] as Record<string, unknown> | undefined
    return Array.isArray(value) && items ? value.map((v) => unwrapArrays(v, items)) : value
  }
  if (schema['type'] === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const props = (schema['properties'] ?? {}) as Record<string, Record<string, unknown>>
    const out: Record<string, unknown> = { ...(value as Record<string, unknown>) }
    for (const [k, sub] of Object.entries(props)) if (k in out) out[k] = unwrapArrays(out[k], sub)
    return out
  }
  return value
}

function recoverFailedGeneration<T>(
  err: unknown,
  schema: { jsonSchema: Record<string, unknown>; zod: z.ZodType<T> }
): T | undefined {
  if (!(err instanceof BadRequestError)) return undefined
  const body = err.error as { error?: { code?: string; failed_generation?: string } } | undefined
  const raw = body?.error?.code === 'json_validate_failed' ? body.error.failed_generation : undefined
  if (!raw) return undefined
  try {
    const parsed = schema.zod.safeParse(unwrapArrays(JSON.parse(raw), schema.jsonSchema))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}
