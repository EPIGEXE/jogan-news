// ============================================================================
// 오늘 화면
//
// [역할]
// - 가장 최근 브리핑 표시 (주소에 기사 번호가 있으면 그 기사의 읽기 화면)
// - 브리핑이 아직 없으면 만들기 안내와 생성 진행 상황 표시
// - 오늘 브리핑이 없을 때만 만들기 버튼 표시
// ============================================================================
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router'
import { ErrorNotice, EmptyState } from '@/common/ui/Notice'
import { RunProgress } from '@/domains/digest/RunProgress'
import { SinglePane } from '@/common/layout/AppShell'
import { Button } from '@/common/ui/Button'
import { SkeletonLine, SkeletonList } from '@/common/ui/Skeleton'
import { todayKey } from '@/common/lib/format'
import { paths, useReadingRoute } from '@/common/lib/paths'
import type { DigestState } from '@/domains/digest/useDigest'
import { DigestView } from '@/domains/digest/DigestView'

/**
 * 오늘 화면 (최신 브리핑)
 *
 * - 아직 브리핑이 없으면 만들기 안내와 진행 상황
 * - 주소에 기사 번호가 있으면 그 기사의 읽기 화면
 *
 * @returns {JSX.Element} 오늘 화면
 */
export function TodayPage() {
    // =============================== 훅 ===================================
    // 브리핑과 생성 진행 상황은 App이 들고 있다가 넘겨준 값 (제목 표시줄과 같은 값 사용, 화면을 옮겨도 진행 상황 유지)
    const { digest, isLoading, isRunning, runProgress, errorMessage, runNow } = useOutletContext<DigestState>()
    const navigate = useNavigate()
    const { readingItemId, onRead } = useReadingRoute(paths.today)

    // =============================== 상태 ===================================
    const [isFreshDigest, setIsFreshDigest] = useState(false) // 이 화면을 보는 중에 새 브리핑이 도착했는지 (지면 머리 이중선을 한 번 긋는 용도)

    // =============================== Ref ===================================
    const wasRunning = useRef(isRunning) // 직전 렌더에서 생성 중이었는지, 생성이 끝난 순간을 알아내는 용도

    // =============================== 계산 ===================================
    // 생성이 멈춘 뒤의 오류 안내 (API 키 문제면 설정 화면으로 가는 버튼 포함)
    const errorNotice = errorMessage && !isRunning && (
        <ErrorNotice>
            {errorMessage}{' '}
            {errorMessage.includes('API 키') && (
                <Button variant="text" onClick={() => navigate(paths.of('settings'))}>
                    설정으로 이동
                </Button>
            )}
        </ErrorNotice>
    )

    // =============================== useEffect ===================================
    // 이 화면을 보는 중에 생성이 오류 없이 끝나면 새 브리핑 도착으로 표시
    useEffect(() => {
        if (wasRunning.current && !isRunning && !errorMessage) setIsFreshDigest(true)
        wasRunning.current = isRunning
    }, [isRunning, errorMessage])

    // 브리핑을 읽어 오는 중
    if (isLoading) {
        return (
            <SinglePane label="오늘">
                <div className="flex max-w-190 flex-col gap-3 px-7 py-6">
                    <SkeletonLine className="w-1/3" />
                    <SkeletonLine className="h-8 w-5/6" />
                    <SkeletonList />
                </div>
            </SinglePane>
        )
    }

    // 브리핑이 하나도 없을 때
    if (!digest) {
        return (
            <SinglePane label="오늘">
                <div className="flex max-w-190 flex-col gap-4 px-7 py-6">
                    {/* 만들기 안내 (생성 중에는 버튼 숨김) */}
                    <EmptyState
                        title="아직 브리핑이 없습니다"
                        action={
                            isRunning ? undefined : (
                                <Button variant="solid" icon="refresh" onClick={runNow}>
                                    지금 브리핑 만들기
                                </Button>
                            )
                        }
                    >
                        로그인하거나 잠금을 해제하면 하루 한 번 자동으로 만들어집니다. 지금 바로 만들 수도 있습니다.
                    </EmptyState>

                    {/* 생성 진행 상황 · 오류 안내 */}
                    {isRunning && runProgress && <RunProgress runProgress={runProgress} />}
                    {errorNotice}
                </div>
            </SinglePane>
        )
    }

    const isToday = digest.date === todayKey() // 보여주는 브리핑이 오늘 것인지

    // 오늘 브리핑이 있으면 다시 만들지 않음 (같은 날 후보는 거의 같아서 결과도 비슷하고,
    // 낮 동안 쌓인 새 글은 다음 날 브리핑에 들어감). 오늘 것이 없을 때만 만들기 버튼 표시
    return (
        <DigestView
            digest={digest}
            readingItemId={readingItemId}
            onRead={onRead}
            notice={isToday ? undefined : '오늘 브리핑이 아직 없어 지난 브리핑을 보여줍니다'}
            isFresh={isFreshDigest}
            headerActions={
                !isToday && !isRunning ? (
                    <div className="mt-1">
                        <Button variant="solid" icon="refresh" onClick={runNow}>
                            오늘 브리핑 만들기
                        </Button>
                    </div>
                ) : undefined
            }
            belowHeader={
                isRunning && runProgress ? (
                    <div className="pt-4">
                        <RunProgress runProgress={runProgress} />
                    </div>
                ) : errorNotice ? (
                    <div className="pt-4">{errorNotice}</div>
                ) : undefined
            }
        />
    )
}
