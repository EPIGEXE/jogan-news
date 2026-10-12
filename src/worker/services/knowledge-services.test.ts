// ============================================================================
// 보강 · 번역 · 질문 답변 서비스 테스트
//
// [역할]
// - 메모리 DB에 실제 저장소를 붙여 세 서비스의 규칙 확인 (원문 추출과 LLM만 가짜)
// - 보강: 본문을 보관하고 태그는 추천만 함 (태그 · 저장 표시는 쓰지 않음)
// - 번역: 번역이 필요한 기사만, 같은 기사는 한 번에 하나만, 키 없음 · 하루 상한 · 실패는 false
// - 질문 답변: 근거 만들기, 최근 대화만 넘기기, 인용 정리, 답변을 저장하지 않고 돌려주기
// ============================================================================
import { describe, expect, it } from 'vitest'
import { chatMessages, itemTags, saves, tags } from '@data/schema'
import type { ChatMessageDTO } from '@shared/types'
import type { ExtractedArticle } from '../knowledge/extract'
import { ChatAnswerService } from './chat-answer-service'
import { CollectService } from './collect-service'
import { EnrichmentService } from './enrichment-service'
import { createFakeLlm, createRawItem, createTestConfig, openTestRepositories, type FakeLlmOptions } from './testing'
import { TranslationService } from './translation-service'

// 원문에서 뽑은 것처럼 돌려줄 본문
const extracted = (paragraphs: string[]): ExtractedArticle => ({ paragraphs }) as ExtractedArticle

// 세 서비스와 저장소 준비 (원문 추출 결과와 LLM 응답은 테스트가 정함)
function setUp(options: { extractArticle?: (url: string) => Promise<ExtractedArticle | null>; llm?: FakeLlmOptions } = {}) {
    const repositories = openTestRepositories()
    const config = createTestConfig()
    const logMessages: string[] = []
    const log = (_level: string, logMessage: string) => void logMessages.push(logMessage)
    const fakeLlm = createFakeLlm(options.llm)
    const chatDeltas: [string, string][] = []

    const collectService = new CollectService({
        ...repositories,
        config,
        collectSource: async () => [],
        isBriefingRunning: () => false,
        log
    })
    const enrichmentService = new EnrichmentService({
        ...repositories,
        llmSessions: fakeLlm.llmSessions,
        config,
        extractArticle: options.extractArticle ?? (async () => null),
        log
    })
    const translationService = new TranslationService({
        ...repositories,
        llmSessions: fakeLlm.llmSessions,
        config,
        ensureContent: (itemRow) => enrichmentService.ensureContent(itemRow),
        log
    })
    const chatAnswerService = new ChatAnswerService({
        ...repositories,
        llmSessions: fakeLlm.llmSessions,
        config,
        onChatDelta: (requestId, deltaText) => chatDeltas.push([requestId, deltaText]),
        log
    })
    // 기사 한 건 넣기 → 기사 번호
    const addItem = (overrides: Parameters<typeof createRawItem>[0] = {}) => collectService.storeRawItem(createRawItem(overrides)).itemId
    return { ...repositories, enrichmentService, translationService, chatAnswerService, fakeLlm, chatDeltas, logMessages, addItem }
}

