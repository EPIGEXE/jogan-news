import { z } from 'zod'
import { CATEGORIES } from '@shared/types'

// LLM 구조화 출력 스키마. strict 모드는 additionalProperties: false와 모든 필드 required가 필요하다.
// zod는 응답을 한 번 더 검증하는 용도다.

export const TriageZod = z.object({
  results: z.array(
    z.object({
      id: z.number(),
      category: z.enum(CATEGORIES),
      relevance: z.number(),
      importance: z.number()
    })
  )
})

export const TriageJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'category', 'relevance', 'importance'],
        properties: {
          id: { type: 'integer' },
          category: { type: 'string', enum: [...CATEGORIES] },
          relevance: { type: 'number' },
          importance: { type: 'integer' }
        }
      }
    }
  }
}

export const ClusterZod = z.object({
  groups: z.array(z.object({ ids: z.array(z.number()), primary: z.number() }))
})

export const ClusterJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['groups'],
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ids', 'primary'],
        properties: { ids: { type: 'array', items: { type: 'integer' } }, primary: { type: 'integer' } }
      }
    }
  }
}

export const RecentZod = z.object({
  matches: z.array(z.object({ id: z.number(), previous_id: z.number(), follow_up: z.boolean() }))
})

export const RecentJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['matches'],
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'previous_id', 'follow_up'],
        properties: { id: { type: 'integer' }, previous_id: { type: 'integer' }, follow_up: { type: 'boolean' } }
      }
    }
  }
}

export const SummaryZod = z.object({
  title_ko: z.string(),
  summary_ko: z.string(),
  key_points: z.array(z.string()),
  why_it_matters: z.string(),
  category: z.enum(CATEGORIES),
  relevance: z.number(),
  importance: z.number()
})
export type Summary = z.infer<typeof SummaryZod>

export const SummaryJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title_ko', 'summary_ko', 'key_points', 'why_it_matters', 'category', 'relevance', 'importance'],
  properties: {
    title_ko: { type: 'string' },
    summary_ko: { type: 'string' },
    key_points: { type: 'array', items: { type: 'string' } },
    why_it_matters: { type: 'string' },
    category: { type: 'string', enum: [...CATEGORIES] },
    relevance: { type: 'number' },
    importance: { type: 'integer' }
  }
}

export const DigestZod = z.object({ headline: z.string(), overview: z.string() })

export const DigestJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'overview'],
  properties: { headline: { type: 'string' }, overview: { type: 'string' } }
}

/** 요약에 넘길 본문 상한 (DESIGN.md 7.5절 ②: 약 3,000토큰). 보통 기사는 전부 들어간다 */
export const MAX_SUMMARY_INPUT_CHARS = 12000

export function excerpt(paragraphs: string[], max = MAX_SUMMARY_INPUT_CHARS): string {
  let out = ''
  for (const p of paragraphs) {
    if (out.length + p.length > max) break
    out += p + '\n\n'
  }
  return out.trim() || (paragraphs[0] ?? '').slice(0, max)
}

export function summaryUserMessage(a: {
  sourceName: string
  kind: string
  title: string
  paragraphs: string[]
  fullText: boolean
}): string {
  return [
    `출처: ${a.sourceName}`,
    `유형: ${a.kind}`,
    `원제: ${a.title}`,
    a.fullText ? '' : '(본문 전체가 아니라 요약·초록만 제공됨)',
    '',
    '본문:',
    excerpt(a.paragraphs)
  ].join('\n')
}
