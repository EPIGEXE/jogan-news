import type { RunProgress as Progress, RunStage } from '@shared/types'
import { cn } from '../../lib/cn'

const STEPS: { stage: RunStage; label: string }[] = [
  { stage: 'collect', label: '수집' },
  { stage: 'dedup', label: '중복 정리' },
  { stage: 'triage', label: '선별·묶기' },
  { stage: 'extract', label: '본문' },
  { stage: 'summarize', label: '요약' },
  { stage: 'translate', label: '번역' },
  { stage: 'digest', label: '머리글' },
  { stage: 'publish', label: '저장' }
]

function stepIndex(progress: Progress): number {
  return progress.stage === 'done' ? STEPS.length : Math.max(0, STEPS.findIndex((s) => s.stage === progress.stage))
}

/** 전체 진행률(0~100): 끝난 단계 + 지금 단계 안에서 처리한 비율. 제목 표시줄의 진행선도 같은 값을 쓴다 */
export function progressPercent(progress: Progress): number {
  const within = progress.total ? (progress.current ?? 0) / progress.total : 0
  return Math.min(100, ((stepIndex(progress) + within) / STEPS.length) * 100)
}

/** 브리핑 생성 진행: 지금 하는 일(문장·개수) + 단계 표시 + 진행선 */
export function RunProgress({ progress }: { progress: Progress }) {
  const current = stepIndex(progress)
  const pct = progressPercent(progress)
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3 border-y border-rule-strong py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-title font-semibold text-ink">{progress.message}…</span>
        {progress.total ? (
          <span className="text-meta text-ink-muted tabular-nums">
            {progress.current} / {progress.total}
          </span>
        ) : null}
      </div>
      <div className="h-1 bg-rule">
        {/* 진행률은 실행 중에 바뀌는 값이라 인라인 style로 준다 */}
        <div className="h-full bg-accent transition-[width] duration-300 ease-ink" style={{ width: `${pct}%` }} />
      </div>
      <ol className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-meta">
        {STEPS.map((s, i) => (
          <li
            key={s.stage}
            aria-current={i === current ? 'step' : undefined}
            className={cn(i < current ? 'text-ink-muted' : i === current ? 'font-bold text-accent' : 'text-ink-faint')}
          >
            {/* 끝난 단계는 ✓가 도장처럼 찍힌다 (끝나는 순간 처음 그려지므로 한 번만 움직임) */}
            {i < current ? <span className="inline-block animate-stamp">✓&nbsp;</span> : i === current ? '● ' : ''}
            {s.label}
          </li>
        ))}
      </ol>
      <span className="text-caption text-ink-faint">보통 1~2분 걸립니다. 창을 닫아도 계속 만들고, 끝나면 알림을 띄웁니다.</span>
    </div>
  )
}
