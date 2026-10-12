// ============================================================================
// LLM 구조화 출력 스키마
//
// [역할]
// - 파이프라인의 LLM 호출이 돌려줄 JSON의 모양 정의 (선별 · 같은 소식 묶기 · 7일 중복 확인 · 요약 · 머리글)
// - 호출마다 두 벌: LLM에 보내는 JSON 스키마와, 받은 응답을 한 번 더 검증하는 zod 스키마 (둘의 키는 같아야 함)
// - JSON 스키마는 strict 모드 규칙을 지킴 (객체마다 additionalProperties: false, 모든 필드 required)
// - 요약 호출에 보낼 사용자 메시지 조립 (본문은 12,000자까지)
// ============================================================================
import { z } from 'zod'
import { CATEGORIES } from '@shared/types'

// 선별 응답 검증: 기사마다 번호 · 분류 · 관련도(0~1) · 중요도(1~5)
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

// 선별 호출에 보내는 스키마 (한 번에 여러 기사를 보내므로 결과는 배열)
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
                    id: { type: 'integer' }, // 입력으로 보낸 기사 번호 그대로
                    category: { type: 'string', enum: [...CATEGORIES] }, // 분류
                    relevance: { type: 'number' }, // LLM · AI 에이전트 분야와의 관련도 (0~1)
                    importance: { type: 'integer' } // 개발자에게 쓸모 있는 정도 (1~5)
                }
            }
        }
    }
}

// 묶기 응답 검증: 묶음마다 기사 번호 목록과 대표 기사 번호
export const ClusterZod = z.object({
    groups: z.array(z.object({ ids: z.array(z.number()), primary: z.number() }))
})

// 묶기 호출에 보내는 스키마 (ids: 같은 소식인 기사 번호, primary: 원본에 가장 가까운 기사 번호)
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

// 중복 확인 응답 검증: 지난 브리핑과 겹치는 후보마다 짝 하나
export const RecentZod = z.object({
    matches: z.array(z.object({ id: z.number(), previous_id: z.number(), follow_up: z.boolean() }))
})

// 중복 확인 호출에 보내는 스키마
// id: 오늘 후보 번호, previous_id: 같은 소식인 지난 기사 번호, follow_up: 중요한 새 전개가 있는 후속 소식인지
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

// 요약 응답 검증: 기사 한 건의 한국어 요약
export const SummaryZod = z.object({
    title_ko: z.string(),
    summary_ko: z.string(),
    key_points: z.array(z.string()),
    why_it_matters: z.string(),
    category: z.enum(CATEGORIES),
    relevance: z.number(),
    importance: z.number()
})
export type Summary = z.infer<typeof SummaryZod> // 검증을 통과한 요약 응답

// 요약 호출에 보내는 스키마
export const SummaryJsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['title_ko', 'summary_ko', 'key_points', 'why_it_matters', 'category', 'relevance', 'importance'],
    properties: {
        title_ko: { type: 'string' }, // 한국어 제목
        summary_ko: { type: 'string' }, // 한국어 요약
        key_points: { type: 'array', items: { type: 'string' } }, // 핵심 포인트
        why_it_matters: { type: 'string' }, // 왜 중요한가
        category: { type: 'string', enum: [...CATEGORIES] }, // 분류
        relevance: { type: 'number' }, // 관련도 (0~1)
        importance: { type: 'integer' } // 중요도 (1~5)
    }
}

// 머리글 응답 검증: 오늘의 한 줄(headline)과 오늘의 흐름 요약(overview)
export const DigestZod = z.object({ headline: z.string(), overview: z.string() })

// 머리글 호출에 보내는 스키마
export const DigestJsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['headline', 'overview'],
    properties: { headline: { type: 'string' }, overview: { type: 'string' } }
}

// 요약에 넘길 본문 상한 (글자 수, 약 3,000토큰. DESIGN.md 7.5절 ②). 보통 기사는 전부 들어감
export const MAX_SUMMARY_INPUT_CHARS = 12000

/**
 * 본문 앞부분을 상한 안에서 잘라 냄
 * - 문단을 앞에서부터 통째로 담다가, 다음 문단을 넣으면 상한을 넘을 때 멈춤 (문단 중간에서 자르지 않음)
 * - 첫 문단부터 상한을 넘으면 그 문단을 상한까지만 잘라 씀
 *
 * @param {string[]} paragraphs - 본문 문단
 * @param {number} maxChars - 글자 수 상한 (기본 12,000자)
 * @returns {string} 문단 사이를 빈 줄로 이은 발췌
 */
export function excerpt(paragraphs: string[], maxChars = MAX_SUMMARY_INPUT_CHARS): string {
    let excerptText = '' // 지금까지 담은 문단
    for (const paragraph of paragraphs) {
        // 이 문단을 넣으면 상한을 넘음 → 여기서 멈춤
        if (excerptText.length + paragraph.length > maxChars) break
        excerptText += paragraph + '\n\n'
    }

    // 한 문단도 담지 못했으면 첫 문단을 상한까지 잘라 씀
    return excerptText.trim() || (paragraphs[0] ?? '').slice(0, maxChars)
}

/**
 * 요약 호출의 사용자 메시지 조립
 * - 출처 · 유형 · 원제 뒤에 본문 발췌를 붙임
 * - 본문 전체가 아니면(요약 · 초록만 있으면) 그 사실을 한 줄로 알림
 *
 * @param article - 기사의 출처 이름 · 유형 · 원제 · 본문 문단 · 본문 전체인지 여부
 * @returns {string} 사용자 메시지
 */
export function summaryUserMessage(article: {
    sourceName: string
    kind: string
    title: string
    paragraphs: string[]
    fullText: boolean
}): string {
    return [
        `출처: ${article.sourceName}`,
        `유형: ${article.kind}`,
        `원제: ${article.title}`,
        article.fullText ? '' : '(본문 전체가 아니라 요약·초록만 제공됨)',
        '',
        '본문:',
        excerpt(article.paragraphs)
    ].join('\n')
}
