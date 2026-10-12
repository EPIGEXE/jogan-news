// ============================================================================
// 기사 보강 서비스
//
// [역할]
// - 기사 본문 확보: 본문이 보관돼 있지 않으면 원문 페이지에서 추출해 문단 단위로 보관
// - 추출하지 않는 기사(논문 · 릴리스 · 토론 페이지)와 추출에 실패한 기사는 수집 때 받은 글을 본문 대신 보관 (그것도 없으면 제목)
// - 원문에서 뽑은 본문인지 대신 넣은 글인지 함께 기록, 이미 본문이 있으면 다시 추출하지 않음
// - 저장한 기사 보강: 원문 본문이 아직 없으면 원문에서 추출해 보관하고, 태그를 추천 (DESIGN.md 6.2절)
// - 태그 추천: 기사에 태그가 하나도 없을 때만 (작은 모델로 먼저, 실패하면 큰 모델로 한 번 더), 최대 3개
// - 기존 태그 목록(많이 쓴 순 60개)을 함께 보내 같은 뜻의 태그를 새로 만들지 않게 함
// - 추천한 태그 이름은 돌려주기만 함 (기사에 붙이는 일과 "보강 완료" 표시는 Main)
// - 본문 추출 · 태그 추천이 실패해도 예외를 던지지 않음 (저장 자체에는 영향 없음)
// - 본문을 바꾸면 검색 색인 갱신 (본문이 바뀌면 이전 번역은 지워짐)
// ============================================================================
import { z } from 'zod'
import { modelSpecForRole, type AppConfig } from '@config/index'
import { runInTransaction, type AppDatabase } from '@data/client'
import type { ContentRow, ItemRepository, ItemRow } from '@data/repositories/item-repository'
import type { SearchRepository } from '@data/repositories/search-repository'
import type { TagRepository } from '@data/repositories/tag-repository'
import { isExtractable, splitParagraphs } from '../knowledge/content'
import type { ExtractedArticle } from '../knowledge/extract'
import type { LlmSessionSource } from '../llm/service'
import type { WorkerLog } from '../log'

const MAX_EXISTING_TAGS = 60 // 태그 추천 때 함께 보내는 기존 태그 수 (많이 쓴 순으로 이만큼)
const MAX_SUGGESTED_TAGS = 3 // 기사 한 건에 추천하는 태그 수 상한
const TAG_PROMPT_SNIPPET_CHARS = 600 // 요약이 없는 기사의 태그 추천에 보내는 소개 글 글자 수 (앞에서부터)

// 태그 추천 응답의 모양 (검증용)
const TagsZod = z.object({ tags: z.array(z.string()) })
// 태그 추천 응답의 모양 (LLM에 보내는 JSON 스키마)
const TagsJsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['tags'],
    properties: { tags: { type: 'array', items: { type: 'string' } } }
}

// 보강 결과
export interface EnrichmentResult {
    contentUpdated: boolean // 본문을 새로 보관했는지
    suggestedTags: string[] // 추천한 태그 이름 (추천하지 않았거나 실패하면 빈 목록)
}

export interface EnrichmentDeps {
    database: AppDatabase // 여러 쓰기를 한 묶음으로 묶을 때만 사용
    itemRepository: ItemRepository // 기사 · 보관된 본문
    tagRepository: TagRepository // 태그 읽기 (기사에 붙은 태그 · 기존 태그 목록, 쓰지는 않음)
    searchRepository: SearchRepository // 본문을 바꾼 기사의 검색 색인 갱신
    llmSessions: LlmSessionSource // 태그 추천에 쓸 LLM 세션 (API 키가 없으면 태그 추천을 건너뜀)
    config: AppConfig // 프롬프트 · 모델 설정
    extractArticle(url: string): Promise<ExtractedArticle | null> // 원문 페이지에서 본문 추출 (네트워크, 본문을 못 찾으면 null)
    log: WorkerLog // 로그 남기기
}

/**
 * 기사 본문을 확보하고 저장한 기사를 보강하는 서비스
 */
export class EnrichmentService {
    constructor(private readonly deps: EnrichmentDeps) {}

    /**
     * 기사 본문 확보 (없으면 추출해서 보관)
     *
     * - 이미 보관된 본문이 있으면 그대로 돌려줌
     * - 추출에 실패해도 예외를 던지지 않고 수집한 글로 대신함
     *
     * @param itemRow - 기사 행 (번호 · 주소 · 종류 · 제목 · 수집한 글 · 출처 이름)
     * @returns {Promise<ContentRow>} 보관된 본문
     */
    async ensureContent(itemRow: Pick<ItemRow, 'id' | 'url' | 'kind' | 'title' | 'snippet' | 'sourceName'>): Promise<ContentRow> {
        const { itemRepository, log } = this.deps

        // 이미 본문이 있으면 그대로 사용
        const existingContentRow = itemRepository.findContentByItemId(itemRow.id)
        if (existingContentRow) return existingContentRow

        // 원문에서 뽑을 수 있는 기사면 추출 시도
        // 실패(접속 오류 · 403 · HTML 아님 등)는 기록만 남기고 아래에서 수집한 글로 대신함
        let extractedParagraphs: string[] | null = null // 원문에서 뽑은 문단 (추출하지 않았거나 실패하면 null)
        if (isExtractable(itemRow.url, itemRow.kind)) {
            try {
                extractedParagraphs = (await this.deps.extractArticle(itemRow.url))?.paragraphs ?? null
            } catch (extractError) {
                log('info', `본문 추출 실패(${itemRow.sourceName}): ${(extractError as Error).message}`)
            }
        }

        // 추출 성공 → 원문 본문으로 보관
        if (extractedParagraphs) this.storeContent(itemRow.id, extractedParagraphs, true)
        // 추출하지 않았거나 실패 → 수집한 글(없으면 제목)을 문단으로 나눠 보관하고 원문 본문이 아님을 표시
        else this.storeContent(itemRow.id, splitParagraphs(itemRow.snippet || itemRow.title), false)

        return itemRepository.findContentByItemId(itemRow.id)!
    }

