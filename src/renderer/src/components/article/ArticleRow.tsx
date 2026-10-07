import { forwardRef } from 'react'
import type { DigestEntryDTO } from '@shared/types'
import { Meta, OriginalTitle } from '../ui/Text'

interface Props {
  entry: DigestEntryDTO
  selected: boolean
  onSelect(): void
}

/** 목록 한 줄. 상태: 기본 / 읽음(흐리게) / 선택 / 저장됨 / 메모 있음 */
export const ArticleRow = forwardRef<HTMLButtonElement, Props>(function ArticleRow({ entry, selected, onSelect }, ref) {
  const mark = entry.memo ? '메모' : entry.isSaved ? '저장됨' : null
  return (
    <button
      ref={ref}
      type="button"
      aria-current={selected ? 'true' : undefined}
      data-selected={selected || undefined}
      data-read={(entry.isRead && !selected) || undefined}
      onClick={onSelect}
      className="group flex w-full cursor-pointer items-start gap-3 border-0 border-b border-rule-soft bg-transparent p-3 text-left transition-colors duration-120 hover:bg-paper-sunken/50 data-selected:bg-paper-sunken"
    >
      <span className="w-5.5 flex-none font-display text-reading font-bold text-ink-faint tabular-nums group-data-selected:text-accent">
        {entry.rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-title font-semibold text-ink group-data-read:text-ink-read">{entry.titleKo}</span>
        <OriginalTitle truncate>{entry.originalTitle}</OriginalTitle>
      </span>
      <span className="flex max-w-30 flex-none flex-col items-end gap-0.5 text-right">
        <Meta>{entry.engagementLabel ?? entry.sourceName}</Meta>
        {mark && <span className="text-caption font-bold text-accent">{mark}</span>}
      </span>
    </button>
  )
})
