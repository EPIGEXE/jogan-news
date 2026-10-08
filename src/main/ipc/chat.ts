import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { ChatScope } from '@shared/types'
import type { ChatService } from '../services/chat-service'

// AI 질문 요청 → 서비스 호출

export function registerChatIpc(d: { chat: ChatService }): void {
  ipcMain.handle(IPC.getChat, (_e, scope: ChatScope) => d.chat.history(scope))
  ipcMain.handle(IPC.ask, (_e, scope: ChatScope, question: string) => d.chat.ask(scope, question))
  ipcMain.handle(IPC.clearChat, (_e, scope: ChatScope) => d.chat.clear(scope))
  ipcMain.handle(IPC.getQuickActions, () => d.chat.quickActions())
}
