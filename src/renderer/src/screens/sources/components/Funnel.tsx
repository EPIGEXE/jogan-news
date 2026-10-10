import type { FunnelCounts } from '@shared/types'

const STEPS: { key: keyof FunnelCounts; label: string; help: string }[] = [
  { key: 'collected', label: '수집', help: '출처에서 처음 받아 쌓은 글' },
  { key: 'merged', label: '중복 합침', help: '같은 소식이라 다른 기사에 출처로 합쳐진 글' },
  { key: 'triaged', label: 'AI 선별', help: '규칙 점수를 넘어 AI가 관련도·중요도를 매긴 글' },
  { key: 'published', label: '브리핑에 실림', help: '최종 선정되어 브리핑에 실린 글' },
  { key: 'saved', label: '저장', help: '실리거나 찾아서 직접 저장한 글' }
]

const pct = (n: number, of: number) => (of > 0 ? `${((n / of) * 100).toFixed(n / of < 0.1 ? 1 : 0)}%` : '—')

/**
 * 수집부터 저장까지 단계별 개수. 고른 기간 숫자를 크게, 전체 누적을 작게 보여준다.
 * 막대는 수집 수를 100%로 한 비율이다.
 */
export function Funnel({ period, total, showTotal }: { period: FunnelCounts; total: FunnelCounts; showTotal: boolean }) {
  return (
    <ol className="m-0 grid list-none grid-cols-2 gap-x-6 gap-y-5 p-0 wide:grid-cols-5">
      {STEPS.map((s) => (
        <li key={s.key} className="flex flex-col gap-1.5" title={s.help}>
          <span className="font-display text-label font-bold tracking-label text-ink-secondary">{s.label}</span>
          <span className="font-display text-headline font-bold tabular-nums">{period[s.key].toLocaleString('ko-KR')}</span>
          <span className="h-1 bg-rule-soft">
            {/* 비율은 데이터에 따라 정해지는 값이라 인라인 style로 준다 */}
            <span
              className="block h-full bg-accent transition-[width] duration-300 ease-ink"
              style={{ width: period.collected ? `${Math.max(1, (period[s.key] / period.collected) * 100)}%` : '0%' }}
            />
          </span>
          <span className="text-meta text-ink-muted tabular-nums">
            {s.key === 'collected' ? '기준' : `수집의 ${pct(period[s.key], period.collected)}`}
            {showTotal && ` · 전체 ${total[s.key].toLocaleString('ko-KR')}`}
          </span>
        </li>
      ))}
    </ol>
  )
}
