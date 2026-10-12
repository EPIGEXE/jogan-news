// ============================================================================
// 날짜별 막대
//
// [역할]
// - 날마다 수집한 글 수와 브리핑에 실린 글 수를 막대로 나란히 표시
// - 차트 라이브러리 없이 토큰 색으로 그림
// ============================================================================
import { formatShortDate } from '@/common/lib/format'

interface DailyCount {
    date: string
    collected: number // 그날 수집한 글 수
    published: number // 그날 브리핑에 실린 글 수
}

/**
 * 날마다 수집 수(회색)와 실린 수(강조색)를 나란히 세운 막대
 *
 * - 차트 라이브러리 없이 토큰 색으로 그림
 *
 * @returns {JSX.Element} 막대와 범례
 */
export function DailyBars({ dailyCounts }: { dailyCounts: DailyCount[] }) {
    const maxCollected = Math.max(1, ...dailyCounts.map((day) => day.collected)) // 막대 높이의 기준이 되는 가장 큰 수집 수 (0으로 나누지 않게 최소 1)
    return (
        <div className="flex flex-col gap-2">
            {/* 막대 */}
            <div className="flex h-32 items-end gap-1 border-b border-rule-strong" role="img" aria-label="최근 30일 날마다 수집·실린 수">
                {dailyCounts.map((day) => (
                    <div
                        key={day.date}
                        title={`${formatShortDate(day.date)} · 수집 ${day.collected} · 실림 ${day.published}`}
                        className="group flex h-full min-w-0 flex-1 items-end gap-px"
                    >
                        {/* 높이는 데이터에 따라 정해지는 값이라 인라인 style로 지정 */}
                        <span
                            className="flex-1 bg-rule transition-colors duration-120 group-hover:bg-ink-faint"
                            style={{ height: `${(day.collected / maxCollected) * 100}%` }}
                        />
                        <span className="flex-1 bg-accent" style={{ height: `${(day.published / maxCollected) * 100}%` }} />
                    </div>
                ))}
            </div>

            {/* 첫 날짜 · 범례 · 마지막 날짜 */}
            <div className="flex justify-between text-caption text-ink-muted tabular-nums">
                <span>{dailyCounts[0] ? formatShortDate(dailyCounts[0].date) : ''}</span>
                <span className="flex gap-4">
                    <span className="flex items-center gap-1.5">
                        <span aria-hidden="true" className="size-2.5 bg-rule" /> 수집
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span aria-hidden="true" className="size-2.5 bg-accent" /> 실림
                    </span>
                </span>
                <span>{dailyCounts.at(-1) ? formatShortDate(dailyCounts.at(-1)!.date) : ''}</span>
            </div>
        </div>
    )
}
