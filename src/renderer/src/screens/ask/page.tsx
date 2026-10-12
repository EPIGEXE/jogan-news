// ============================================================================
// 질문 화면
//
// [역할]
// - 그날 브리핑 전체를 근거로 묻고 답하는 대화 화면
// - 답변의 기사 번호를 누르면 오늘 화면에서 그 기사의 읽기 화면 열기
// ============================================================================
import { useMemo } from 'react'
import { useNavigate, useOutletContext } from 'react-router'
import { EmptyState } from '@/common/ui/Notice'
import { ListHeader } from '@/common/layout/ListHeader'
import { ChatPanel } from '@/domains/chat/ChatPanel'
import { SinglePane } from '@/common/layout/AppShell'
import { formatKoreanDate } from '@/common/lib/format'
import { paths } from '@/common/lib/paths'
import { useQuickActionsQuery } from '@/domains/chat/queries'
import { useChat } from '@/domains/chat/useChat'
import type { DigestState } from '@/domains/digest/useDigest'

/**
 * 질문 화면 (그날 브리핑 전체를 근거로 묻고 답하기)
 *
 * @returns {JSX.Element} 질문 화면
 */
export function AskPage() {
    // =============================== 훅 ===================================
    const { digest } = useOutletContext<DigestState>()
    const navigate = useNavigate()
    const chat = useChat(digest ? { kind: 'digest', date: digest.date } : null) // 브리핑이 없으면 대화 대상 없음(null)

    // =============================== 쿼리 훅 ===================================
    const quickActions = useQuickActionsQuery()

    // =============================== 계산 ===================================
    const entryByRank = useMemo(() => new Map(digest?.entries.map((entry) => [entry.rank, entry]) ?? []), [digest]) // 답변의 기사 번호(순위)로 기사를 찾는 표

    // 브리핑이 하나도 없을 때
    if (!digest) {
        return (
            <SinglePane label="질문">
                <div className="max-w-190 px-7 py-6">
                    <EmptyState title="아직 브리핑이 없습니다">브리핑이 만들어지면 그날 소식 전체에 대해 질문할 수 있습니다.</EmptyState>
                </div>
            </SinglePane>
        )
    }

    return (
        <SinglePane label="질문">
            <div className="flex max-w-190 flex-col gap-5 px-7 pt-6 pb-7">
                {/* 머리 (브리핑 날짜 · 건수 · 머리글) */}
                <ListHeader title="질문" meta={`${formatKoreanDate(digest.date)} 브리핑 · ${digest.entries.length}건`}>
                    <p className="font-display text-title font-semibold text-ink-secondary">{digest.headline}</p>
                </ListHeader>

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
                        // 답변의 [#n]을 누르면 오늘 화면에서 그 기사의 읽기 화면 열기
                        if (citedEntry) navigate(paths.today(citedEntry.itemId))
                    }}
                    citeTitle={(rank) => entryByRank.get(rank)?.titleKo ?? ''}
                    emptyHint="오늘 브리핑 전체에 대해 물어보세요. 답변의 #번호를 누르면 그 기사로 갑니다."
                    placeholder="오늘 브리핑에 대해 질문"
                />
            </div>
        </SinglePane>
    )
}
