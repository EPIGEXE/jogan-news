// ============================================================================
// 안내 표시
//
// [역할]
// - 오류 안내 · 빈 화면 안내 표시
// - 이번 달 LLM 비용과 절약 모드 여부 표시
// ============================================================================
import type { ReactNode } from 'react'
import type { UsageSummary } from '@shared/types'
import { formatUsd } from '@/common/lib/format'
import { Caption } from '@/common/ui/Text'

/**
 * 오류 안내 (위아래 붉은 괘선)
 *
 * @returns {JSX.Element} 화면 낭독기가 바로 읽어 주는 오류 안내
 */
export function ErrorNotice({ children }: { children: ReactNode }) {
    return (
        <div role="alert" className="border-y border-danger py-3 text-danger">
            {children}
        </div>
    )
}

/**
 * 빈 화면 안내 (제목 + 설명 + 그 아래 버튼 자리)
 *
 * @returns {JSX.Element} 보여줄 내용이 없을 때의 안내
 */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
    return (
        <div className="flex max-w-130 flex-col items-start gap-3 py-7">
            <h2 className="font-display text-subhead font-bold">{title}</h2>
            {children && <div className="text-ink-secondary">{children}</div>}
            {action}
        </div>
    )
}

/**
 * 이번 달 LLM 비용 표시
 *
 * - 예산에 도달해 절약 모드가 켜지면 그 사실도 함께 표시
 *
 * @returns {JSX.Element | null} 사용액 / 예산 표시 (사용액 정보가 아직 없으면 null)
 */
export function BudgetMeter({ usage }: { usage: UsageSummary | null }) {
    if (!usage) return null
    return (
        <div className="flex flex-col gap-0.5">
            <Caption>
                이번 달 {formatUsd(usage.monthUsd)} / ${usage.budgetUsd}
            </Caption>
            {usage.saveMode && <span className="text-caption font-bold text-accent">예산 도달 · 절약 모드</span>}
        </div>
    )
}
