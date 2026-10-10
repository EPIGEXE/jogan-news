import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { StatsPeriod } from '@shared/types'
import { ErrorNotice } from '@/common/ui/Notice'
import { ListHeader } from '@/common/layout/ListHeader'
import { SinglePane } from '@/common/layout/AppShell'
import { PageSection } from '@/common/layout/Page'
import { DailyBars } from '@/screens/sources/components/DailyBars'
import { Funnel } from '@/screens/sources/components/Funnel'
import { SourceTable } from '@/screens/sources/components/SourceTable'
import { Segmented, type SegmentItem } from '@/common/ui/Segmented'
import { SkeletonList } from '@/common/ui/Skeleton'
import { Help } from '@/common/ui/Text'
import { api } from '@/common/lib/api'
import { formatUsd } from '@/common/lib/format'
import { qk } from '@/common/lib/queryKeys'

type PeriodId = '7' | '30' | 'all'

const PERIODS: SegmentItem<PeriodId>[] = [
  { id: '7', label: '7일' },
  { id: '30', label: '30일' },
  { id: 'all', label: '전체' }
]

const toPeriod = (id: PeriodId): StatsPeriod => (id === 'all' ? 'all' : (Number(id) as 7 | 30))

/** llm_usage의 역할 이름 → 화면 이름 */
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
 * 출처: 어디서 자료를 받는지, 얼마나 받아서 얼마나 브리핑에 실리는지.
 * 고른 기간(7일·30일·전체)의 숫자를 크게, 전체 누적을 작게 함께 보여준다. 읽기 전용(출처 편집은 config/sources.yaml).
 */
export function SourcesPage() {
  const [periodId, setPeriodId] = useState<PeriodId>('7')
  const query = useQuery({ queryKey: qk.sources(toPeriod(periodId)), queryFn: () => api.getSourceStats(toPeriod(periodId)) })
  const stats = query.data ?? null
  const error = query.error?.message ?? null

  const showTotal = periodId !== 'all'
  const enabled = stats?.sources.filter((s) => s.enabled).length ?? 0

  return (
    <SinglePane label="출처">
      <div className="flex flex-col gap-6 px-7 pt-6 pb-10">
        <ListHeader title="출처" meta={stats ? `출처 ${stats.sources.length}곳 · 켜짐 ${enabled}` : undefined}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Help>
              어디서 자료를 받는지, 얼마나 받아서 얼마나 브리핑에 실리는지 보여줍니다. 출처를 켜고 끄는 것은 config/sources.yaml에서 합니다.
            </Help>
            <Segmented items={PERIODS} value={periodId} onChange={setPeriodId} label="기간" />
          </div>
        </ListHeader>

        {error && <ErrorNotice>{error}</ErrorNotice>}
        {!stats && !error && <SkeletonList count={4} />}

        {stats && (
          <>
            <PageSection
              title="흐름"
              aside={
                <span className="text-meta text-ink-muted tabular-nums">
                  LLM 비용 {formatUsd(stats.cost.period)}
                  {showTotal && ` · 전체 ${formatUsd(stats.cost.total)}`}
                </span>
              }
            >
              <Funnel period={stats.funnel.period} total={stats.funnel.total} showTotal={showTotal} />
              {stats.cost.byRole.length > 0 && (
                <p className="text-meta text-ink-muted tabular-nums">
                  {stats.cost.byRole.map((r) => `${ROLE_LABEL[r.role] ?? r.role} ${formatUsd(r.usd)}`).join(' · ')}
                </p>
              )}
            </PageSection>

            <PageSection title="날마다" aside={<span className="text-meta text-ink-muted">최근 30일</span>}>
              <DailyBars days={stats.daily} />
            </PageSection>

            <section className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-label font-bold tracking-label text-accent">출처별</h2>
                <span className="text-meta text-ink-muted">행을 누르면 수집 조건·기록·실린 기사가 펼쳐집니다</span>
              </div>
              <SourceTable sources={stats.sources} showTotal={showTotal} />
            </section>
          </>
        )}
      </div>
    </SinglePane>
  )
}