describe('저장한 기사 보강', () => {
    it('원문 본문을 보관하고 태그는 3개까지 추천만 한다 (태그 · 저장 표시는 쓰지 않음)', async () => {
        const { enrichmentService, itemRepository, database, addItem } = setUp({
            extractArticle: async () => extracted(['첫 문단', '둘째 문단']),
            llm: { respondJson: () => ({ tags: ['MCP', 'agent', 'open weight', 'extra'] }) }
        })
        const itemId = addItem({ kind: 'news' })

        const enrichmentResult = await enrichmentService.enrichItem(itemId)

        expect(enrichmentResult).toEqual({ contentUpdated: true, suggestedTags: ['MCP', 'agent', 'open weight'] })
        expect(itemRepository.findContentByItemId(itemId)).toMatchObject({ paragraphs: ['첫 문단', '둘째 문단'], fullText: true })
        expect(database.select().from(tags).all()).toEqual([])
        expect(database.select().from(itemTags).all()).toEqual([])
        expect(database.select().from(saves).all()).toEqual([])
    })

    it('수집한 글로 대신한 본문은 원문 본문으로 바꾸고(번역은 지워짐), 원문 본문이 있으면 다시 추출하지 않는다', async () => {
        let extractCallCount = 0
        const { enrichmentService, itemRepository, addItem } = setUp({
            extractArticle: async () => {
                extractCallCount++
                return extracted(['원문 문단'])
            }
        })
        const itemId = addItem({ kind: 'news' })
        itemRepository.upsertContent(itemId, ['소개 글'], false)
        itemRepository.updateContentTranslation(itemId, ['소개 글 번역'], 'translate-model')

        expect((await enrichmentService.enrichItem(itemId)).contentUpdated).toBe(true)
        expect(itemRepository.findContentByItemId(itemId)).toMatchObject({ paragraphs: ['원문 문단'], fullText: true, paragraphsKo: null })

        expect((await enrichmentService.enrichItem(itemId)).contentUpdated).toBe(false)
        expect(extractCallCount).toBe(1)
    })

    it('추출에 실패했고 보관된 본문도 없으면 수집한 글을 본문 대신 보관한다', async () => {
        const { enrichmentService, itemRepository, addItem } = setUp({
            extractArticle: async () => {
                throw new Error('HTTP 403')
            }
        })
        const itemId = addItem({ kind: 'news', snippet: '수집한 소개 글' })

        expect(await enrichmentService.enrichItem(itemId)).toEqual({ contentUpdated: true, suggestedTags: [] })
        expect(itemRepository.findContentByItemId(itemId)).toMatchObject({ paragraphs: ['수집한 소개 글'], fullText: false })
    })

    it('이미 태그가 붙은 기사 · API 키가 없을 때 · 추천이 실패했을 때는 태그를 추천하지 않는다', async () => {
        // 이미 태그가 붙은 기사
        const tagged = setUp({ llm: { respondJson: () => ({ tags: ['mcp'] }) } })
        const taggedItemId = tagged.addItem()
        tagged.tagRepository.insertTagIfAbsent('agent')
        tagged.tagRepository.insertItemTagIfAbsent(taggedItemId, tagged.tagRepository.findTagByName('agent')!.id, 'user')
        expect((await tagged.enrichmentService.enrichItem(taggedItemId)).suggestedTags).toEqual([])
        expect(tagged.fakeLlm.calls).toEqual([])

        // API 키 없음
        const withoutKey = setUp({ llm: { hasApiKey: false } })
        expect((await withoutKey.enrichmentService.enrichItem(withoutKey.addItem())).suggestedTags).toEqual([])

        // 두 모델 모두 실패 → 작은 모델, 큰 모델 순으로 한 번씩 시도하고 빈 목록
        const failing = setUp({
            llm: {
                respondJson: () => {
                    throw new Error('LLM 오류')
                }
            }
        })
        expect((await failing.enrichmentService.enrichItem(failing.addItem())).suggestedTags).toEqual([])
        expect(failing.fakeLlm.calls.map((llmCall) => llmCall.model)).toEqual(['triage-model', 'summary-model'])
    })

    it('없는 기사는 아무것도 하지 않는다', async () => {
        const { enrichmentService } = setUp()
        expect(await enrichmentService.enrichItem(9999)).toEqual({ contentUpdated: false, suggestedTags: [] })
    })

    it('본문 확보: 논문은 추출하지 않고 수집한 초록을 문단으로 나눠 보관하고, 이미 있으면 그대로 돌려준다', async () => {
        let extractCallCount = 0
        const { enrichmentService, itemRepository, addItem } = setUp({
            extractArticle: async () => {
                extractCallCount++
                return extracted(['원문'])
            }
        })
        const itemId = addItem({ kind: 'paper', snippet: '초록 첫 문단\n\n초록 둘째 문단' })
        const itemRow = itemRepository.findItemById(itemId)!

        expect(await enrichmentService.ensureContent(itemRow)).toMatchObject({
            paragraphs: ['초록 첫 문단', '초록 둘째 문단'],
            fullText: false
        })
        expect((await enrichmentService.ensureContent(itemRow)).paragraphs).toHaveLength(2)
        expect(extractCallCount).toBe(0)
    })
})

