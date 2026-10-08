import { forwardRef } from 'react'
import { ChatPanel } from '../components/article/ChatPanel'
import { useChat, useQuickActions } from '../lib/useChat'

interface Props {
  itemId: number
  /** [¶n]을 누르면: 본문 탭으로 가서 그 문단을 보여준다 */
  onCite(paragraph: number): void
  onAddToMemo(text: string): void
  /** 입력란에 미리 채울 질문 (하이라이트에서 "질문") */
  draft?: { text: string; key: number } | null
}

/** 기사 패널의 "질문" 탭: 이 기사 본문을 근거로 묻고 답한다 */
export const ArticleChat = forwardRef<HTMLTextAreaElement, Props>(function ArticleChat({ itemId, onCite, onAddToMemo, draft }, ref) {
  const chat = useChat({ kind: 'item', itemId })
  const quick = useQuickActions()
  return (
    <ChatPanel
      ref={ref}
      messages={chat.messages}
      streaming={chat.streaming}
      error={chat.error}
      quickActions={quick?.item ?? []}
      onAsk={chat.ask}
      onClear={chat.clear}
      onCite={onCite}
      onAddToMemo={onAddToMemo}
      emptyHint="이 기사에 대해 물어보세요. 답변의 ¶번호를 누르면 본문의 그 문단으로 갑니다."
      placeholder="이 기사에 대해 질문 (/)"
      draft={draft}
    />
  )
})
