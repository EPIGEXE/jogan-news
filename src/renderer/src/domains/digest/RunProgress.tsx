// ============================================================================
// 브리핑 생성 진행 표시
//
// [역할]
// - 브리핑을 만드는 동안 지금 하는 일 · 단계 · 진행선 표시
// - 전체 진행률 계산 (제목 표시줄의 진행선도 같은 값 사용)
// ============================================================================
import type { RunProgress as Progress, RunStage } from '@shared/types'
import { cn } from '@/common/lib/cn'

// 화면에 보여주는 생성 단계 (진행 순서대로)
const RUN_STEPS: { stage: RunStage; label: string }[] = [
    { stage: 'collect', label: '수집' },
    { stage: 'dedup', label: '중복 정리' },
    { stage: 'triage', label: '선별·묶기' },
    { stage: 'extract', label: '본문' },
    { stage: 'summarize', label: '요약' },
    { stage: 'translate', label: '번역' },
    { stage: 'digest', label: '머리글' },
    { stage: 'publish', label: '저장' }
]

// 지금 단계가 몇 번째인지 (다 끝났으면 단계 수, 목록에 없는 단계면 0)
function findCurrentStepIndex(progress: Progress): number {
    return progress.stage === 'done'
        ? RUN_STEPS.length
        : Math.max(
              0,
              RUN_STEPS.findIndex((step) => step.stage === progress.stage)
          )
}

/**
 * 전체 진행률 계산
 *
 * - 끝난 단계 + 지금 단계 안에서 처리한 비율
 * - 제목 표시줄의 진행선도 같은 값 사용
 *
 * @param {Progress} progress - Main이 보낸 진행 상황
 * @returns {number} 진행률 (0~100)
 */
export function progressPercent(progress: Progress): number {
    const ratioWithinStep = progress.total ? (progress.current ?? 0) / progress.total : 0
    return Math.min(100, ((findCurrentStepIndex(progress) + ratioWithinStep) / RUN_STEPS.length) * 100)
}

/**
 * 브리핑 생성 진행 (지금 하는 일의 문장 · 개수 + 진행선 + 단계 표시)
 *
 * @returns {JSX.Element} 진행 상황 영역
 */
export function RunProgress({ runProgress }: { runProgress: Progress }) {
    const currentStepIndex = findCurrentStepIndex(runProgress)
    const percent = progressPercent(runProgress)

    return (
        <div role="status" aria-live="polite" className="flex flex-col gap-3 border-y border-rule-strong py-4">
            {/* 지금 하는 일 */}
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-display text-title font-semibold text-ink">{runProgress.message}…</span>
                {runProgress.total ? (
                    <span className="text-meta text-ink-muted tabular-nums">
                        {runProgress.current} / {runProgress.total}
                    </span>
                ) : null}
            </div>

            {/* 진행선 */}
            <div className="h-1 bg-rule">
                {/* 진행률은 실행 중에 바뀌는 값이라 인라인 style로 지정 */}
                <div className="h-full bg-accent transition-[width] duration-300 ease-ink" style={{ width: `${percent}%` }} />
            </div>

            {/* 단계 표시 */}
            <ol className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-meta">
                {RUN_STEPS.map((step, stepIndex) => (
                    <li
                        key={step.stage}
                        aria-current={stepIndex === currentStepIndex ? 'step' : undefined}
                        className={cn(
                            stepIndex < currentStepIndex
                                ? 'text-ink-muted'
                                : stepIndex === currentStepIndex
                                  ? 'font-bold text-accent'
                                  : 'text-ink-faint'
                        )}
                    >
                        {/* 끝난 단계는 ✓가 도장처럼 찍힘 (끝나는 순간 처음 그려지므로 한 번만 움직임) */}
                        {stepIndex < currentStepIndex ? (
                            <span className="inline-block animate-stamp">✓&nbsp;</span>
                        ) : stepIndex === currentStepIndex ? (
                            '● '
                        ) : (
                            ''
                        )}
                        {step.label}
                    </li>
                ))}
            </ol>
            <span className="text-caption text-ink-faint">보통 1~2분 걸립니다. 창을 닫아도 계속 만들고, 끝나면 알림을 띄웁니다.</span>
        </div>
    )
}
