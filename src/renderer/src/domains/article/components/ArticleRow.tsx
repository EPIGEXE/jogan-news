// ============================================================================
// 브리핑 기사 행
//
// [역할]
// - 브리핑 목록의 기사 한 줄 표시 (순위 · 제목 · 원제 · 출처 · 후속 소식 · 반응 수)
// - 읽은 기사는 흐리게, 선택한 기사는 배경과 왼쪽 강조선으로 구분
// - 저장했거나 메모가 있는 기사에 표시 추가
// ============================================================================
import { forwardRef } from 'react'
import type { DigestEntryDTO } from '@shared/types'
import { MetaText, OriginalTitle } from '@/common/ui/Text'
import { RowReadButton } from '@/domains/article/components/RowReadButton'

interface Props {
    entry: DigestEntryDTO
    selected: boolean
    onSelect(): void
    onOpen?(): void // 읽기 화면으로 이동 (두 번 누르기 · 줄 오른쪽 "읽기" 버튼)
}

/**
 * 브리핑 목록 한 줄
 *
 * - 상태: 기본 / 읽음(흐리게) / 선택 / 저장됨 / 메모 있음
 *
 * @returns {JSX.Element} 기사 행 (ref는 행 버튼에 연결)
 */
export const ArticleRow = forwardRef<HTMLButtonElement, Props>(function ArticleRow({ entry, selected, onSelect, onOpen }, ref) {
    const statusMark = entry.memo ? '메모' : entry.isSaved ? '저장됨' : null // 줄 끝에 붙일 표시 (메모가 있으면 메모 우선)
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
                {/* 순위 */}
                <span className="w-6 flex-none pt-0.5 font-display text-reading font-bold text-ink-faint tabular-nums group-data-selected:text-accent">
                    {entry.rank}
                </span>
                {/* 제목 · 원제 · 출처와 표시들 */}
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-display text-title font-semibold text-ink transition-colors duration-400 group-data-read:text-ink-read">
                        {entry.titleKo}
                    </span>
                    <OriginalTitle truncate>{entry.originalTitle}</OriginalTitle>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <MetaText>
                            {entry.sourceName}
                            {entry.otherSources.length ? ` 외 ${entry.otherSources.length}곳` : ''}
                        </MetaText>
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
                        {statusMark && <span className="text-caption font-bold text-accent">{statusMark}</span>}
                    </span>
                </span>
            </button>
            {/* 읽기 버튼 */}
            {onOpen && <RowReadButton selected={selected} onClick={onOpen} />}
        </div>
    )
})
