import { forwardRef } from 'react'
import type { LibraryItemDTO } from '@shared/types'
import { formatShortDate } from '../../lib/format'
import { Meta, OriginalTitle } from '../ui/Text'
import { RowReadButton } from './RowReadButton'

interface Props {
  item: LibraryItemDTO
  selected: boolean
  onSelect(): void
  /** 읽기 화면으로 (두 번 누르기, 줄 오른쪽 "읽기" 버튼) */
  onOpen?(): void
}

/** 라이브러리·검색 결과 한 줄: 제목, 원제, 출처·날짜, 태그, 메모 첫 줄 */
export const LibraryRow = forwardRef<HTMLButtonElement, Props>(function LibraryRow({ item, selected, onSelect, onOpen }, ref) {
  const date = item.savedAt
    ? `${formatShortDate(item.savedAt)} 저장`
    : item.digestDate
      ? `${formatShortDate(item.digestDate)} 브리핑`
      : null
  const memoLine = item.memo.split('\n').find((l) => l.trim())
  return (
    <div className="group/row relative">
      <button
        ref={ref}
        type="button"
        aria-current={selected ? 'true' : undefined}
        data-selected={selected || undefined}
        onClick={onSelect}
        onDoubleClick={onOpen}
        className="group relative flex w-full cursor-pointer flex-col gap-1 border-0 border-b border-rule-soft bg-transparent py-3 pr-24 pl-3 text-left before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:origin-top before:scale-y-0 before:bg-accent before:transition-transform before:duration-200 before:ease-ink data-selected:before:scale-y-100 transition-colors duration-120 hover:bg-paper-sunken/50 data-selected:bg-paper-sunken"
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
      {onOpen && <RowReadButton selected={selected} onClick={onOpen} />}
    </div>
  )
})
