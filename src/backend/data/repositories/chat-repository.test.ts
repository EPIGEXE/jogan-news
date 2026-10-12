// ============================================================================
// 질문 대화 저장소 테스트
//
// [역할]
// - 메모리 DB에 실제 쿼리를 돌려 대화 준비 · 메시지 저장 · 조회 · 삭제 확인
// - 범위 키별로 따로 쌓이는지, 저장한 순서로 나오는지, 대화를 지우면 그 범위의 메시지만 지워지는지
// ============================================================================
import { describe, expect, it } from 'vitest'
import { chatMessages } from '@data/schema'
import { openTestDatabase } from '@data/testing'
import { createChatRepository } from './chat-repository'

const ITEM_SCOPE_KEY = 'item:1' // 기사 하나에 대한 대화의 범위 키
const DIGEST_SCOPE_KEY = 'digest:2026-10-07' // 그날 브리핑에 대한 대화의 범위 키

describe('chat-repository', () => {
    it('대화 준비: 없으면 만들고, 있으면 같은 번호를 돌려주며 마지막 변경 시각만 바꾼다', () => {
        const chatRepository = createChatRepository(openTestDatabase())
        expect(chatRepository.findChatByScopeKey(ITEM_SCOPE_KEY)).toBeNull()

        const chatId = chatRepository.upsertChat(ITEM_SCOPE_KEY, '2026-10-07T01:00:00.000Z')
        expect(chatRepository.findChatByScopeKey(ITEM_SCOPE_KEY)).toEqual({
            id: chatId,
            scopeKey: ITEM_SCOPE_KEY,
            createdAt: '2026-10-07T01:00:00.000Z',
            updatedAt: '2026-10-07T01:00:00.000Z'
        })

        expect(chatRepository.upsertChat(ITEM_SCOPE_KEY, '2026-10-08T01:00:00.000Z')).toBe(chatId)
        expect(chatRepository.findChatByScopeKey(ITEM_SCOPE_KEY)).toMatchObject({
            createdAt: '2026-10-07T01:00:00.000Z',
            updatedAt: '2026-10-08T01:00:00.000Z'
        })

        // 다른 범위는 다른 대화
        expect(chatRepository.upsertChat(DIGEST_SCOPE_KEY)).not.toBe(chatId)
    })

    it('메시지 저장: 저장한 메시지를 돌려주고, 인용 · 모델 · 시각을 안 넘기면 빈 목록 · null · 지금 시각으로 채운다', () => {
        const database = openTestDatabase()
        const chatRepository = createChatRepository(database)
        const chatId = chatRepository.upsertChat(ITEM_SCOPE_KEY)

        const beforeIso = new Date().toISOString()
        const question = chatRepository.insertChatMessage({ chatId, role: 'user', content: '핵심은?' })
        expect(question).toMatchObject({ role: 'user', content: '핵심은?', citations: [] })
        expect(question.createdAt >= beforeIso).toBe(true)

        const answer = chatRepository.insertChatMessage({
            chatId,
            role: 'assistant',
            content: '새 모델이다 [¶2].',
            citations: [2],
            model: 'test-model',
            createdAt: '2026-10-07T01:00:00.000Z'
        })
        expect(answer).toEqual({
            id: answer.id,
            role: 'assistant',
            content: '새 모델이다 [¶2].',
            citations: [2],
            createdAt: '2026-10-07T01:00:00.000Z'
        })
        expect(answer.id).toBeGreaterThan(question.id)

        // 모델 이름은 행에만 남음 (화면용 모양에는 없음)
        expect(
            database
                .select({ model: chatMessages.model })
                .from(chatMessages)
                .all()
                .map((chatMessageRow) => chatMessageRow.model)
        ).toEqual([null, 'test-model'])
    })

    it('메시지 조회: 범위별로 따로 쌓이고, 저장한 순서대로 인용과 함께 돌려준다', () => {
        const chatRepository = createChatRepository(openTestDatabase())
        expect(chatRepository.listChatMessagesByScopeKey(ITEM_SCOPE_KEY)).toEqual([])

        const itemChatId = chatRepository.upsertChat(ITEM_SCOPE_KEY)
        const digestChatId = chatRepository.upsertChat(DIGEST_SCOPE_KEY)
        const question = chatRepository.insertChatMessage({ chatId: itemChatId, role: 'user', content: '핵심은?' })
        chatRepository.insertChatMessage({ chatId: digestChatId, role: 'user', content: '꼭 읽을 것은?' })
        // 시각이 앞선 메시지를 나중에 넣어도 넣은 순서대로 나옴
        const answer = chatRepository.insertChatMessage({
            chatId: itemChatId,
            role: 'assistant',
            content: '새 모델이다 [¶2].',
            citations: [2],
            model: 'test-model',
            createdAt: '2020-01-01T00:00:00.000Z'
        })

        expect(chatRepository.listChatMessagesByScopeKey(ITEM_SCOPE_KEY)).toEqual([question, answer])
        expect(chatRepository.listChatMessagesByScopeKey(DIGEST_SCOPE_KEY).map((chatMessage) => chatMessage.content)).toEqual([
            '꼭 읽을 것은?'
        ])
    })

    it('대화 삭제: 그 범위의 대화와 메시지만 지우고, 없는 범위를 지워도 아무 일도 없다', () => {
        const database = openTestDatabase()
        const chatRepository = createChatRepository(database)
        const itemChatId = chatRepository.upsertChat(ITEM_SCOPE_KEY)
        const digestChatId = chatRepository.upsertChat(DIGEST_SCOPE_KEY)
        chatRepository.insertChatMessage({ chatId: itemChatId, role: 'user', content: '핵심은?' })
        chatRepository.insertChatMessage({ chatId: itemChatId, role: 'assistant', content: '새 모델이다.' })
        chatRepository.insertChatMessage({ chatId: digestChatId, role: 'user', content: '꼭 읽을 것은?' })

        chatRepository.deleteChatByScopeKey(ITEM_SCOPE_KEY)
        chatRepository.deleteChatByScopeKey('item:999')
        expect(chatRepository.findChatByScopeKey(ITEM_SCOPE_KEY)).toBeNull()
        expect(chatRepository.listChatMessagesByScopeKey(ITEM_SCOPE_KEY)).toEqual([])
        expect(chatRepository.listChatMessagesByScopeKey(DIGEST_SCOPE_KEY)).toHaveLength(1)
        // 지운 대화의 메시지 행도 남아 있지 않음 (외래 키 설정으로 함께 삭제)
        expect(database.select().from(chatMessages).all()).toHaveLength(1)
    })

    it('없는 대화에는 메시지를 넣을 수 없다 (외래 키)', () => {
        const chatRepository = createChatRepository(openTestDatabase())
        expect(() => chatRepository.insertChatMessage({ chatId: 999, role: 'user', content: '핵심은?' })).toThrow()
    })
})
