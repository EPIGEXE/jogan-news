import { formatShortDate } from '@/common/lib/format'

interface Day {
  date: string
  collected: number
  published: number
}

/** 최근 날마다 수집 수(회색)와 실린 수(강조색)를 나란히 세운 막대. 차트 라이브러리 없이 토큰 색으로 그린다 */
export function DailyBars({ days }: { days: Day[] }) {
  const max = Math.max(1, ...days.map((d) => d.collected))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-32 items-end gap-1 border-b border-rule-strong" role="img" aria-label="최근 30일 날마다 수집·실린 수">
        {days.map((d) => (
          <div
            key={d.date}
            title={`${formatShortDate(d.date)} · 수집 ${d.collected} · 실림 ${d.published}`}
            className="group flex h-full min-w-0 flex-1 items-end gap-px"
          >
            {/* 높이는 데이터에 따라 정해지는 값이라 인라인 style로 준다 */}
            <span
              className="flex-1 bg-rule transition-colors duration-120 group-hover:bg-ink-faint"
              style={{ height: `${(d.collected / max) * 100}%` }}
            />
            <span className="flex-1 bg-accent" style={{ height: `${(d.published / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-caption text-ink-muted tabular-nums">
        <span>{days[0] ? formatShortDate(days[0].date) : ''}</span>
        <span className="flex gap-4">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 bg-rule" /> 수집
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 bg-accent" /> 실림
          </span>
        </span>
        <span>{days.at(-1) ? formatShortDate(days.at(-1)!.date) : ''}</span>
      </div>
    </div>
  )
}
