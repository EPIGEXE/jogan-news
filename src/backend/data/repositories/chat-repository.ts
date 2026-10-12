// ============================================================================
// 질문 대화 저장소
//
// [역할]
// - AI 질문 대화(chats)와 그 메시지(chat_messages)를 읽고 씀 (둘 다 Main이 쓰는 테이블)
// - 대화는 범위 키마다 하나 ('item:<기사 번호>' 또는 'digest:<날짜>', 키를 만드는 일은 서비스)
// - 메시지 목록은 화면용 모양(ChatMessageDTO)으로 돌려줌 (저장한 순서)
// - 대화별 질문 요약 조회 (질문 수 · 가장 최근 질문, 지난 질문 목록의 재료)
// - 대화를 지우면 메시지도 함께 지워짐 (외래 키 설정)
// - 규칙은 넣지 않음 (질문 범위와 키를 서로 바꾸기, 대화 준비와 메시지 저장을 한 묶음으로 실행하기는 서비스)
// ============================================================================
import { asc, count, desc, eq, max } from 'drizzle-orm'
import type { ChatMessageDTO } from '@shared/types'
import { nowIso, type AppDatabase } from '@data/client'
import { chatMessages, chats } from '@data/schema'

export type ChatRow = typeof chats.$inferSelect // 대화 한 행 (범위 키 · 만든 시각 · 마지막 변경 시각)
export type ChatMessageRole = ChatMessageDTO['role'] // user: 질문, assistant: 답변

// 새로 넣을 메시지
export interface NewChatMessage {
    chatId: number // 메시지가 들어갈 대화
    role: ChatMessageRole // 질문인지 답변인지
    content: string // 메시지 내용
    citations?: number[] // 답변이 인용한 번호 (안 넘기면 빈 목록)
    model?: string // 답변을 만든 모델 이름 (안 넘기면 null)
    createdAt?: string // 저장한 시각 (안 넘기면 지금)
}

// 대화 하나에서 내가 한 질문의 요약
export interface ChatQuestionSummary {
    scopeKey: string // 대화의 범위 키
    questionCount: number // 내가 한 질문 수 (답변은 세지 않음)
    lastQuestion: string // 가장 최근 질문의 내용
    lastAskedAt: string // 가장 최근 질문을 저장한 시각
}

export interface ChatRepository {
    findChatByScopeKey(scopeKey: string): ChatRow | null // 그 범위의 대화 (없으면 null)
    // 그 범위의 대화 준비 (없으면 만들고, 있으면 마지막 변경 시각만 바꿈) → 대화 번호
    upsertChat(scopeKey: string, touchedAt?: string): number
    deleteChatByScopeKey(scopeKey: string): void // 그 범위의 대화와 메시지 삭제 (대화가 없으면 아무 일도 없음)
    listChatMessagesByScopeKey(scopeKey: string): ChatMessageDTO[] // 그 범위의 메시지 (저장한 순서, 대화가 없으면 빈 배열)
    insertChatMessage(newChatMessage: NewChatMessage): ChatMessageDTO // 메시지 저장 → 저장한 메시지
    // 질문이 하나라도 있는 대화마다 질문 수와 가장 최근 질문 (최근에 질문한 대화부터, 답변만 있거나 빈 대화는 빠짐)
    listChatQuestionSummaries(): ChatQuestionSummary[]
}

/**
 * 질문 대화 저장소 생성
 *
 * @param {AppDatabase} database - DB 연결
 * @returns {ChatRepository} 질문 대화 저장소
 */
export function createChatRepository(database: AppDatabase): ChatRepository {
    return {
        findChatByScopeKey(scopeKey) {
            return database.select().from(chats).where(eq(chats.scopeKey, scopeKey)).get() ?? null
        },

        upsertChat(scopeKey, touchedAt = nowIso()) {
            // 처음이면 만든 시각 · 마지막 변경 시각을 같은 값으로, 이미 있으면 만든 시각은 그대로
            const upsertedChatRow = database
                .insert(chats)
                .values({ scopeKey, createdAt: touchedAt, updatedAt: touchedAt })
                .onConflictDoUpdate({ target: chats.scopeKey, set: { updatedAt: touchedAt } })
                .returning({ id: chats.id })
                .get()
            return upsertedChatRow.id
        },

        deleteChatByScopeKey(scopeKey) {
            database.delete(chats).where(eq(chats.scopeKey, scopeKey)).run()
        },

        listChatMessagesByScopeKey(scopeKey) {
            // 범위 키로 대화를 찾아 그 대화의 메시지만 조회 (메시지 번호가 저장한 순서)
            return database
                .select({
                    id: chatMessages.id,
                    role: chatMessages.role,
                    content: chatMessages.content,
                    citations: chatMessages.citations,
                    createdAt: chatMessages.createdAt
                })
                .from(chatMessages)
                .innerJoin(chats, eq(chats.id, chatMessages.chatId))
                .where(eq(chats.scopeKey, scopeKey))
                .orderBy(asc(chatMessages.id))
                .all()
                .map((chatMessageRow) => ({ ...chatMessageRow, role: chatMessageRow.role as ChatMessageRole }))
        },

        insertChatMessage(newChatMessage) {
            const citations = newChatMessage.citations ?? [] // 인용이 없으면 빈 목록
            const createdAt = newChatMessage.createdAt ?? nowIso()
            const messageInsertResult = database
                .insert(chatMessages)
                .values({
                    chatId: newChatMessage.chatId,
                    role: newChatMessage.role,
                    content: newChatMessage.content,
                    citations,
                    model: newChatMessage.model ?? null,
                    createdAt
                })
                .run()

            // 저장한 메시지를 화면용 모양으로 (모델 이름은 화면에 내보내지 않음)
            return {
                id: Number(messageInsertResult.lastInsertRowid),
                role: newChatMessage.role,
                content: newChatMessage.content,
                citations,
                createdAt
            }
        },

        listChatQuestionSummaries() {
            // 대화별로 질문(user)만 모아 개수와 가장 나중 질문의 번호를 구함 (메시지 번호가 저장한 순서)
            // 질문이 없는 대화는 여기서 행이 생기지 않아 결과에서 빠짐
            const questionStats = database
                .select({
                    chatId: chatMessages.chatId,
                    questionCount: count().as('question_count'),
                    lastQuestionId: max(chatMessages.id).as('last_question_id')
                })
                .from(chatMessages)
                .where(eq(chatMessages.role, 'user'))
                .groupBy(chatMessages.chatId)
                .as('question_stats')

            // 가장 나중 질문의 내용 · 시각과 대화의 범위 키를 붙임 (최근에 질문한 대화부터, 시각이 같으면 나중에 저장한 것부터)
            return database
                .select({
                    scopeKey: chats.scopeKey,
                    questionCount: questionStats.questionCount,
                    lastQuestion: chatMessages.content,
                    lastAskedAt: chatMessages.createdAt
                })
                .from(questionStats)
                .innerJoin(chats, eq(chats.id, questionStats.chatId))
                .innerJoin(chatMessages, eq(chatMessages.id, questionStats.lastQuestionId))
                .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
                .all()
        }
    }
}
