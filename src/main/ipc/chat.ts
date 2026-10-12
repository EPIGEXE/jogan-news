// ============================================================================
// AI 질문 요청
//
// [역할]
// - 화면의 AI 질문 요청(대화 조회 · 질문 · 대화 삭제 · 빠른 질문 목록)을 서비스에 전달
// - 질문 요청은 답변을 기다리지 않고 바로 응답 (요청 번호와 저장된 내 질문, 받을 수 없는 질문이면 오류)
// - 답변 조각은 이 핸들러를 거치지 않고 화면으로 가는 알림(chat:event)으로 따로 도착
// ============================================================================
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { ChatScope } from '@shared/types'
import type { ChatService } from '../services/chat-service'

/**
 * AI 질문 요청 핸들러 등록
 *
 * @param {{ chat: ChatService }} deps - AI 질문 서비스
 * @returns {void}
 */
export function registerChatIpc(deps: { chat: ChatService }): void {
    // 그 범위(기사 하나 또는 그날 브리핑)의 대화 조회 · 질문 · 삭제
    ipcMain.handle(IPC.getChat, (_invokeEvent, chatScope: ChatScope) => deps.chat.getChatHistory(chatScope))
    ipcMain.handle(IPC.ask, (_invokeEvent, chatScope: ChatScope, question: string) => deps.chat.ask(chatScope, question))
    ipcMain.handle(IPC.clearChat, (_invokeEvent, chatScope: ChatScope) => deps.chat.clearChat(chatScope))

    // 설정 파일에 정해 둔 빠른 질문 목록
    ipcMain.handle(IPC.getQuickActions, () => deps.chat.getQuickActions())
}
