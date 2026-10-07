import type { ReactNode } from 'react'
import type { DigestStats } from '@shared/types'
import { formatKoreanDate, formatTime } from '../../lib/format'

interface Props {
  date: string
  createdAt: string
  headline: string
  overview: string | null
  stats: DigestStats
  /** 오늘 브리핑이 아닐 때 등 짧은 안내 */
  notice?: string
  actions?: ReactNode
}

/** 지면 머리: 날짜·통계, 오늘의 한 줄, 흐름 요약 */
export function EditionHeader({ date, createdAt, headline, overview, stats, notice, actions }: Props) {
  return (
    <header className="flex flex-col gap-2 border-b-3 border-double border-rule-strong pb-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-meta font-medium tracking-dateline text-ink-muted tabular-nums">
        <span>{formatKoreanDate(date)}</span>
        <span>
          후보 {stats.candidates}건 → {stats.selected}건 · {formatTime(createdAt)}
          {stats.saveMode ? ' · 절약 모드' : ''}
        </span>
      </div>
      {notice && <div className="text-meta font-bold text-accent">{notice}</div>}
      <h1 className="font-display text-headline font-bold tracking-tight">{headline}</h1>
      {overview && <p className="text-ink-secondary">{overview}</p>}
      {actions}
    </header>
  )
}
