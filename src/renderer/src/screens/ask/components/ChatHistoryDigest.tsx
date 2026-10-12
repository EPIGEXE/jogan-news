// ============================================================================
// 지난 질문의 브리핑 대화
//
// [역할]
// - 지난 질문 목록에서 고른 날짜의 브리핑을 근거로 묻고 답하는 대화 표시
// - 답변의 기사 번호를 누르면 아카이브의 그날 브리핑 아래에서 그 기사의 읽기 화면 열기
// - 돌아가기는 지난 질문 목록으로
// ============================================================================
import { useNavigate } from 'react-router'
import { SinglePane } from '@/common/layout/AppShell'
import { ListHeader } from '@/common/layout/ListHeader'
import { formatKoreanDate } from '@/common/lib/format'
import { paths } from '@/common/lib/paths'
import { Button } from '@/common/ui/Button'
import { EmptyState } from '@/common/ui/Notice'
import { SkeletonList } from '@/common/ui/Skeleton'
import { useDigestByDateQuery } from '@/domains/digest/queries'
import { DigestChat } from '@/screens/ask/components/DigestChat'

/**
 * 지난 질문 목록에서 연 그날 브리핑의 대화
 *
 * @returns {JSX.Element} 그날 브리핑의 대화 (읽어 오는 중이면 자리 표시, 브리핑이 없으면 안내)
 */
export function ChatHistoryDigest({ digestDate }: { digestDate: string }) {
    // =============================== 훅 ===================================
    const navigate = useNavigate()

    // =============================== 쿼리 훅 ===================================
    const { data: digest } = useDigestByDateQuery(digestDate) // 그날 브리핑 (읽어 오는 중이면 undefined, 없는 날짜면 null)

    // =============================== 계산 ===================================
    // 지난 질문 목록으로 돌아가는 버튼 (대화 화면과 브리핑이 없을 때의 안내가 함께 사용)
    const backButton = (
        <Button variant="text" onClick={() => navigate(paths.askHistory())}>
            ← 지난 질문으로
        </Button>
    )

    // 브리핑을 읽어 오는 중
    if (digest === undefined) {
        return (
            <SinglePane label="질문">
                <div className="max-w-190 px-7 py-6">
                    <SkeletonList />
                </div>
            </SinglePane>
        )
    }

    // 그날 브리핑이 없을 때
    if (digest === null) {
        return (
            <SinglePane label="질문">
                <div className="max-w-190 px-7 py-6">
                    <EmptyState title="그날 브리핑이 없습니다" action={backButton} />
                </div>
            </SinglePane>
        )
    }

    return (
        <SinglePane label="질문">
            <div className="flex max-w-190 flex-col gap-5 px-7 pt-6 pb-7">
                {/* 머리 (브리핑 날짜 · 건수 · 돌아가기) */}
                <ListHeader title="질문" meta={`${formatKoreanDate(digest.date)} 브리핑 · ${digest.entries.length}건`}>
                    <div>{backButton}</div>
                </ListHeader>

                {/* 그날의 한 줄과 대화 (답변의 [#n]을 누르면 아카이브의 그날 브리핑에서 그 기사 열기) */}
                <DigestChat
                    digest={digest}
                    onOpenCitedItem={(itemId) => void navigate(paths.archiveDate(digest.date, itemId))}
                    emptyHint="이날 브리핑 전체에 대해 물어보세요. 답변의 #번호를 누르면 그 기사로 갑니다."
                    placeholder="이날 브리핑에 대해 질문"
                />
            </div>
        </SinglePane>
    )
}