    /**
     * 저장한 기사 한 건 보강 (본문 보관 + 태그 추천)
     *
     * - 저장한 기사인지 · 이미 보강했는지는 확인하지 않음 (부르는 Main이 판단)
     * - 본문 추출 · 태그 추천이 실패해도 예외를 던지지 않음
     * - 태그는 추천만 하고 붙이지 않음
     *
     * @param {number} itemId - 기사 번호
     * @returns {Promise<EnrichmentResult>} 본문을 새로 보관했는지와 추천한 태그 이름 (없는 기사면 아무것도 하지 않음)
     */
    async enrichItem(itemId: number): Promise<EnrichmentResult> {
        const { itemRepository, tagRepository, llmSessions, config, log } = this.deps

        // 기사가 없으면 할 일 없음
        const itemRow = itemRepository.findItemById(itemId)
        if (!itemRow) return { contentUpdated: false, suggestedTags: [] }

        // 1) 본문
        // 원문 본문이 아직 없고(본문이 없거나 수집한 글로 대신한 상태) 원문에서 뽑을 수 있는 기사면 추출
        let contentUpdated = false // 이번 보강에서 본문을 새로 보관했는지
        const existingContentRow = itemRepository.findContentByItemId(itemId)
        if (!existingContentRow?.fullText && isExtractable(itemRow.url, itemRow.kind)) {
            try {
                // 추출 성공 → 원문 본문으로 보관 (본문을 못 찾았으면 그대로 둠)
                const extractedArticle = await this.deps.extractArticle(itemRow.url)
                if (extractedArticle) {
                    this.storeContent(itemId, extractedArticle.paragraphs, true)
                    contentUpdated = true
                }
            } catch (extractError) {
                // 추출 실패(접속 오류 등) → 기록만 남기고 계속
                log('info', `저장 기사 본문 추출 실패(${itemRow.sourceName}): ${(extractError as Error).message}`)
            }
        }

        // 그래도 보관된 본문이 없으면 수집 때 받은 글을 한 문단으로 보관하고 원문 본문이 아님을 표시
        if (!itemRepository.findContentByItemId(itemId) && itemRow.snippet) {
            this.storeContent(itemId, [itemRow.snippet], false)
            contentUpdated = true
        }

        // 2) 태그 (이미 태그가 붙어 있으면 건너뜀, API 키가 없어도 건너뜀)
        let suggestedTags: string[] = [] // 추천한 태그 이름
        const llmSession = llmSessions.openSession(null) // 브리핑 실행 밖의 호출이라 실행 번호 없이 사용량만 기록
        if (llmSession && tagRepository.listTagNamesByItemId(itemId).length === 0) {
            try {
                // 기존 태그 이름 (많이 쓴 순 60개까지)
                const existingTagNames = tagRepository
                    .listTagCountsOnSavedItems()
                    .slice(0, MAX_EXISTING_TAGS)
                    .map((tagCount) => tagCount.name)

                // 보낼 내용: 기존 태그 목록 + 기사 제목과 요약 (요약이 없으면 수집한 글의 앞 600자)
                const userPrompt = [
                    `기존 태그: ${existingTagNames.length ? existingTagNames.join(', ') : '(없음)'}`,
                    '',
                    `원제: ${itemRow.title}`,
                    `한국어 제목: ${itemRow.titleKo ?? ''}`,
                    `요약: ${itemRow.summaryKo ?? itemRow.snippet.slice(0, TAG_PROMPT_SNIPPET_CHARS)}`
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
                const tagsResponse = await requestTags('triage').catch(() => requestTags('summary'))

                // 추천 태그는 앞에서 3개까지만
                suggestedTags = tagsResponse.tags.slice(0, MAX_SUGGESTED_TAGS)
            } catch (tagError) {
                // 두 번 다 실패 → 기록만 남기고 태그 없이 마침
                log('warn', `태그 추천 실패: ${(tagError as Error).message}`)
            }
        }

        return { contentUpdated, suggestedTags }
    }

    // 본문 보관 (이미 있으면 새 본문으로 바꾸고 이전 번역은 지워짐) + 검색 색인 갱신
    private storeContent(itemId: number, paragraphs: string[], fullText: boolean): void {
        const { database, itemRepository, searchRepository } = this.deps
        runInTransaction(database, () => {
            itemRepository.upsertContent(itemId, paragraphs, fullText)
            searchRepository.reindexItem(itemId)
        })
    }
}
