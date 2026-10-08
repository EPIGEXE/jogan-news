import { randomUUID } from 'node:crypto'
import type { ChatMessageDTO, ChatScope, QuickActions } from '@shared/types'
import type { WorkerRpc } from './ports'

// AI 질문. 질문마다 requestId를 붙여서, 화면이 자기 질문의 답변 조각만 골라 받게 한다.
// 답변 조각은 Worker → WorkerClient → RendererEvents.chat 경로로 흘러간다.

export class ChatService {
  constructor(private readonly worker: WorkerRpc) {}

  history(scope: ChatScope): Promise<ChatMessageDTO[]> {
    return this.worker.call('getChat', { scope })
  }

  async ask(scope: ChatScope, question: string): Promise<{ requestId: string; userMessage: ChatMessageDTO }> {
    const requestId = randomUUID()
    const userMessage = await this.worker.call('ask', { requestId, scope, question })
    return { requestId, userMessage }
  }

  clear(scope: ChatScope): Promise<void> {
    return this.worker.call('clearChat', { scope })
  }

  quickActions(): Promise<QuickActions> {
    return this.worker.call('getQuickActions')
  }
}
