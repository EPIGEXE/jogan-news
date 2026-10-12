// ============================================================================
// AI 질문 서비스 테스트
//
// [역할]
// - 질문을 받기 전 확인(빈 질문 · API 키 없음 · 기사 · 브리핑 없음)에서 질문을 저장하지 않는지 확인
// - 질문 흐름: 질문 저장 후 바로 응답, Worker에 이전 대화 전달, 답변 조각 전달, 완료 시 답변 저장과 완료 알림
// - 답변 실패 시 오류 알림만 보내고 질문은 남기는지 확인
// - 대화가 범위(기사 · 브리핑 날짜)별로 쌓이고 지워지는지 확인
// - 지난 질문 목록: 기사 · 브리핑의 제목이 붙는지, 없어진 기사 · 브리핑의 대화가 빠지는지 확인
// - Worker는 가짜로 대신하고 저장소는 메모리 DB에 실제로 붙임
// ============================================================================
import { describe, expect, it, vi } from 'vitest'
import type { ChatScope, QuickActions } from '@shared/types'
import type { WorkerParams, WorkerResult } from '@shared/worker-protocol'
import { ChatService, chatScopeKey, parseChatScopeKey } from './chat-service'
import { createFakeEvents, createFakeWorker, createTestRepositories, insertTestItem } from './test-support'

const QUICK_ACTIONS: QuickActions = { item: [{ label: '요약', prompt: '세 줄로 요약해 줘' }], digest: [] }
const DIGEST_STATS = { sources: 1, collected: 1, candidates: 1, selected: 1, costUsd: 0, failedSources: [], saveMode: false }

type AnswerParams = WorkerParams<'answerQuestion'>
type Answer = WorkerResult<'answerQuestion'>

function setup(options: { apiKey?: string | null; answerQuestion?: (answerParams: AnswerParams) => Answer | Promise<Answer> } = {}) {
    const repositories = createTestRepositories()
    const events = createFakeEvents()
    const log = vi.fn()
    const fakeWorker = createFakeWorker({
        answerQuestion: options.answerQuestion ?? (() => ({ content: '새 모델이다 [¶2].', citations: [2], model: 'test-model' }))
    })
    const chatService = new ChatService({
        ...repositories,
        keys: { getApiKey: () => (options.apiKey === undefined ? 'gsk_test' : options.apiKey) },
        worker: fakeWorker.worker,
        events,
        quickActions: QUICK_ACTIONS,
        log
    })
    const itemId = insertTestItem(repositories.itemRepository)
    const itemScope: ChatScope = { kind: 'item', itemId }
    return { ...repositories, chatService, events, log, workerCall: fakeWorker.call, itemId, itemScope }
}

