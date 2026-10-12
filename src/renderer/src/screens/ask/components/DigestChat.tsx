// ============================================================================
// 브리핑 대화
//
// [역할]
// - 브리핑 하나(최신 또는 지난 날짜)를 근거로 묻고 답하는 대화 표시
// - 그날의 한 줄과 질문 패널을 함께 표시 (질문 화면의 "오늘 브리핑에 질문"과 지난 브리핑 대화가 함께 사용)
// - 답변의 기사 번호(#n)를 그 기사의 번호로 바꿔 화면에 알림 (어느 주소로 열지는 화면이 결정)
// ============================================================================
import { useMemo } from 'react'
import type { DigestDTO } from '@shared/types'
import { ChatPanel } from '@/domains/chat/ChatPanel'
import { useQuickActionsQuery } from '@/domains/chat/queries'
import { useChat } from '@/domains/chat/useChat'

interface Props {
    digest: DigestDTO // 질문의 근거가 되는 브리핑
    onOpenCitedItem(itemId: number): void // 답변의 [#n]을 눌렀을 때 (그 순위에 실린 기사의 번호를 넘김)
    emptyHint: string // 대화가 아직 없을 때의 안내
    placeholder: string // 질문 입력란의 안내 글자
}

/**
 * 브리핑 하나에 대한 대화 (그날의 한 줄 + 질문 패널)
 *
 * @returns {JSX.Element} 그날 브리핑 전체를 근거로 묻고 답하는 영역
 */
export function DigestChat({ digest, onOpenCitedItem, emptyHint, placeholder }: Props) {
    // =============================== 훅 ===================================
    const chat = useChat({ kind: 'digest', date: digest.date }) // 이 브리핑의 대화

    // =============================== 쿼리 훅 ===================================
    const quickActions = useQuickActionsQuery()

    // =============================== 계산 ===================================
    const entryByRank = useMemo(() => new Map(digest.entries.map((entry) => [entry.rank, entry])), [digest]) // 답변의 기사 번호(순위)로 기사를 찾는 표

    return (
        <>
            {/* 그날의 한 줄 */}
            <p className="font-display text-title font-semibold text-ink-secondary">{digest.headline}</p>

            {/* 대화 */}
            <ChatPanel
                messages={chat.messages}
                streamingAnswer={chat.streamingAnswer}
                errorMessage={chat.errorMessage}
                quickActions={quickActions?.digest ?? []}
                onAsk={chat.ask}
                onClear={chat.clear}
                onCite={(rank) => {
                    const citedEntry = entryByRank.get(rank)
                    if (citedEntry) onOpenCitedItem(citedEntry.itemId)
                }}
                citeTitle={(rank) => entryByRank.get(rank)?.titleKo ?? ''}
                emptyHint={emptyHint}
                placeholder={placeholder}
            />
        </>
    )
}
