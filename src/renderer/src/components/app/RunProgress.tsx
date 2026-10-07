import type { RunProgress as Progress, RunStage } from '@shared/types'

const STAGES: RunStage[] = ['collect', 'dedup', 'triage', 'extract', 'summarize', 'digest', 'publish', 'done']

/** 생성 진행 상황: 단계 이름과 가는 진행선 */
export function RunProgress({ progress }: { progress: Progress }) {
  const stageIndex = Math.max(0, STAGES.indexOf(progress.stage))
  const within = progress.total ? (progress.current ?? 0) / progress.total : 0
  const pct = Math.min(100, ((stageIndex + within) / (STAGES.length - 1)) * 100)
  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div className="flex justify-between gap-2 text-meta text-ink-muted tabular-nums">
        <span>{progress.message}</span>
        {progress.total ? (
          <span>
            {progress.current}/{progress.total}
          </span>
        ) : null}
      </div>
      <div className="h-0.5 bg-rule">
        {/* 진행률은 실행 중에 바뀌는 값이라 인라인 style로 준다 */}
        <div className="h-full bg-accent transition-all duration-120" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
