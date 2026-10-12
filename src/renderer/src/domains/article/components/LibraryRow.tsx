// ============================================================================
// 라이브러리 기사 행
//
// [역할]
// - 라이브러리 · 검색 결과 목록의 기사 한 줄 표시 (제목 · 원제 · 출처 · 날짜 · 태그)
// - 메모가 있으면 첫 줄을 함께 표시
// ============================================================================
import { forwardRef } from 'react'
import type { LibraryItemDTO } from '@shared/types'
import { formatShortDate } from '@/common/lib/format'
import { MetaText, OriginalTitle } from '@/common/ui/Text'
import { RowReadButton } from '@/domains/article/components/RowReadButton'

interface Props {
    libraryItem: LibraryItemDTO
    selected: boolean
    onSelect(): void
    onOpen?(): void // 읽기 화면으로 이동 (두 번 누르기 · 줄 오른쪽 "읽기" 버튼)
}

/**
 * 라이브러리 · 검색 결과 한 줄
 *
 * - 제목, 원제, 출처 · 날짜, 태그, 메모 첫 줄 표시
 *
 * @returns {JSX.Element} 기사 행 (ref는 행 버튼에 연결)
 */
export const LibraryRow = forwardRef<HTMLButtonElement, Props>(function LibraryRow({ libraryItem, selected, onSelect, onOpen }, ref) {
    // 저장한 날짜 우선, 없으면 실린 브리핑 날짜
    const dateLabel = libraryItem.savedAt
        ? `${formatShortDate(libraryItem.savedAt)} 저장`
        : libraryItem.digestDate
          ? `${formatShortDate(libraryItem.digestDate)} 브리핑`
          : null
    const firstMemoLine = libraryItem.memo.split('\n').find((memoLine) => memoLine.trim()) // 메모에서 내용이 있는 첫 줄
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
                <span className="font-display text-title font-semibold text-ink">{libraryItem.titleKo}</span>
                <OriginalTitle truncate>{libraryItem.originalTitle}</OriginalTitle>
                {/* 출처 · 날짜 · 태그 */}
                <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <MetaText>
                        {libraryItem.sourceName}
                        {dateLabel ? ` · ${dateLabel}` : ''}
                        {libraryItem.savedAt && !libraryItem.isSaved ? ' · 저장 해제됨' : ''}
                    </MetaText>
                    {libraryItem.tags.map((tag) => (
                        <span key={tag} className="text-meta text-ink-secondary">
                            #{tag}
                        </span>
                    ))}
                </span>
                {/* 메모 첫 줄 */}
                {firstMemoLine && (
                    <span className="truncate text-meta text-ink-body">
                        <span className="font-bold text-accent">메모</span> {firstMemoLine}
                    </span>
                )}
            </button>
            {/* 읽기 버튼 */}
            {onOpen && <RowReadButton selected={selected} onClick={onOpen} />}
        </div>
    )
})
