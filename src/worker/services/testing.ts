// ============================================================================
// Worker 서비스 테스트 도구
//
// [역할]
// - 서비스 테스트가 함께 쓰는 준비물 제공 (제품 코드에서는 쓰지 않음)
// - 메모리 DB에 실제 저장소를 붙인 묶음, 파일을 읽지 않는 테스트용 설정, 수집한 글 만들기
// - LLM만 가짜로 바꿈: 응답 형식 이름(선별 · 묶기 · 요약 등)별로 정해 둔 답을 돌려주고 호출을 기록
// ============================================================================
import type { z } from 'zod'
import type { AppConfig, ModelSpec } from '@config/index'
import type { AppDatabase } from '@data/client'
import { createDigestRepository } from '@data/repositories/digest-repository'
import { createItemRepository } from '@data/repositories/item-repository'
import { createLlmUsageRepository } from '@data/repositories/llm-usage-repository'
import { createRunRepository } from '@data/repositories/run-repository'
import { createSearchRepository } from '@data/repositories/search-repository'
import { createSettingsRepository } from '@data/repositories/settings-repository'
import { createSourceFetchRepository } from '@data/repositories/source-fetch-repository'
import { createTagRepository } from '@data/repositories/tag-repository'
import { openTestDatabase } from '@data/testing'
import type { RawItem } from '../collectors/types'
import type { ChatTurn } from '../llm/groq'
import type { LlmCaller, LlmSessionSource } from '../llm/service'

/**
 * 메모리 DB와 그 DB에 붙인 실제 저장소 묶음
 *
 * @returns DB 연결과 저장소들
 */
export function openTestRepositories() {
    const database: AppDatabase = openTestDatabase()
    return {
        database,
        itemRepository: createItemRepository(database),
        digestRepository: createDigestRepository(database),
        runRepository: createRunRepository(database),
        llmUsageRepository: createLlmUsageRepository(database),
        sourceFetchRepository: createSourceFetchRepository(database),
        settingsRepository: createSettingsRepository(database),
        tagRepository: createTagRepository(database),
        searchRepository: createSearchRepository(database)
    }
}

const testModelSpec = (model: string): ModelSpec => ({ model, maxCompletionTokens: 1000 }) // 테스트용 모델 설정

/**
 * 파일을 읽지 않는 테스트용 설정 (출처 하나, 프롬프트는 역할 이름만)
 *
 * @param {Partial<AppConfig>} overrides - 바꿀 항목
 * @returns {AppConfig} 테스트용 설정
 */
export function createTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
    const testSource = {
        id: 'feed',
        name: 'Test Feed',
        kind: 'news' as const,
        weight: 1,
        enabled: true,
        type: 'rss' as const,
        url: 'https://feed.test/rss',
        keywordFilter: false
    }
    return {
        sources: [testSource],
        allSources: [testSource],
        interests: [],
        models: {
            triage: testModelSpec('triage-model'),
            summary: testModelSpec('summary-model'),
            digest: testModelSpec('digest-model'),
            chat: testModelSpec('chat-model'),
            translate: testModelSpec('translate-model'),
            saveMode: { model: 'save-mode-model' }
        },
        pricing: {},
        prompts: {
            triage: 'triage',
            cluster: 'cluster',
            summary: 'summary',
            digest: 'digest',
            tags: 'tags',
            chatItem: 'chat-item',
            chatDigest: 'chat-digest',
            translate: 'translate',
            recent: 'recent'
        },
        quickActions: { item: [], digest: [] },
        ...overrides
    }
}

/**
 * 수집기가 넘기는 글 한 건 만들기
 *
 * @param {Partial<RawItem>} overrides - 바꿀 항목 (주소 · 제목은 테스트마다 다르게 넘김)
 * @returns {RawItem} 수집한 글
 */
export function createRawItem(overrides: Partial<RawItem> = {}): RawItem {
    return {
        sourceId: 'hn',
        sourceName: 'Hacker News',
        kind: 'community',
        title: 'Mistral Large 4 released',
        url: 'https://mistral.ai/news/large-4?utm_source=hn',
        publishedAt: new Date().toISOString(),
        snippet: '',
        engagement: 100,
        engagementLabel: 'HN 100점',
        lang: 'en',
        ...overrides
    }
}

