// ============================================================================
// 저장 후 보강
//
// [역할]
// - 기사를 저장하면 뒤에서 본문 보관과 태그 추천을 함 (DESIGN.md 6.2절)
// - 본문: 원문 본문이 아직 없으면 원문에서 추출해 문단으로 보관 (원문 링크가 사라져도 남고, AI 질문의 근거가 됨)
// - 본문 추출에 실패했고 보관된 본문도 없으면 수집 때 받은 글을 본문 대신 보관
// - 태그: 기사에 태그가 하나도 없을 때만 LLM이 추천 (작은 모델로 먼저, 실패하면 큰 모델로 한 번 더), 최대 3개
// - 기존 태그 목록(많이 쓴 순 60개)을 함께 보내 같은 뜻의 태그를 새로 만들지 않게 함
// - 보강은 기사마다 한 번만 (끝나면 성공 · 실패와 상관없이 보강 완료로 표시)
// - 본문 추출 · 태그 추천이 실패해도 예외를 던지지 않음 (저장 자체에는 영향 없음)
// ============================================================================
import type Groq from 'groq-sdk'
import { z } from 'zod'
import { modelSpecForRole, type AppConfig } from '../config'
import type { Db } from '../db/db'
import * as repo from '../db/repo'
import { LlmSession } from '../llm/service'
import { isExtractable } from './content'
import { extractArticle } from './extract'

const MAX_EXISTING_TAGS = 60 // 태그 추천 때 함께 보내는 기존 태그 수 (많이 쓴 순으로 이만큼)

// 태그 추천 응답의 모양 (검증용)
const TagsZod = z.object({ tags: z.array(z.string()) })
// 태그 추천 응답의 모양 (LLM에 보내는 JSON 스키마)
const TagsJsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['tags'],
    properties: { tags: { type: 'array', items: { type: 'string' } } }
}

export interface EnrichDeps {
    db: Db // DB 연결
    config: AppConfig // 프롬프트 · 모델 · 단가 설정
    groq: Groq | null // Groq 클라이언트 (API 키가 없으면 null, 태그 추천을 건너뜀)
    log(level: 'info' | 'warn' | 'error', message: string): void // 진단 기록
}

/**
 * 저장한 기사 한 건 보강 (본문 보관 + 태그 추천)
 * - 실패해도 저장 자체에는 영향이 없음
 * - 기사마다 한 번만 처리 (이미 보강했거나 저장한 기사가 아니면 아무것도 하지 않음)
 *
 * @param {EnrichDeps} deps - DB · 설정 · Groq 클라이언트 · 기록
 * @param {number} itemId - 기사 번호
 * @returns {Promise<boolean>} 처리를 했으면 true (화면이 "추천 중" 표시를 거두도록 결과와 상관없이 알림), 할 일이 없었으면 false
 */
export async function enrichSavedItem(deps: EnrichDeps, itemId: number): Promise<boolean> {
    const { db, config, log } = deps

    // 기사가 없거나, 저장한 기사가 아니거나, 이미 보강을 마쳤으면 할 일 없음
    const itemRow = repo.getItemRow(db, itemId)
    if (!itemRow || !repo.needsEnrichment(db, itemId)) return false

    // 1) 본문
    // 원문 본문이 아직 없고(본문이 없거나 수집한 글로 대신한 상태) 원문에서 뽑을 수 있는 기사면 추출
    const existingContent = repo.getContent(db, itemId)
    if (!existingContent?.fullText && isExtractable(itemRow.url, itemRow.kind)) {
        try {
            // 추출 성공 → 원문 본문으로 저장 (본문을 못 찾았으면 그대로 둠)
            const extractedArticle = await extractArticle(itemRow.url)
            if (extractedArticle) {
                repo.saveContent(db, itemId, extractedArticle.paragraphs, true)
            }
        } catch (extractError) {
            // 추출 실패(접속 오류 등) → 기록만 남기고 계속
            log('info', `저장 기사 본문 추출 실패(${itemRow.source_name}): ${(extractError as Error).message}`)
        }
    }

    // 그래도 보관된 본문이 없으면 수집 때 받은 글을 한 문단으로 보관하고 원문 본문이 아님을 표시
    if (!repo.getContent(db, itemId) && itemRow.snippet) {
        repo.saveContent(db, itemId, [itemRow.snippet], false)
    }

    // 2) 태그 (이미 태그가 붙어 있으면 건너뜀, API 키가 없어도 건너뜀)
    if (deps.groq && repo.getTags(db, itemId).length === 0) {
        try {
            // 기존 태그 이름 (많이 쓴 순 60개까지)
            const existingTagNames = repo
                .listTags(db)
                .slice(0, MAX_EXISTING_TAGS)
                .map((tagCount) => tagCount.name)
            const llmSession = new LlmSession(deps.groq, db, config.pricing, null) // 브리핑 실행 밖의 호출이라 실행 번호 없이 사용량만 기록

            // 보낼 내용: 기존 태그 목록 + 기사 제목과 요약 (요약이 없으면 수집한 글의 앞 600자)
            const userPrompt = [
                `기존 태그: ${existingTagNames.length ? existingTagNames.join(', ') : '(없음)'}`,
                '',
                `원제: ${itemRow.title}`,
                `한국어 제목: ${itemRow.title_ko ?? ''}`,
                `요약: ${itemRow.summary_ko ?? itemRow.snippet.slice(0, 600)}`
            ].join('\n')

            // 지정한 역할의 모델로 태그 추천 요청 (절약 모드와 상관없이 그 역할의 모델을 씀)
            const requestTags = (modelRole: 'triage' | 'summary') =>
                llmSession.completeJson(
                    'tags',
                    modelSpecForRole(config.models, modelRole, false),
                    { system: config.prompts.tags, user: userPrompt },
                    {
                        name: 'tags',
                        jsonSchema: TagsJsonSchema,
                        zod: TagsZod
                    }
                )

            // 선별용 모델(20B)로 먼저 요청
            // 20B가 가끔 빈 응답을 내므로 실패하면 요약용 모델(120B)로 한 번 더
            const { tags: suggestedTags } = await requestTags('triage').catch(() => requestTags('summary'))

            // 추천 태그를 앞에서 3개까지 자동 태그로 붙임
            for (const suggestedTag of suggestedTags.slice(0, 3)) repo.addTag(db, itemId, suggestedTag, 'auto')
        } catch (tagError) {
            // 두 번 다 실패 → 기록만 남기고 태그 없이 마침
            log('warn', `태그 추천 실패: ${(tagError as Error).message}`)
        }
    }

    // 보강 완료로 표시 (다음부터는 다시 하지 않음)
    repo.markEnriched(db, itemId)
    return true
}
