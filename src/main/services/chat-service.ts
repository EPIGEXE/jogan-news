// ============================================================================
// AI 질문 서비스
//
// [역할]
// - 대화 조회 · 질문 · 대화 삭제 · 지난 질문 목록 · 빠른 질문 목록 (대화는 범위별로 따로: 기사 하나 또는 그날 브리핑)
// - 대화를 찾는 키: 'item:<기사 번호>' 또는 'digest:<날짜>'
// - 질문을 받기 전 확인: 빈 질문, API 키 없음, 근거가 될 기사 · 브리핑 없음이면 질문을 저장하지 않고 오류
// - 질문은 저장하고 바로 돌려줌 (요청 번호와 저장된 내 질문), 답변 생성은 Worker에 맡기고 기다리지 않음
// - 질문마다 요청 번호(requestId)를 붙여, 화면이 자기 질문의 답변 조각만 골라 받게 함
// - 답변 조각: Worker가 보내는 대로 화면에 전달
// - 답변 완료: 답변을 대화에 저장하고 저장된 메시지와 함께 완료 알림
// - 답변 실패: 오류 알림만 보냄 (저장한 질문은 남김)
// - 지난 질문 목록: 질문한 적 있는 기사 · 브리핑을 최근에 질문한 것부터, 기사 · 브리핑이 없어진 대화는 뺌
// - 질문해도 기사를 저장하지 않음 (질문은 관심 표시가 아님, 질문한 기사는 지난 질문 목록으로 다시 찾음)
// - 답변을 만드는 일(근거 조립 · 모델 호출 · 인용 정리)은 Worker가 담당
// ============================================================================
import { randomUUID } from 'node:crypto'
import type { ChatHistoryEntryDTO, ChatMessageDTO, ChatScope, QuickActions } from '@shared/types'
import { nowIso, runInTransaction, type AppDatabase } from '@data/client'
import type { ChatRepository, NewChatMessage } from '@data/repositories/chat-repository'
import type { DigestRepository } from '@data/repositories/digest-repository'
import type { ItemRepository } from '@data/repositories/item-repository'
import type { ApiKeyStore, LogFn, RendererEvents, WorkerRpc } from './ports'

export interface ChatServiceDeps {
    database: AppDatabase // 여러 쓰기를 한 묶음으로 실행할 때만 사용
    chatRepository: ChatRepository // 대화와 메시지 저장소
    itemRepository: ItemRepository // 질문 범위의 기사가 있는지 확인, 지난 질문 목록의 기사 제목 · 출처 (읽기만)
    digestRepository: DigestRepository // 질문 범위의 브리핑이 있는지 확인, 지난 질문 목록의 브리핑 한 줄 (읽기만)
    keys: Pick<ApiKeyStore, 'getApiKey'> // API 키가 있는지 확인
    worker: WorkerRpc // 답변을 만드는 Worker
    events: RendererEvents // 화면으로 보내는 알림
    quickActions: QuickActions // 설정 파일에 정해 둔 빠른 질문 목록
    log: LogFn // 진단 기록
}

/**
 * 질문 범위를 대화를 찾는 키로 변환
 *
 * @param {ChatScope} chatScope - 질문 범위 (기사 하나 또는 그날 브리핑)
 * @returns {string} 'item:<기사 번호>' 또는 'digest:<날짜>'
 */
export function chatScopeKey(chatScope: ChatScope): string {
    return chatScope.kind === 'item' ? `item:${chatScope.itemId}` : `digest:${chatScope.date}`
}

/**
 * 대화를 찾는 키를 질문 범위로 변환 (chatScopeKey의 반대)
 *
 * @param {string} scopeKey - 'item:<기사 번호>' 또는 'digest:<날짜>'
 * @returns {ChatScope | null} 질문 범위 (모양이 맞지 않는 키면 null)
 */
export function parseChatScopeKey(scopeKey: string): ChatScope | null {
    // 기사 대화: 'item:' 뒤가 숫자
    const itemKeyMatch = /^item:(\d+)$/.exec(scopeKey)
    if (itemKeyMatch) return { kind: 'item', itemId: Number(itemKeyMatch[1]) }

    // 브리핑 대화: 'digest:' 뒤가 'YYYY-MM-DD' 날짜
    const digestKeyMatch = /^digest:(\d{4}-\d{2}-\d{2})$/.exec(scopeKey)
    if (digestKeyMatch) return { kind: 'digest', date: digestKeyMatch[1]! }

    return null
}

