import { forwardRef } from 'react'
import type { DigestEntryDTO } from '@shared/types'
import { Meta, OriginalTitle } from '@/common/ui/Text'
import { RowReadButton } from '@/domains/article/RowReadButton'

interface Props {
  entry: DigestEntryDTO
  selected: boolean
  onSelect(): void
  /** 읽기 화면으로 (두 번 누르기, 줄 오른쪽 "읽기" 버튼) */
  onOpen?(): void
}

/** 목록 한 줄. 상태: 기본 / 읽음(흐리게) / 선택 / 저장됨 / 메모 있음 */
export const ArticleRow = forwardRef<HTMLButtonElement, Props>(function ArticleRow({ entry, selected, onSelect, onOpen }, ref) {
  const mark = entry.memo ? '메모' : entry.isSaved ? '저장됨' : null
  return (
    <div className="group/row relative">
      <button
        ref={ref}
        type="button"
        aria-current={selected ? 'true' : undefined}
        data-selected={selected || undefined}
        data-read={(entry.isRead && !selected) || undefined}
        onClick={onSelect}
        onDoubleClick={onOpen}
        className="group relative flex w-full cursor-pointer items-start gap-3 border-0 border-b border-rule-soft bg-transparent py-3 pr-24 pl-3 text-left transition-colors duration-120 hover:bg-paper-sunken/50 data-selected:bg-paper-sunken before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:origin-top before:scale-y-0 before:bg-accent before:transition-transform before:duration-200 before:ease-ink data-selected:before:scale-y-100"
      >
        <span className="w-6 flex-none pt-0.5 font-display text-reading font-bold text-ink-faint tabular-nums group-data-selected:text-accent">
          {entry.rank}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-display text-title font-semibold text-ink transition-colors duration-400 group-data-read:text-ink-read">{entry.titleKo}</span>
          <OriginalTitle truncate>{entry.originalTitle}</OriginalTitle>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Meta>
              {entry.sourceName}
              {entry.otherSources.length ? ` 외 ${entry.otherSources.length}곳` : ''}
            </Meta>
            {entry.followUpOf && (
              <span
                className="rounded-control border border-accent px-1.5 text-caption font-bold text-accent"
                title={`지난 브리핑 “${entry.followUpOf.titleKo}”의 후속 소식`}
              >
                후속
              </span>
            )}
            {entry.engagementLabel && (
              <span className="rounded-control border border-rule px-1.5 text-caption text-ink-muted tabular-nums">
                {entry.engagementLabel}
              </span>
            )}
            {mark && <span className="text-caption font-bold text-accent">{mark}</span>}
          </span>
        </span>
      </button>
      {onOpen && <RowReadButton selected={selected} onClick={onOpen} />}
    </div>
  )
})
