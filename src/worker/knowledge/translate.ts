// ============================================================================
// 본문 번역
//
// [역할]
// - 기사 본문을 문단 단위로 한국어로 옮김 (DESIGN.md 13.5절)
// - 문단 번호를 그대로 유지: [¶n] 인용 · 하이라이트가 원문과 번역 양쪽에 맞음
// - 번역이 필요한 기사인지 판단: 소스 언어가 ko이거나 제목 · 소개 글의 한글이 30% 이상이면 한국어 기사로 보고 번역하지 않음
// - 기사 한 건에 원문 40,000자까지만 번역, 넘는 뒤쪽 문단은 null로 두어 화면에서 원문으로 보여 줌
// - 원문 약 5,000자씩 묶어 묶음마다 따로 요청 (번역문이 출력 상한 안에 다 들어가도록), 묶음은 동시에 처리
// - 응답에서 빠졌거나 빈 번역이 온 문단도 null
// - 묶음 요청은 실패하면 한 번 더 시도, 그래도 한 묶음이라도 실패하면 오류 (기사 전체가 번역 없음으로 남아 나중에 다시 시도)
// - DB를 쓰지 않는 규칙만 둠 (번역을 보관하는 일은 services/translation-service.ts)
// ============================================================================
import { z } from 'zod'
import type { ModelSpec } from '@config/index'
import type { LlmCaller } from '../llm/service'

// 기사 한 건에서 번역할 최대 글자 수 (원문 기준)
// 보통 기사(3~6천 자)의 10배 가까이 되는 넉넉한 값이고, 넘는 문단은 원문으로 둠
export const MAX_TRANSLATE_CHARS = 40_000
const CHUNK_CHARS = 5_000 // 한 번의 호출에 보내는 원문 글자 수. 출력 상한 안에 번역이 다 들어가도록 나눔

// 번역 응답의 모양 (검증용): 문단 번호 n과 번역문 ko의 목록
const TranslateZod = z.object({ paragraphs: z.array(z.object({ n: z.number(), ko: z.string() })) })
// 번역 응답의 모양 (LLM에 보내는 JSON 스키마)
const TranslateJsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['paragraphs'],
    properties: {
        paragraphs: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['n', 'ko'],
                properties: { n: { type: 'integer' }, ko: { type: 'string' } }
            }
        }
    }
}

/**
 * 번역할 문단을 호출 단위(묶음)로 나눔
 * - 앞에서부터 차례로 담고, 누적 글자 수가 상한을 넘게 되는 문단부터 뒤는 모두 제외
 * - 묶음 크기를 넘게 되면 새 묶음 시작 (문단 하나가 묶음 크기보다 길면 그 문단 혼자 한 묶음)
 *
 * @param {string[]} paragraphs - 본문 문단 전체
 * @param {number} maxChars - 기사 한 건에서 번역할 최대 글자 수
 * @param {number} chunkChars - 한 묶음의 글자 수
 * @returns {number[][]} 묶음 목록 (묶음마다 문단의 순번, 0부터)
 */
export function planChunks(paragraphs: string[], maxChars = MAX_TRANSLATE_CHARS, chunkChars = CHUNK_CHARS): number[][] {
    const chunks: number[][] = []
    let plannedChars = 0 // 지금까지 번역하기로 한 글자 수 (상한 확인용)
    let currentChunk: number[] = [] // 채우는 중인 묶음 (문단 순번)
    let currentChunkChars = 0 // 채우는 중인 묶음의 글자 수

    for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
        const paragraphChars = paragraphs[paragraphIndex]!.length

        // 이 문단을 넣으면 기사 상한을 넘음 → 여기서 멈춤 (뒤쪽 문단은 번역하지 않음)
        if (plannedChars + paragraphChars > maxChars) break
        plannedChars += paragraphChars

        // 이 문단을 넣으면 묶음 크기를 넘음 → 지금 묶음을 닫고 새 묶음 시작
        // 빈 묶음에는 크기와 상관없이 넣으므로, 긴 문단은 혼자 한 묶음이 됨
        if (currentChunk.length > 0 && currentChunkChars + paragraphChars > chunkChars) {
            chunks.push(currentChunk)
            currentChunk = []
            currentChunkChars = 0
        }
        currentChunk.push(paragraphIndex)
        currentChunkChars += paragraphChars
    }

    // 마지막으로 채우던 묶음 추가
    if (currentChunk.length) chunks.push(currentChunk)
    return chunks
}

/**
 * 문단 배열 번역
 * - 결과는 입력과 같은 길이 · 같은 순서 (문단 번호 유지)
 * - 번역하지 않은(상한 초과 · 응답 누락) 문단은 null
 *
 * @param {LlmCaller} llmSession - LLM 호출 세션 (사용량 기록 · 동시 호출 수 제한)
 * @param {ModelSpec} modelSpec - 번역에 쓸 모델
 * @param {string} systemPrompt - 번역 규칙 프롬프트 (config/prompts/translate.md)
 * @param article - 번역할 기사의 원제 · 출처 이름 · 본문 문단
 * @returns {Promise<(string | null)[]>} 문단별 번역
 * @throws 묶음 하나라도 끝내 실패하면 오류 (번역 없음으로 남겨 두었다가 나중에 다시 시도)
 */
export async function translateParagraphs(
    llmSession: LlmCaller,
    modelSpec: ModelSpec,
    systemPrompt: string,
    article: { title: string; sourceName: string; paragraphs: string[] }
): Promise<(string | null)[]> {
    const translatedParagraphs: (string | null)[] = article.paragraphs.map(() => null) // 문단별 번역 (처음에는 모두 번역 없음)

    // 문단을 묶음으로 나누고 묶음마다 동시에 요청
    const chunks = planChunks(article.paragraphs)
    await Promise.all(
        chunks.map(async (chunkParagraphIndexes) => {
            // 보낼 내용: 출처 · 원제 + 한 줄에 문단 하나씩 {"n": 문단 번호, "text": 원문}
            // n은 화면의 ¶ 번호와 같은 1부터의 번호
            const userPrompt = [
                `출처: ${article.sourceName}`,
                `원제: ${article.title}`,
                '',
                ...chunkParagraphIndexes.map((paragraphIndex) =>
                    JSON.stringify({ n: paragraphIndex + 1, text: article.paragraphs[paragraphIndex] })
                )
            ].join('\n')

            const requestTranslation = () =>
                llmSession.completeJson(
                    'translate',
                    modelSpec,
                    { system: systemPrompt, user: userPrompt },
                    { name: 'translation', jsonSchema: TranslateJsonSchema, zod: TranslateZod }
                )
            // 구조화 출력이 가끔 깨지므로 실패하면 한 번 더 시도 (또 실패하면 전체 실패)
            const translationResult = await requestTranslation().catch(() => requestTranslation())

            // 응답의 번역을 문단 번호로 제자리에 넣음
            // 이 묶음에서 요청하지 않은 번호와 빈 번역은 무시 (그 문단은 null로 남음)
            const requestedIndexes = new Set(chunkParagraphIndexes) // 이 묶음에서 요청한 문단 순번
            for (const translatedEntry of translationResult.paragraphs) {
                const returnedIndex = translatedEntry.n - 1 // 응답의 문단 번호(1부터)를 순번(0부터)으로
                if (requestedIndexes.has(returnedIndex) && translatedEntry.ko.trim())
                    translatedParagraphs[returnedIndex] = translatedEntry.ko.trim()
            }
        })
    )
    return translatedParagraphs
}
