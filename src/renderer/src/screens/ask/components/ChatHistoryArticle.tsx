// ============================================================================
// 지난 질문의 기사
//
// [역할]
// - 지난 질문 목록에서 고른 기사를 읽기 화면으로 표시 (옆 단은 질문 탭부터)
// - 돌아가기는 지난 질문 목록으로 (목록의 다른 기사로 넘어가는 이전 · 다음은 없음)
// ============================================================================
import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { SinglePane } from '@/common/layout/AppShell'
import { paths } from '@/common/lib/paths'
import { Button } from '@/common/ui/Button'
import { EmptyState } from '@/common/ui/Notice'
import { SkeletonList } from '@/common/ui/Skeleton'
import { useItemDetailQuery } from '@/domains/article/queries'
import { ArticleReader } from '@/domains/article/views/ArticleReader'

/**
 * 지난 질문 목록에서 연 기사의 읽기 화면 (질문 탭이 열린 상태)
 *
 * @returns {JSX.Element} 기사 읽기 화면 (읽어 오는 중이면 자리 표시, 기사가 없으면 안내)
 */
export function ChatHistoryArticle({ itemId }: { itemId: number }) {
    // =============================== 훅 ===================================
    const navigate = useNavigate()

    // =============================== 쿼리 훅 ===================================
    const { data: itemDetail } = useItemDetailQuery(itemId) // 기사 상세 (읽어 오는 중이면 undefined, 없는 기사면 null)

    // =============================== 계산 ===================================
    const backToHistory = useCallback(() => void navigate(paths.askHistory()), [navigate]) // 지난 질문 목록으로 돌아가기

    // 기사를 읽어 오는 중
    if (itemDetail === undefined) {
        return (
            <SinglePane label="질문">
                <div className="max-w-190 px-7 py-6">
                    <SkeletonList />
                </div>
            </SinglePane>
        )
    }

    // 기사가 없을 때
    if (itemDetail === null) {
        return (
            <SinglePane label="질문">
                <div className="max-w-190 px-7 py-6">
                    <EmptyState
                        title="기사를 찾을 수 없습니다"
                        action={
                            <Button variant="text" onClick={backToHistory}>
                                ← 지난 질문으로
                            </Button>
                        }
                    />
                </div>
            </SinglePane>
        )
    }

    return <ArticleReader article={itemDetail} onBack={backToHistory} backLabel="지난 질문으로" initialSideTab="ask" />
}