/**
 * AI 질문
 */
export class ChatService {
    constructor(private readonly deps: ChatServiceDeps) {}

    // 그 범위(기사 하나 또는 그날 브리핑)에서 나눈 대화 조회 (오래된 것부터, 대화가 없으면 빈 배열)
    getChatHistory(chatScope: ChatScope): ChatMessageDTO[] {
        return this.deps.chatRepository.listChatMessagesByScopeKey(chatScopeKey(chatScope))
    }

    /**
     * 질문 보내기
     *
     * - 답변을 기다리지 않고 저장된 내 질문을 바로 돌려줌
     * - 답변은 요청 번호가 붙은 알림(조각 · 완료 · 오류)으로 따로 도착
     *
     * @param {ChatScope} chatScope - 질문하는 범위
     * @param {string} question - 질문 내용
     * @returns 요청 번호와 저장된 내 질문
     * @throws 질문이 비었거나, API 키가 없거나, 기사 · 브리핑이 없으면 오류 (질문을 저장하지 않음)
     */
    ask(chatScope: ChatScope, question: string): { requestId: string; userMessage: ChatMessageDTO } {
        const { chatRepository, itemRepository, digestRepository, keys, worker, events, log } = this.deps

        // 빈 질문과 API 키가 없는 경우는 받지 않음
        const trimmedQuestion = question.trim()
        if (!trimmedQuestion) throw new Error('질문을 입력하세요.')
        if (!keys.getApiKey()) throw new Error('Groq API 키가 없습니다. 설정에서 키를 입력하세요.')

        // 근거가 될 기사 · 브리핑이 없으면 질문을 저장하기 전에 실패시킴
        if (chatScope.kind === 'item') {
            if (!itemRepository.findItemById(chatScope.itemId)) throw new Error('기사를 찾을 수 없습니다.')
        } else if (digestRepository.findDigestIdByDate(chatScope.date) === null) {
            throw new Error('그날 브리핑이 없습니다.')
        }

        // 이전 대화를 읽은 뒤 이번 질문 저장
        // 저장 전에 읽으므로 이번 질문은 이전 대화에 들어가지 않음 (최근 것만 쓰는 규칙은 Worker)
        const previousMessages = chatRepository.listChatMessagesByScopeKey(chatScopeKey(chatScope))
        const userMessage = this.saveChatMessage(chatScope, { role: 'user', content: trimmedQuestion })

        // 이 질문의 요청 번호 (Worker가 답변 조각마다 이 번호를 붙여 보냄)
        const requestId = randomUUID()

        // 답변 생성은 기다리지 않고 Worker에서 진행
        void worker
            .call('answerQuestion', { requestId, scope: chatScope, question: trimmedQuestion, history: previousMessages })
            .then((answer) => {
                // 답변 완료 → 대화에 저장하고 저장된 메시지를 화면에 전달
                const assistantMessage = this.saveChatMessage(chatScope, {
                    role: 'assistant',
                    content: answer.content,
                    citations: answer.citations,
                    model: answer.model
                })
                events.chatEvent({ type: 'done', requestId, message: assistantMessage })
            })
            .catch((answerError: unknown) => {
                // 답변 실패 → 기록하고 화면에 오류 전달 (저장한 질문은 그대로 둠)
                const failureMessage = (answerError as Error).message
                log('chat-failed', `질문 답변 실패: ${failureMessage}`)
                events.chatEvent({ type: 'error', requestId, message: failureMessage })
            })

        return { requestId, userMessage }
    }

    // Worker가 보낸 답변 조각을 화면에 전달 (requestId는 그 조각이 속한 질문의 요청 번호)
    forwardAnswerDelta(requestId: string, deltaText: string): void {
        this.deps.events.chatEvent({ type: 'delta', requestId, text: deltaText })
    }

