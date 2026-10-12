// ============================================================================
// 기사 질문 탭
//
// [역할]
// - 기사 패널의 "질문" 탭에서 이 기사 본문을 근거로 묻고 답하기
// - 이 기사의 대화와 기사용 빠른 질문을 질문 패널에 연결
// ============================================================================
import { forwardRef } from 'react'
import { ChatPanel } from '@/domains/chat/ChatPanel'
import { useQuickActionsQuery } from '@/domains/chat/queries'
import { useChat } from '@/domains/chat/useChat'

interface Props {
    itemId: number
    onCite(paragraph: number): void // [¶n]을 눌렀을 때 (본문 탭으로 가서 그 문단 표시)
    onAddToMemo(text: string): void
    draft?: { text: string; key: number } | null // 입력란에 미리 채울 질문 (하이라이트에서 "질문")
}

/**
 * 기사 패널의 "질문" 탭 (이 기사 본문을 근거로 묻고 답하기)
 *
 * - ref는 질문 입력란에 연결
 *
 * @returns {JSX.Element} 이 기사의 질문 패널
 */
export const ArticleChat = forwardRef<HTMLTextAreaElement, Props>(function ArticleChat({ itemId, onCite, onAddToMemo, draft }, ref) {
    const chat = useChat({ kind: 'item', itemId }) // 이 기사의 대화
    const quickActions = useQuickActionsQuery() // 빠른 질문 버튼 목록 (읽기 전이면 null)

    return (
        <ChatPanel
            ref={ref}
            messages={chat.messages}
            streamingAnswer={chat.streamingAnswer}
            errorMessage={chat.errorMessage}
            quickActions={quickActions?.item ?? []}
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