describe('본문 번역', () => {
    // 요청한 문단마다 번역을 돌려주는 응답
    const translateAll = (_schemaName: string, userMessage: string) => ({
        paragraphs: userMessage
            .split('\n')
            .filter((promptLine) => promptLine.startsWith('{'))
            .map((promptLine) => ({
                n: (JSON.parse(promptLine) as { n: number }).n,
                ko: `번역 ${(JSON.parse(promptLine) as { n: number }).n}`
            }))
    })

    it('본문을 확보해 문단별로 번역하고 검색에 걸리게 한다. 이미 번역했으면 다시 하지 않는다', async () => {
        const { translationService, itemRepository, database, fakeLlm, addItem } = setUp({
            extractArticle: async () => extracted(['First paragraph.', 'Second paragraph.']),
            llm: { respondJson: translateAll }
        })
        const itemId = addItem({ kind: 'news' })

        expect(await translationService.translateItem(itemId)).toBe(true)
        expect(itemRepository.findContentByItemId(itemId)).toMatchObject({
            paragraphsKo: ['번역 1', '번역 2'],
            translateModel: 'translate-model'
        })
        expect(database.$client.prepare('SELECT rowid FROM search_fts WHERE search_fts MATCH \'"번역 2"\'').all()).toEqual([
            { rowid: itemId }
        ])

        expect(await translationService.translateItem(itemId)).toBe(false)
        expect(fakeLlm.calls).toHaveLength(1)
    })

    it('한국어 기사 · 없는 기사는 번역하지 않는다', async () => {
        const { translationService, fakeLlm, addItem } = setUp({ llm: { respondJson: translateAll } })
        const koreanItemId = addItem({ title: '앤트로픽이 새 모델을 공개했다', snippet: '오늘 발표된 모델은…', lang: null })

        expect(await translationService.translateItem(koreanItemId)).toBe(false)
        expect(await translationService.translateItem(9999)).toBe(false)
        expect(fakeLlm.calls).toEqual([])
    })

    it('같은 기사를 번역하는 중이면 진행 중인 번역의 결과를 돌려준다', async () => {
        const { translationService, fakeLlm, addItem } = setUp({
            extractArticle: async () => extracted(['Only paragraph.']),
            llm: { respondJson: translateAll }
        })
        const itemId = addItem({ kind: 'news' })

        const firstTranslation = translationService.translateItem(itemId)
        const secondTranslation = translationService.translateItem(itemId)

        expect(secondTranslation).toBe(firstTranslation)
        expect(await Promise.all([firstTranslation, secondTranslation])).toEqual([true, true])
        expect(fakeLlm.calls).toHaveLength(1)
    })

    it('API 키가 없거나 하루 상한에 닿았으면 번역하지 않는다', async () => {
        const withoutKey = setUp({ llm: { hasApiKey: false } })
        expect(await withoutKey.translationService.translateItem(withoutKey.addItem())).toBe(false)

        const capped = setUp({ llm: { respondJson: translateAll } })
        capped.llmUsageRepository.insertUsage({
            runId: null,
            role: 'chat',
            model: 'chat-model',
            usage: { input: 1, cachedInput: 0, output: 1, reasoning: 0 },
            latencyMs: 1,
            costUsd: 0.5
        })
        expect(await capped.translationService.translateItem(capped.addItem())).toBe(false)
        expect(capped.fakeLlm.calls).toEqual([])
    })

    it('번역 요청이 실패하면 false로 끝내고 번역을 보관하지 않으며, 다음 요청은 다시 시도한다', async () => {
        const { translationService, itemRepository, fakeLlm, logMessages, addItem } = setUp({
            extractArticle: async () => extracted(['Only paragraph.']),
            llm: {
                respondJson: () => {
                    throw new Error('LLM 오류')
                }
            }
        })
        const itemId = addItem({ kind: 'news' })

        expect(await translationService.translateItem(itemId)).toBe(false)
        expect(itemRepository.findContentByItemId(itemId)!.paragraphsKo).toBeNull()
        expect(logMessages).toContain('번역 실패: LLM 오류')

        // 묶음마다 한 번 더 시도하므로 요청 한 번에 호출 2번
        await translationService.translateItem(itemId)
        expect(fakeLlm.calls).toHaveLength(4)
    })
})