// 가짜 LLM이 받은 호출 한 번
export interface FakeLlmCall {
    runId: number | null // 세션을 열 때 받은 실행 번호
    role: string // 호출 용도
    model: string // 호출한 모델
    schemaName: string // 응답 형식 이름 (스트리밍 답변이면 'stream')
    user: string // 사용자 메시지 (스트리밍 답변이면 마지막 메시지)
    chatTurns: ChatTurn[] // 스트리밍 답변에 보낸 대화 (JSON 호출이면 빈 목록)
}

// 가짜 LLM의 동작
export interface FakeLlmOptions {
    hasApiKey?: boolean // API 키가 있는 것처럼 동작할지 (기본 true)
    // 응답 형식 이름과 사용자 메시지를 받아 JSON 응답을 돌려줌 (던지면 그 호출이 실패)
    respondJson?(schemaName: string, userMessage: string, llmCall: FakeLlmCall): unknown
    streamedAnswer?: string // 스트리밍 답변으로 돌려줄 글 (두 조각으로 나눠 보냄)
}

/**
 * 가짜 LLM 세션을 여는 곳
 *
 * @param {FakeLlmOptions} options - 가짜 LLM의 동작
 * @returns 세션을 여는 곳(llmSessions)과 받은 호출 기록(calls)
 */
export function createFakeLlm(options: FakeLlmOptions = {}): { llmSessions: LlmSessionSource; calls: FakeLlmCall[] } {
    const calls: FakeLlmCall[] = []
    const hasApiKey = options.hasApiKey ?? true

    const openFakeSession = (runId: number | null): LlmCaller => ({
        tokensUsed: 0,
        async completeJson<T>(
            role: string,
            modelSpec: ModelSpec,
            prompt: { system: string; user: string },
            outputSchema: { name: string; jsonSchema: Record<string, unknown>; zod: z.ZodType<T> }
        ): Promise<T> {
            const llmCall: FakeLlmCall = {
                runId,
                role,
                model: modelSpec.model,
                schemaName: outputSchema.name,
                user: prompt.user,
                chatTurns: []
            }
            calls.push(llmCall)
            if (!options.respondJson) throw new Error(`가짜 LLM에 ${outputSchema.name} 응답이 없습니다.`)

            // 실제 호출처럼 응답을 zod로 검증
            return outputSchema.zod.parse(options.respondJson(outputSchema.name, prompt.user, llmCall))
        },
        async streamAnswer(role: string, modelSpec: ModelSpec, chatTurns: ChatTurn[], onDelta: (deltaText: string) => void) {
            calls.push({ runId, role, model: modelSpec.model, schemaName: 'stream', user: chatTurns.at(-1)?.content ?? '', chatTurns })

            // 답변을 두 조각으로 나눠 보냄
            const answerText = options.streamedAnswer ?? ''
            const halfLength = Math.ceil(answerText.length / 2)
            onDelta(answerText.slice(0, halfLength))
            onDelta(answerText.slice(halfLength))
            return answerText
        }
    })

    return {
        llmSessions: {
            hasApiKey: () => hasApiKey,
            openSession: (runId) => (hasApiKey ? openFakeSession(runId) : null)
        },
        calls
    }
}

/**
 * 한 줄에 JSON 하나씩 적힌 사용자 메시지에서 기사 번호(id) 꺼내기
 *
 * @param {string} userMessage - LLM에 보낸 사용자 메시지
 * @returns {number[]} 메시지에 적힌 순서대로의 기사 번호 (JSON이 아닌 줄은 건너뜀)
 */
export function readItemIdsFromPrompt(userMessage: string): number[] {
    return userMessage
        .split('\n')
        .filter((promptLine) => promptLine.startsWith('{'))
        .map((promptLine) => (JSON.parse(promptLine) as { id: number }).id)
}
