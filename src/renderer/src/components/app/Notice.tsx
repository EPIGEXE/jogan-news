import type { ReactNode } from 'react'
import type { UsageSummary } from '@shared/types'
import { formatUsd } from '../../lib/format'
import { Caption } from '../ui/Text'

/** 오류 안내: 위아래 붉은 괘선 */
export function ErrorNotice({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="border-y border-danger py-3 text-danger">
      {children}
    </div>
  )
}

/** 빈 화면 */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex max-w-130 flex-col items-start gap-3 py-7">
      <h2 className="font-display text-subhead font-bold">{title}</h2>
      {children && <div className="text-ink-secondary">{children}</div>}
      {action}
    </div>
  )
}

/** 이번 달 LLM 비용 */
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