describe('질문 답변', () => {
    // 대화 메시지 만들기
    const chatMessage = (id: number, role: ChatMessageDTO['role'], content: string): ChatMessageDTO => ({
        id,
        role,
        content,
        citations: [],
        createdAt: new Date().toISOString()
    })

    it('기사 본문을 근거로 답하고, 조각을 알리고, 근거에 있는 인용만 남겨 돌려준다 (대화는 저장하지 않음)', async () => {
        const { chatAnswerService, itemRepository, database, fakeLlm, chatDeltas, addItem } = setUp({
            llm: { streamedAnswer: '새 모델이다 [¶2]. 근거 없는 말 [¶9].' }
        })
        const itemId = addItem()
        itemRepository.upsertContent(itemId, ['First paragraph.', 'Second paragraph.'], true)

        const chatAnswer = await chatAnswerService.answerQuestion({
            requestId: 'request-1',
            scope: { kind: 'item', itemId },
            question: '  핵심은?  ',
            history: [chatMessage(1, 'user', '이전 질문'), chatMessage(2, 'assistant', '이전 답')]
        })

        expect(chatAnswer).toEqual({ content: '새 모델이다 [¶2]. 근거 없는 말.', citations: [2], model: 'chat-model' })
        expect(chatDeltas.map(([requestId]) => requestId)).toEqual(['request-1', 'request-1'])
        expect(chatDeltas.map(([, deltaText]) => deltaText).join('')).toBe('새 모델이다 [¶2]. 근거 없는 말 [¶9].')
        expect(database.select().from(chatMessages).all()).toEqual([])

        // 보낸 대화: 규칙 + 근거 → 이전 대화 → 새 질문
        const { chatTurns } = fakeLlm.calls[0]!
        expect(chatTurns.map((chatTurn) => chatTurn.role)).toEqual(['system', 'user', 'assistant', 'user'])
        expect(chatTurns[0]!.content).toContain('[¶1] First paragraph.\n\n[¶2] Second paragraph.')
        expect(chatTurns.at(-1)!.content).toBe('핵심은?')
    })

    it('이전 대화는 최근 20개까지만 넘긴다', async () => {
        const { chatAnswerService, fakeLlm, addItem } = setUp({ llm: { streamedAnswer: '답' } })
        const history = Array.from({ length: 30 }, (_unused, messageIndex) =>
            chatMessage(messageIndex + 1, messageIndex % 2 === 0 ? 'user' : 'assistant', `메시지 ${messageIndex + 1}`)
        )

        await chatAnswerService.answerQuestion({
            requestId: 'request-1',
            scope: { kind: 'item', itemId: addItem() },
            question: '질문',
            history
        })

        const { chatTurns } = fakeLlm.calls[0]!
        expect(chatTurns).toHaveLength(22)
        expect(chatTurns[1]!.content).toBe('메시지 11')
        expect(chatTurns[20]!.content).toBe('메시지 30')
    })

    it('브리핑 채팅은 그날 실린 기사의 순위를 근거로 쓴다', async () => {
        const { chatAnswerService, digestRepository, fakeLlm, addItem } = setUp({
            llm: { streamedAnswer: '꼭 읽을 것 [#1], 없는 순위 [#5]' }
        })
        const digestId = digestRepository.insertDigest('2026-10-07', {
            headline: '오늘의 한 줄',
            overview: null,
            stats: { sources: 1, collected: 1, candidates: 1, selected: 1, costUsd: 0, failedSources: [], saveMode: false }
        })
        digestRepository.insertEntries(digestId, [{ itemId: addItem(), rank: 1, section: 'top', whyItMatters: '중요한 이유' }])

        const chatAnswer = await chatAnswerService.answerQuestion({
            requestId: 'request-1',
            scope: { kind: 'digest', date: '2026-10-07' },
            question: '꼭 읽을 것은?',
            history: []
        })

        expect(chatAnswer.citations).toEqual([1])
        expect(fakeLlm.calls[0]!.chatTurns[0]!.content).toContain('--- 2026-10-07 브리핑: 오늘의 한 줄 ---\n[#1] Mistral Large 4 released')
        expect(fakeLlm.calls[0]!.chatTurns[0]!.content).toContain('왜 중요한가: 중요한 이유')
    })

    it('답변이 비었으면 안내 문구를 돌려준다', async () => {
        const { chatAnswerService, addItem } = setUp({ llm: { streamedAnswer: '  ' } })

        const chatAnswer = await chatAnswerService.answerQuestion({
            requestId: 'request-1',
            scope: { kind: 'item', itemId: addItem() },
            question: '질문',
            history: []
        })

        expect(chatAnswer.content).toBe('답변을 만들지 못했습니다. 다시 질문해 주세요.')
    })

    it('빈 질문 · API 키 없음 · 없는 기사 · 없는 브리핑은 오류', async () => {
        const { chatAnswerService, addItem } = setUp({ llm: { streamedAnswer: '답' } })
        const ask = (scope: Parameters<ChatAnswerService['answerQuestion']>[0]['scope'], question = '질문') =>
            chatAnswerService.answerQuestion({ requestId: 'request-1', scope, question, history: [] })

        await expect(ask({ kind: 'item', itemId: addItem() }, '   ')).rejects.toThrow('질문을 입력하세요.')
        await expect(ask({ kind: 'item', itemId: 9999 })).rejects.toThrow('기사를 찾을 수 없습니다.')
        await expect(ask({ kind: 'digest', date: '2026-10-07' })).rejects.toThrow('그날 브리핑이 없습니다.')

        const withoutKey = setUp({ llm: { hasApiKey: false } })
        await expect(
            withoutKey.chatAnswerService.answerQuestion({
                requestId: 'request-1',
                scope: { kind: 'item', itemId: withoutKey.addItem() },
                question: '질문',
                history: []
            })
        ).rejects.toThrow('Groq API 키가 없습니다')
    })

    it('이번 달 사용액이 월 예산 이상이면 절약 모드 모델로 답한다', async () => {
        const { chatAnswerService, llmUsageRepository, addItem } = setUp({ llm: { streamedAnswer: '답' } })
        llmUsageRepository.insertUsage({
            runId: null,
            role: 'summary',
            model: 'summary-model',
            usage: { input: 1, cachedInput: 0, output: 1, reasoning: 0 },
            latencyMs: 1,
            costUsd: 5
        })

        const chatAnswer = await chatAnswerService.answerQuestion({
            requestId: 'request-1',
            scope: { kind: 'item', itemId: addItem() },
            question: '질문',
            history: []
        })

        expect(chatAnswer.model).toBe('save-mode-model')
    })
})
