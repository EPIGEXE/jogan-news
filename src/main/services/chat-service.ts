// ============================================================================
// AI 질문 서비스
//
// [역할]
// - 대화 조회 · 질문 · 대화 삭제 · 빠른 질문 목록 요청을 Worker에 전달
// - 대화는 범위(기사 하나 또는 그날 브리핑)별로 따로 관리
// - 질문마다 요청 번호(requestId)를 붙여, 화면이 자기 질문의 답변 조각만 골라 받게 함
// - 질문은 답변을 기다리지 않고 저장된 내 질문만 바로 돌려줌 (답변은 조각 · 완료 · 오류 알림으로 따로 도착)
// - 답변을 만들고 저장하는 일은 Worker가 담당 (여기서는 하지 않음)
// ============================================================================
import { randomUUID } from 'node:crypto'
import type { ChatMessageDTO, ChatScope, QuickActions } from '@shared/types'
import type { WorkerRpc } from './ports'

/**
 * AI 질문
 * - 답변 조각은 이 서비스를 거치지 않고 Worker, WorkerClient, RendererEvents.chat 순서로 화면에 전달됨
 */
export class ChatService {
    constructor(private readonly worker: WorkerRpc) {}

    // 그 범위(기사 하나 또는 그날 브리핑)에서 나눈 대화 조회 (오래된 것부터)
    getChatHistory(chatScope: ChatScope): Promise<ChatMessageDTO[]> {
        return this.worker.call('getChat', { scope: chatScope })
    }

    /**
     * 질문 보내기
     * - 질문이 비었거나 API 키가 없거나 근거가 될 기사 · 브리핑이 없으면 Worker가 거절 (질문을 저장하지 않고 reject)
     *
     * @param {ChatScope} chatScope - 질문하는 범위
     * @param {string} question - 질문 내용
     * @returns 요청 번호와 저장된 내 질문 (답변은 요청 번호가 붙은 조각으로 따로 도착)
     */
    async ask(chatScope: ChatScope, question: string): Promise<{ requestId: string; userMessage: ChatMessageDTO }> {
        // 이 질문의 요청 번호 생성 (Worker가 답변 조각마다 이 번호를 붙여 보냄)
        const requestId = randomUUID()

        // Worker에 질문 전달 → 저장된 내 질문을 받음 (답변이 끝나기를 기다리지 않음)
        const userMessage = await this.worker.call('ask', { requestId, scope: chatScope, question })
        return { requestId, userMessage }
    }

    // 그 범위의 대화 삭제
    clearChat(chatScope: ChatScope): Promise<void> {
        return this.worker.call('clearChat', { scope: chatScope })
    }

    // 설정 파일에 정해 둔 빠른 질문 목록 조회 (기사용 · 브리핑용)
    getQuickActions(): Promise<QuickActions> {
        return this.worker.call('getQuickActions')
    }
}