describe('ChatService', () => {
    it('범위를 대화 키로 바꾼다', () => {
        expect(chatScopeKey({ kind: 'item', itemId: 7 })).toBe('item:7')
        expect(chatScopeKey({ kind: 'digest', date: '2026-10-07' })).toBe('digest:2026-10-07')
    })

    it('대화 키를 범위로 되돌리고, 모양이 맞지 않는 키는 null로 돌려준다', () => {
        expect(parseChatScopeKey('item:7')).toEqual({ kind: 'item', itemId: 7 })
        expect(parseChatScopeKey('digest:2026-10-07')).toEqual({ kind: 'digest', date: '2026-10-07' })
        expect(parseChatScopeKey('item:abc')).toBeNull()
        expect(parseChatScopeKey('digest:어제')).toBeNull()
        expect(parseChatScopeKey('library:1')).toBeNull()
    })

    it('빈 질문 · API 키 없음 · 없는 기사 · 없는 브리핑은 질문을 저장하지 않고 거절한다', () => {
        const { chatService, itemScope, workerCall } = setup()
        expect(() => chatService.ask(itemScope, '   ')).toThrow('질문을 입력하세요.')
        expect(() => chatService.ask({ kind: 'item', itemId: 999 }, '핵심은?')).toThrow('기사를 찾을 수 없습니다.')
        expect(() => chatService.ask({ kind: 'digest', date: '2026-10-07' }, '꼭 읽을 것은?')).toThrow('그날 브리핑이 없습니다.')
        expect(chatService.getChatHistory(itemScope)).toEqual([])
        expect(workerCall).not.toHaveBeenCalled()

        const withoutKey = setup({ apiKey: null })
        expect(() => withoutKey.chatService.ask(withoutKey.itemScope, '핵심은?')).toThrow('Groq API 키가 없습니다')
        expect(withoutKey.chatService.getChatHistory(withoutKey.itemScope)).toEqual([])
    })

    it('질문을 저장하고 바로 돌려주며, 답변이 끝나면 저장하고 완료를 알린다', async () => {
        const { chatService, itemScope, events, workerCall } = setup()

        const { requestId, userMessage } = chatService.ask(itemScope, '  핵심은?  ')
        expect(userMessage).toMatchObject({ role: 'user', content: '핵심은?', citations: [] })
        expect(workerCall).toHaveBeenCalledWith('answerQuestion', { requestId, scope: itemScope, question: '핵심은?', history: [] })

        await vi.waitFor(() => expect(events.chatEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'done', requestId })))
        const chatMessages = chatService.getChatHistory(itemScope)
        expect(chatMessages.map((chatMessage) => [chatMessage.role, chatMessage.content, chatMessage.citations])).toEqual([
            ['user', '핵심은?', []],
            ['assistant', '새 모델이다 [¶2].', [2]]
        ])
        expect(events.chatEvent).toHaveBeenCalledWith({ type: 'done', requestId, message: chatMessages[1] })
    })

    it('답변 조각은 요청 번호와 함께 화면에 전달하고, 이전 대화는 이번 질문을 빼고 Worker에 넘긴다', async () => {
        let receivedHistory: AnswerParams['history'] = [] // 두 번째 질문 때 Worker가 받은 이전 대화
        const { chatService, itemScope, events } = setup({
            answerQuestion: (answerParams) => {
                receivedHistory = answerParams.history
                chatServiceUnderTest.forwardAnswerDelta(answerParams.requestId, '첫 조각')
                return { content: '답변', citations: [], model: 'test-model' }
            }
        })
        const chatServiceUnderTest = chatService

        const firstAsk = chatService.ask(itemScope, '첫 질문')
        await vi.waitFor(() => expect(events.chatEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'done' })))
        expect(events.chatEvent).toHaveBeenCalledWith({ type: 'delta', requestId: firstAsk.requestId, text: '첫 조각' })

        const secondAsk = chatService.ask(itemScope, '둘째 질문')
        expect(secondAsk.requestId).not.toBe(firstAsk.requestId)
        await vi.waitFor(() => expect(chatService.getChatHistory(itemScope)).toHaveLength(4))
        expect(receivedHistory.map((chatMessage) => [chatMessage.role, chatMessage.content])).toEqual([
            ['user', '첫 질문'],
            ['assistant', '답변']
        ])
    })

    it('답변에 실패하면 오류를 알리고 기록하며, 저장한 질문은 남긴다', async () => {
        const { chatService, itemScope, events, log } = setup({
            answerQuestion: () => {
                throw new Error('모델 응답 없음')
            }
        })

        const { requestId } = chatService.ask(itemScope, '핵심은?')
        await vi.waitFor(() => expect(events.chatEvent).toHaveBeenCalledWith({ type: 'error', requestId, message: '모델 응답 없음' }))
        expect(log).toHaveBeenCalledWith('chat-failed', expect.stringContaining('모델 응답 없음'))
        expect(chatService.getChatHistory(itemScope).map((chatMessage) => chatMessage.role)).toEqual(['user'])
    })

    it('대화는 범위(기사 · 브리핑 날짜)별로 쌓이고, 지우면 그 범위만 지워진다', async () => {
        const { chatService, itemScope, itemId, digestRepository } = setup()
        const digestId = digestRepository.insertDigest('2026-10-07', { headline: '오늘', overview: null, stats: DIGEST_STATS })
        digestRepository.insertEntries(digestId, [{ itemId, rank: 1, section: 'top', whyItMatters: null }])
        const digestScope: ChatScope = { kind: 'digest', date: '2026-10-07' }

        chatService.ask(itemScope, '핵심은?')
        chatService.ask(digestScope, '꼭 읽을 것은?')
        await vi.waitFor(() => expect(chatService.getChatHistory(itemScope)).toHaveLength(2))
        await vi.waitFor(() => expect(chatService.getChatHistory(digestScope)).toHaveLength(2))

        chatService.clearChat(itemScope)
        expect(chatService.getChatHistory(itemScope)).toEqual([])
        expect(chatService.getChatHistory(digestScope)).toHaveLength(2)
    })

    it('지난 질문 목록: 기사는 한국어 제목(없으면 원제)과 출처, 브리핑은 그날의 한 줄을 붙여 최근에 질문한 것부터 돌려준다', () => {
        const { chatService, chatRepository, itemRepository, digestRepository, itemId } = setup()
        expect(chatService.listChatHistory()).toEqual([])

        // 요약을 마쳐 한국어 제목이 있는 기사
        const summarizedItemId = insertTestItem(itemRepository, { sourceName: 'Mistral Blog' })
        itemRepository.updateItemSummary(
            summarizedItemId,
            { titleKo: '미스트랄 라지 4 공개', summaryKo: '요약', keyPoints: [], whyKo: '' },
            'test-model'
        )
        const digestId = digestRepository.insertDigest('2026-10-07', {
            headline: '새 모델이 쏟아진 날',
            overview: null,
            stats: DIGEST_STATS
        })
        digestRepository.insertEntries(digestId, [{ itemId, rank: 1, section: 'top', whyItMatters: null }])

        // 질문한 순서: 요약 전 기사 → 브리핑 → 요약한 기사 (질문 2개)
        const untitledChatId = chatRepository.upsertChat(chatScopeKey({ kind: 'item', itemId }))
        chatRepository.insertChatMessage({
            chatId: untitledChatId,
            role: 'user',
            content: '핵심은?',
            createdAt: '2026-10-07T01:00:00.000Z'
        })
        const digestChatId = chatRepository.upsertChat('digest:2026-10-07')
        chatRepository.insertChatMessage({
            chatId: digestChatId,
            role: 'user',
            content: '꼭 읽을 것은?',
            createdAt: '2026-10-07T02:00:00.000Z'
        })
        const summarizedChatId = chatRepository.upsertChat(chatScopeKey({ kind: 'item', itemId: summarizedItemId }))
        chatRepository.insertChatMessage({
            chatId: summarizedChatId,
            role: 'user',
            content: '가격은?',
            createdAt: '2026-10-07T03:00:00.000Z'
        })
        chatRepository.insertChatMessage({
            chatId: summarizedChatId,
            role: 'assistant',
            content: '미정이다.',
            createdAt: '2026-10-07T03:00:05.000Z'
        })
        chatRepository.insertChatMessage({
            chatId: summarizedChatId,
            role: 'user',
            content: '한계는?',
            createdAt: '2026-10-07T04:00:00.000Z'
        })

        expect(chatService.listChatHistory()).toEqual([
            {
                scope: { kind: 'item', itemId: summarizedItemId },
                title: '미스트랄 라지 4 공개',
                sourceName: 'Mistral Blog',
                questionCount: 2,
                lastQuestion: '한계는?',
                lastAskedAt: '2026-10-07T04:00:00.000Z'
            },
            {
                scope: { kind: 'digest', date: '2026-10-07' },
                title: '새 모델이 쏟아진 날',
                sourceName: null,
                questionCount: 1,
                lastQuestion: '꼭 읽을 것은?',
                lastAskedAt: '2026-10-07T02:00:00.000Z'
            },
            {
                scope: { kind: 'item', itemId },
                title: 'Mistral Large 4 released',
                sourceName: 'Hacker News',
                questionCount: 1,
                lastQuestion: '핵심은?',
                lastAskedAt: '2026-10-07T01:00:00.000Z'
            }
        ])
    })

    it('지난 질문 목록: 기사 · 브리핑이 없어진 대화와 모양이 맞지 않는 키의 대화는 빠진다', () => {
        const { chatService, chatRepository, itemScope } = setup()
        for (const scopeKey of [chatScopeKey(itemScope), 'item:999', 'digest:2026-10-07', 'library:1']) {
            const chatId = chatRepository.upsertChat(scopeKey)
            chatRepository.insertChatMessage({ chatId, role: 'user', content: '핵심은?' })
        }

        expect(chatService.listChatHistory().map((chatHistoryEntry) => chatHistoryEntry.scope)).toEqual([itemScope])
    })

    it('빠른 질문 목록은 설정 파일의 것을 그대로 돌려준다', () => {
        const { chatService } = setup()
        expect(chatService.getQuickActions()).toEqual(QUICK_ACTIONS)
    })
})
