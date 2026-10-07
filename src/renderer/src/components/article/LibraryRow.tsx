import { forwardRef } from 'react'
import type { LibraryItemDTO } from '@shared/types'
import { formatShortDate } from '../../lib/format'
import { Meta, OriginalTitle } from '../ui/Text'

interface Props {
  item: LibraryItemDTO
  selected: boolean
  onSelect(): void
}

/** 라이브러리·검색 결과 한 줄: 제목, 원제, 출처·날짜, 태그, 메모 첫 줄 */
export const LibraryRow = forwardRef<HTMLButtonElement, Props>(function LibraryRow({ item, selected, onSelect }, ref) {
  const date = item.savedAt ? `${formatShortDate(item.savedAt)} 저장` : item.digestDate ? `${formatShortDate(item.digestDate)} 브리핑` : null
  const memoLine = item.memo.split('\n').find((l) => l.trim())
  return (
    <button
      ref={ref}
      type="button"
      aria-current={selected ? 'true' : undefined}
      data-selected={selected || undefined}
      onClick={onSelect}
      className="group flex w-full cursor-pointer flex-col gap-1 border-0 border-b border-rule-soft bg-transparent p-3 text-left transition-colors duration-120 hover:bg-paper-sunken/50 data-selected:bg-paper-sunken"
    >
      <span className="font-display text-title font-semibold text-ink">{item.titleKo}</span>
      <OriginalTitle truncate>{item.originalTitle}</OriginalTitle>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <Meta>
          {item.sourceName}
          {date ? ` · ${date}` : ''}
          {item.savedAt && !item.isSaved ? ' · 저장 해제됨' : ''}
        </Meta>
        {item.tags.map((t) => (
          <span key={t} className="text-meta text-ink-secondary">
            #{t}
          </span>
        ))}
      </span>
      {memoLine && (
        <span className="truncate text-meta text-ink-body">
          <span className="font-bold text-accent">메모</span> {memoLine}
        </span>
      )}
    </button>
  )
})