    // 그 범위의 대화 삭제 (메시지도 함께 지워짐)
    clearChat(chatScope: ChatScope): void {
        this.deps.chatRepository.deleteChatByScopeKey(chatScopeKey(chatScope))
    }

    /**
     * 지난 질문 목록 (질문한 적 있는 기사 · 브리핑)
     *
     * - 최근에 질문한 것부터
     * - 기사 · 브리핑이 더는 없는 대화는 목록에서 뺌 (대화 자체는 지우지 않음)
     *
     * @returns {ChatHistoryEntryDTO[]} 대화가 있는 범위마다 한 줄 (제목 · 출처 · 질문 수 · 가장 최근 질문)
     */
    listChatHistory(): ChatHistoryEntryDTO[] {
        const { chatRepository, itemRepository, digestRepository } = this.deps

        // 질문이 있는 대화마다 질문 수와 가장 최근 질문 (최근에 질문한 대화부터)
        const questionSummaries = chatRepository.listChatQuestionSummaries()

        // 범위 키를 질문 범위로 풀기 (모양이 맞지 않는 키의 대화는 버림)
        const scopedSummaries = questionSummaries.flatMap((questionSummary) => {
            const chatScope = parseChatScopeKey(questionSummary.scopeKey)
            return chatScope ? [{ chatScope, questionSummary }] : []
        })

        // 기사 대화의 기사를 한 번에 조회 (제목 · 출처)
        const askedItemIds = scopedSummaries.flatMap(({ chatScope }) => (chatScope.kind === 'item' ? [chatScope.itemId] : []))
        const itemRowById = new Map(itemRepository.listItemsByIds(askedItemIds).map((itemRow) => [itemRow.id, itemRow]))

        // 브리핑 대화가 있을 때만 브리핑 목록을 한 번 조회 (날짜별 그날의 한 줄)
        const hasDigestChat = scopedSummaries.some(({ chatScope }) => chatScope.kind === 'digest')
        const digestSummaries = hasDigestChat ? digestRepository.listDigestSummaries() : []
        const headlineByDigestDate = new Map(digestSummaries.map((digestSummary) => [digestSummary.date, digestSummary.headline]))

        // 목록의 한 줄로 조립 (대화 순서 그대로)
        return scopedSummaries.flatMap(({ chatScope, questionSummary }): ChatHistoryEntryDTO[] => {
            const questionFields = {
                questionCount: questionSummary.questionCount,
                lastQuestion: questionSummary.lastQuestion,
                lastAskedAt: questionSummary.lastAskedAt
            }

            if (chatScope.kind === 'item') {
                // 기사가 없어진 대화 → 목록에서 뺌
                const itemRow = itemRowById.get(chatScope.itemId)
                if (!itemRow) return []

                // 한국어 제목이 아직 없으면(요약 전) 원제
                return [{ scope: chatScope, title: itemRow.titleKo ?? itemRow.title, sourceName: itemRow.sourceName, ...questionFields }]
            }

            // 그날 브리핑이 없어진 대화 → 목록에서 뺌
            const digestHeadline = headlineByDigestDate.get(chatScope.date)
            if (digestHeadline === undefined) return []

            return [{ scope: chatScope, title: digestHeadline, sourceName: null, ...questionFields }]
        })
    }

    // 설정 파일에 정해 둔 빠른 질문 목록 (기사용 · 브리핑용)
    getQuickActions(): QuickActions {
        return this.deps.quickActions
    }

    // 대화에 메시지 한 건 저장 → 저장한 메시지
    // 그 범위의 대화가 없으면 만들고, 있으면 마지막 변경 시각만 갱신 (대화 준비와 메시지 저장은 한 묶음)
    private saveChatMessage(chatScope: ChatScope, chatMessage: Omit<NewChatMessage, 'chatId' | 'createdAt'>): ChatMessageDTO {
        const { database, chatRepository } = this.deps
        const messageCreatedAt = nowIso() // 메시지를 저장한 시각이자 대화의 마지막 변경 시각

        return runInTransaction(database, () => {
            const chatId = chatRepository.upsertChat(chatScopeKey(chatScope), messageCreatedAt)
            return chatRepository.insertChatMessage({ ...chatMessage, chatId, createdAt: messageCreatedAt })
        })
    }
}
