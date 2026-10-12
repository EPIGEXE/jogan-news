// ============================================================================
// 출처 화면
//
// [역할]
// - 어디서 자료를 받는지, 얼마나 받아서 얼마나 브리핑에 실리는지 표시
// - 고른 기간(7일 · 30일 · 전체)의 숫자를 크게, 전체 누적을 작게 함께 표시
// - 읽기 전용 (출처 편집은 config/sources.yaml에서)
// ============================================================================
import { useState } from 'react'
import type { StatsPeriod } from '@shared/types'
import { ErrorNotice } from '@/common/ui/Notice'
import { ListHeader } from '@/common/layout/ListHeader'
import { SinglePane } from '@/common/layout/AppShell'
import { PageSection } from '@/common/layout/Page'
import { DailyBars } from '@/screens/sources/components/DailyBars'
import { Funnel } from '@/screens/sources/components/Funnel'
import { SourceTable } from '@/screens/sources/components/SourceTable'
import { useSourceStatsQuery } from '@/screens/sources/queries'
import { Segmented, type SegmentItem } from '@/common/ui/Segmented'
import { SkeletonList } from '@/common/ui/Skeleton'
import { HelpText } from '@/common/ui/Text'
import { formatUsd } from '@/common/lib/format'

type PeriodId = '7' | '30' | 'all' // 기간 선택 버튼의 값

const PERIODS: SegmentItem<PeriodId>[] = [
    { id: '7', label: '7일' },
    { id: '30', label: '30일' },
    { id: 'all', label: '전체' }
]

// 기간 선택 버튼의 값을 통계 조회에 쓰는 기간 값으로 변환
const toStatsPeriod = (periodId: PeriodId): StatsPeriod => (periodId === 'all' ? 'all' : (Number(periodId) as 7 | 30))

// LLM 사용 기록(llm_usage)의 역할 이름을 화면에 보여줄 이름으로 바꾸는 표
const ROLE_LABEL: Record<string, string> = {
    triage: '선별',
    cluster: '같은 소식 묶기',
    recent: '7일 중복 확인',
    summary: '요약',
    translate: '번역',
    digest: '머리글',
    tags: '태그 추천',
    chat: '질문'
}

/**
 * 출처 화면 (어디서 자료를 받는지, 얼마나 받아서 얼마나 브리핑에 실리는지)
 *
 * - 고른 기간(7일 · 30일 · 전체)의 숫자를 크게, 전체 누적을 작게 함께 표시
 * - 읽기 전용 (출처 편집은 config/sources.yaml)
 *
 * @returns {JSX.Element} 출처 화면
 */
export function SourcesPage() {
    // =============================== 상태 ===================================
    const [periodId, setPeriodId] = useState<PeriodId>('7') // 고른 기간

    // =============================== 쿼리 훅 ===================================
    const sourceStatsQuery = useSourceStatsQuery(toStatsPeriod(periodId))

    // =============================== 계산 ===================================
    const sourceStats = sourceStatsQuery.data ?? null
    const errorMessage = sourceStatsQuery.error?.message ?? null

    const showTotal = periodId !== 'all' // 전체 누적을 따로 보여줄지 (기간이 "전체"면 숨김)
    const enabledSourceCount = sourceStats?.sources.filter((source) => source.enabled).length ?? 0 // 켜져 있는 출처 수

    return (
        <SinglePane label="출처">
            <div className="flex flex-col gap-6 px-7 pt-6 pb-10">
                {/* 머리 (제목 · 출처 수 · 기간 선택) */}
                <ListHeader
                    title="출처"
                    meta={sourceStats ? `출처 ${sourceStats.sources.length}곳 · 켜짐 ${enabledSourceCount}` : undefined}
                >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <HelpText>
                            어디서 자료를 받는지, 얼마나 받아서 얼마나 브리핑에 실리는지 보여줍니다. 출처를 켜고 끄는 것은
                            config/sources.yaml에서 합니다.
                        </HelpText>
                        <Segmented items={PERIODS} value={periodId} onChange={setPeriodId} label="기간" />
                    </div>
                </ListHeader>

                {/* 오류 · 읽어 오는 중 */}
                {errorMessage && <ErrorNotice>{errorMessage}</ErrorNotice>}
                {!sourceStats && !errorMessage && <SkeletonList count={4} />}

                {sourceStats && (
                    <>
                        {/* 흐름 (수집부터 저장까지 단계별 개수 · LLM 비용) */}
                        <PageSection
                            title="흐름"
                            aside={
                                <span className="text-meta text-ink-muted tabular-nums">
                                    LLM 비용 {formatUsd(sourceStats.cost.period)}
                                    {showTotal && ` · 전체 ${formatUsd(sourceStats.cost.total)}`}
                                </span>
                            }
                        >
                            <Funnel periodCounts={sourceStats.funnel.period} totalCounts={sourceStats.funnel.total} showTotal={showTotal} />
                            {sourceStats.cost.byRole.length > 0 && (
                                <p className="text-meta text-ink-muted tabular-nums">
                                    {sourceStats.cost.byRole
                                        .map((roleCost) => `${ROLE_LABEL[roleCost.role] ?? roleCost.role} ${formatUsd(roleCost.usd)}`)
                                        .join(' · ')}
                                </p>
                            )}
                        </PageSection>

                        {/* 날마다 (최근 30일 막대) */}
                        <PageSection title="날마다" aside={<span className="text-meta text-ink-muted">최근 30일</span>}>
                            <DailyBars dailyCounts={sourceStats.daily} />
                        </PageSection>

                        {/* 출처별 표 */}
                        <section className="flex flex-col gap-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <h2 className="font-display text-label font-bold tracking-label text-accent">출처별</h2>
                                <span className="text-meta text-ink-muted">행을 누르면 수집 조건·기록·실린 기사가 펼쳐집니다</span>
                            </div>
                            <SourceTable sources={sourceStats.sources} showTotal={showTotal} />
                        </section>
                    </>
                )}
            </div>
        </SinglePane>
    )
}
