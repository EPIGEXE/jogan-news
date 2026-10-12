// ============================================================================
// 수집 흐름 표시
//
// [역할]
// - 수집부터 저장까지 단계별 개수를 나란히 표시
// - 단계마다 수집 수를 100%로 한 비율 막대 표시
// ============================================================================
import type { FunnelCounts } from '@shared/types'

// 흐름의 단계 (표시 순서대로). help는 마우스를 올렸을 때 보이는 설명
const FUNNEL_STEPS: { key: keyof FunnelCounts; label: string; help: string }[] = [
    { key: 'collected', label: '수집', help: '출처에서 처음 받아 쌓은 글' },
    { key: 'merged', label: '중복 합침', help: '같은 소식이라 다른 기사에 출처로 합쳐진 글' },
    { key: 'triaged', label: 'AI 선별', help: '규칙 점수를 넘어 AI가 관련도·중요도를 매긴 글' },
    { key: 'published', label: '브리핑에 실림', help: '최종 선정되어 브리핑에 실린 글' },
    { key: 'saved', label: '저장', help: '실리거나 찾아서 직접 저장한 글' }
]

// stepCount가 collectedCount의 몇 %인지 (10% 미만이면 소수 첫째 자리까지, collectedCount가 0이면 줄표)
const formatPercent = (stepCount: number, collectedCount: number) =>
    collectedCount > 0 ? `${((stepCount / collectedCount) * 100).toFixed(stepCount / collectedCount < 0.1 ? 1 : 0)}%` : '—'

/**
 * 수집부터 저장까지 단계별 개수
 *
 * - 고른 기간 숫자를 크게, 전체 누적을 작게 표시
 * - 막대는 수집 수를 100%로 한 비율
 *
 * @returns {JSX.Element} 단계별 개수 목록
 */
export function Funnel({
    periodCounts,
    totalCounts,
    showTotal
}: {
    periodCounts: FunnelCounts
    totalCounts: FunnelCounts
    showTotal: boolean
}) {
    return (
        <ol className="m-0 grid list-none grid-cols-2 gap-x-6 gap-y-5 p-0 wide:grid-cols-5">
            {FUNNEL_STEPS.map((funnelStep) => (
                <li key={funnelStep.key} className="flex flex-col gap-1.5" title={funnelStep.help}>
                    <span className="font-display text-label font-bold tracking-label text-ink-secondary">{funnelStep.label}</span>
                    <span className="font-display text-headline font-bold tabular-nums">
                        {periodCounts[funnelStep.key].toLocaleString('ko-KR')}
                    </span>
                    <span className="h-1 bg-rule-soft">
                        {/* 비율은 데이터에 따라 정해지는 값이라 인라인 style로 지정 */}
                        <span
                            className="block h-full bg-accent transition-[width] duration-300 ease-ink"
                            style={{
                                width: periodCounts.collected
                                    ? `${Math.max(1, (periodCounts[funnelStep.key] / periodCounts.collected) * 100)}%`
                                    : '0%'
                            }}
                        />
                    </span>
                    <span className="text-meta text-ink-muted tabular-nums">
                        {funnelStep.key === 'collected'
                            ? '기준'
                            : `수집의 ${formatPercent(periodCounts[funnelStep.key], periodCounts.collected)}`}
                        {showTotal && ` · 전체 ${totalCounts[funnelStep.key].toLocaleString('ko-KR')}`}
                    </span>
                </li>
            ))}
        </ol>
    )
}
