// ============================================================================
// 질문 화면
//
// [역할]
// - "오늘 브리핑에 질문": 최신 브리핑 전체를 근거로 묻고 답하는 대화 (답변의 기사 번호를 누르면 오늘 화면에서 그 기사 열기)
// - "지난 질문": 질문한 적 있는 기사 · 브리핑 목록, 고르면 그 기사의 읽기 화면(질문 탭) 또는 그날 브리핑의 대화 열기
// - 고른 탭과 연 대화를 주소에 보관 (뒤로 가면 직전 화면으로 돌아감)
// ============================================================================
import { useLocation, useNavigate, useOutletContext, useParams } from 'react-router'
import { SinglePane } from '@/common/layout/AppShell'
import { ListHeader } from '@/common/layout/ListHeader'
import { formatKoreanDate } from '@/common/lib/format'
import { paths, useItemIdParam } from '@/common/lib/paths'
import { EmptyState } from '@/common/ui/Notice'
import { Tabs, type TabItem } from '@/common/ui/Tabs'
import type { DigestState } from '@/domains/digest/useDigest'
import { ChatHistoryArticle } from '@/screens/ask/components/ChatHistoryArticle'
import { ChatHistoryDigest } from '@/screens/ask/components/ChatHistoryDigest'
import { ChatHistoryList } from '@/screens/ask/components/ChatHistoryList'
import { DigestChat } from '@/screens/ask/components/DigestChat'

type AskTab = 'latest' | 'history' // 질문 화면의 탭 (오늘 브리핑에 질문 / 지난 질문)

// 질문 화면 위쪽의 탭 목록
const ASK_TABS: TabItem<AskTab>[] = [
    { id: 'latest', label: '오늘 브리핑에 질문' },
    { id: 'history', label: '지난 질문' }
]

/**
 * 질문 화면 (오늘 브리핑에 질문 · 지난 질문)
 *
 * - 탭은 주소로 결정 (/ask는 오늘 브리핑에 질문, /ask/history는 지난 질문)
 * - 지난 질문에서 기사 · 브리핑을 열면 탭 없이 그 읽기 화면 · 대화만 표시
 *
 * @returns {JSX.Element} 질문 화면
 */
export function AskPage() {
    // =============================== 훅 ===================================
    const { digest } = useOutletContext<DigestState>() // 최신 브리핑 (하나도 없으면 null)
    const navigate = useNavigate()
    const isHistoryTab = useLocation().pathname === paths.askHistory() // 주소가 지난 질문 목록인지
    const historyItemId = useItemIdParam() // 지난 질문에서 연 기사 번호 (기사를 열지 않았으면 null)
    const historyDigestDate = useParams().date ?? null // 지난 질문에서 연 브리핑 날짜 (브리핑을 열지 않았으면 null)

    // =============================== 계산 ===================================
    const askTab: AskTab = isHistoryTab ? 'history' : 'latest'
    const openAskTab = (nextAskTab: AskTab) => void navigate(nextAskTab === 'history' ? paths.askHistory() : paths.ask())

    // 지난 질문에서 기사를 열었으면 그 기사의 읽기 화면
    if (historyItemId !== null) return <ChatHistoryArticle itemId={historyItemId} />

    // 지난 질문에서 브리핑을 열었으면 그날 브리핑의 대화
    if (historyDigestDate !== null) return <ChatHistoryDigest digestDate={historyDigestDate} />

    return (
        <SinglePane label="질문">
            <div className="flex max-w-190 flex-col gap-5 px-7 pt-6 pb-7">
                {/* 머리 (오늘 브리핑에 질문일 때 브리핑 날짜 · 건수, 탭) */}
                <ListHeader
                    title="질문"
                    meta={!isHistoryTab && digest ? `${formatKoreanDate(digest.date)} 브리핑 · ${digest.entries.length}건` : undefined}
                >
                    <Tabs items={ASK_TABS} value={askTab} onChange={openAskTab} label="질문 화면 탭" />
                </ListHeader>

                {isHistoryTab ? (
                    // 지난 질문 목록
                    <ChatHistoryList />
                ) : digest ? (
                    // 최신 브리핑의 한 줄과 대화 (답변의 [#n]을 누르면 오늘 화면에서 그 기사의 읽기 화면 열기)
                    <DigestChat
                        digest={digest}
                        onOpenCitedItem={(itemId) => void navigate(paths.today(itemId))}
                        emptyHint="오늘 브리핑 전체에 대해 물어보세요. 답변의 #번호를 누르면 그 기사로 갑니다."
                        placeholder="오늘 브리핑에 대해 질문"
                    />
                ) : (
                    // 브리핑이 하나도 없을 때
                    <EmptyState title="아직 브리핑이 없습니다">브리핑이 만들어지면 그날 소식 전체에 대해 질문할 수 있습니다.</EmptyState>
                )}
            </div>
        </SinglePane>
    )
}
