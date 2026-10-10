import { useState, type ReactNode } from 'react'
import type { DigestStats } from '@shared/types'
import { cn } from '@/common/lib/cn'
import { formatKoreanDate, formatTime } from '@/common/lib/format'
import { Button } from '@/common/ui/Button'

interface Props {
  date: string
  createdAt: string
  headline: string
  overview: string | null
  stats: DigestStats
  /** 오늘 브리핑이 아닐 때 등 짧은 안내 */
  notice?: string
  actions?: ReactNode
  /** 방금 만들어진 브리핑이면 아래 이중선이 왼쪽에서 오른쪽으로 그어진다 */
  fresh?: boolean
}

/** 지면 머리: 날짜·통계, 오늘의 한 줄, 흐름 요약(두 줄까지, 더 보기로 펼침) */
export function EditionHeader({ date, createdAt, headline, overview, stats, notice, actions, fresh = false }: Props) {
  const [expanded, setExpanded] = useState(false)
  return (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta font-medium tracking-dateline text-ink-muted tabular-nums">
        <span>{formatKoreanDate(date)}</span>
        <span>
          후보 {stats.candidates}건 → {stats.selected}건 · {formatTime(createdAt)}
          {stats.saveMode ? ' · 절약 모드' : ''}
        </span>
      </div>
      {notice && <div className="text-meta font-bold text-accent">{notice}</div>}
      <h1 className="max-w-180 font-display text-headline font-bold tracking-tight">{headline}</h1>
      {overview && (
        <div className="flex max-w-180 flex-col items-start gap-1">
          <p className={cn('text-ink-secondary', !expanded && 'line-clamp-2')}>{overview}</p>
          <Button variant="text" onClick={() => setExpanded((e) => !e)}>
            {expanded ? '접기' : '더 보기'}
          </Button>
        </div>
      )}
      {actions}
      <span
        aria-hidden="true"
        className={cn('mt-2 block origin-left border-b-3 border-double border-rule-strong', fresh && 'animate-rule-draw')}
      />
    </header>
  )
}
