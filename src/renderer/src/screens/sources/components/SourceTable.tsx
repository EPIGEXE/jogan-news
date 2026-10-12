// ============================================================================
// 출처별 표
//
// [역할]
// - 출처마다 수집 상태와 수집 · 실림 · 채택률 · 저장 수를 표로 표시
// - 열 머리를 눌러 정렬 (꺼진 출처는 항상 아래)
// - 행을 누르면 그 출처의 수집 조건 · 최근 수집 기록 · 최근 실린 기사 펼침
// ============================================================================
import { Fragment, useState } from 'react'
import type { SourceFetchDTO, SourceStatDTO } from '@shared/types'
import { cn } from '@/common/lib/cn'
import { formatShortDate, formatTime } from '@/common/lib/format'

type SortKey = 'name' | 'collected' | 'published' | 'rate' | 'saved' // 정렬할 수 있는 열

// 채택률 (수집한 글 중 실린 글의 비율). 수집이 없으면 -1이라 오름차순에서 맨 앞
const adoptionRate = (source: SourceStatDTO) => (source.period.collected ? source.period.published / source.period.collected : -1)

// 열마다 쓰는 오름차순 비교 함수
const SORT_COMPARATORS: Record<SortKey, (leftSource: SourceStatDTO, rightSource: SourceStatDTO) => number> = {
    name: (leftSource, rightSource) => leftSource.name.localeCompare(rightSource.name),
    collected: (leftSource, rightSource) => leftSource.period.collected - rightSource.period.collected,
    published: (leftSource, rightSource) => leftSource.period.published - rightSource.period.published,
    rate: (leftSource, rightSource) => adoptionRate(leftSource) - adoptionRate(rightSource),
    saved: (leftSource, rightSource) => leftSource.period.saved - rightSource.period.saved
}

// 지금으로부터 얼마나 지났는지 ("3분 전", "2시간 전", "4일 전")
function formatElapsed(isoTime: string): string {
    const elapsedMinutes = Math.round((Date.now() - Date.parse(isoTime)) / 60_000)
    if (elapsedMinutes < 1) return '방금'
    if (elapsedMinutes < 60) return `${elapsedMinutes}분 전`
    if (elapsedMinutes < 60 * 24) return `${Math.round(elapsedMinutes / 60)}시간 전`
    return `${Math.round(elapsedMinutes / 60 / 24)}일 전`
}

// 출처의 수집 상태 (꺼짐 · 기록 없음 · 정상 · 실패)와 기간 중 실패 횟수
function SourceStatus({ source }: { source: SourceStatDTO }) {
    const lastFetch = source.lastFetch
    // 상태 점의 모양 · 글자 · 마우스를 올렸을 때 보이는 설명
    const [dotClassName, statusText, statusTitle] = !source.enabled
        ? ['border border-ink-faint bg-transparent', '꺼짐', 'sources.yaml에서 꺼 둔 출처']
        : !lastFetch
          ? ['bg-rule', '기록 없음', '이 기능을 넣은 뒤로 아직 수집하지 않았습니다']
          : lastFetch.ok
            ? [
                  'bg-ink-secondary',
                  `정상 · ${formatElapsed(lastFetch.fetchedAt)}`,
                  `마지막 수집 ${formatShortDate(lastFetch.fetchedAt)} ${formatTime(lastFetch.fetchedAt)}`
              ]
            : ['bg-danger', `실패 · ${formatElapsed(lastFetch.fetchedAt)}`, lastFetch.error ?? '']
    return (
        <span className="flex flex-col gap-0.5" title={statusTitle}>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span aria-hidden="true" className={cn('size-2 flex-none rounded-full', dotClassName)} />
                {statusText}
            </span>
            {source.enabled && source.failures > 0 && <span className="text-caption text-danger">기간 중 실패 {source.failures}회</span>}
        </span>
    )
}

// 수집 기록 한 줄 (시각 · 수집 계기 · 받은 글 수 또는 실패 사유)
function FetchLine({ sourceFetch }: { sourceFetch: SourceFetchDTO }) {
    return (
        <li className="flex flex-wrap gap-x-3 tabular-nums">
            <span className="text-ink-muted">
                {formatShortDate(sourceFetch.fetchedAt)} {formatTime(sourceFetch.fetchedAt)}
            </span>
            <span>{sourceFetch.reason === 'collect' ? '미리 수집' : '브리핑'}</span>
            {sourceFetch.ok ? (
                <span>
                    받은 글 {sourceFetch.fetchedCount} · 새 글 {sourceFetch.newItems}
                </span>
            ) : (
                <span className="text-danger">실패 — {sourceFetch.error}</span>
            )}
        </li>
    )
}

// 펼친 행 (수집 조건 · 최근 수집 기록 · 최근 실린 기사)
function SourceDetail({ source }: { source: SourceStatDTO }) {
    return (
        <div className="grid gap-x-8 gap-y-4 px-3 pt-1 pb-4 text-body text-ink-body reader:grid-cols-3">
            <section className="flex flex-col gap-1.5">
                <h3 className="font-display text-label font-bold tracking-label text-accent">수집 조건</h3>
                <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5">
                    {source.rules.map((rule) => (
                        <li key={rule} className="break-words">
                            {rule}
                        </li>
                    ))}
                </ul>
                {source.url && <span className="truncate text-meta text-ink-muted">{source.url}</span>}
            </section>
            <section className="flex flex-col gap-1.5">
                <h3 className="font-display text-label font-bold tracking-label text-accent">최근 수집 기록</h3>
                {source.recentFetches.length ? (
                    <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-meta">
                        {source.recentFetches.map((sourceFetch) => (
                            <FetchLine key={sourceFetch.fetchedAt + sourceFetch.reason} sourceFetch={sourceFetch} />
                        ))}
                    </ul>
                ) : (
                    <span className="text-meta text-ink-muted">아직 기록이 없습니다</span>
                )}
            </section>
            <section className="flex flex-col gap-1.5">
                <h3 className="font-display text-label font-bold tracking-label text-accent">최근 실린 기사</h3>
                {source.recentPublished.length ? (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                        {source.recentPublished.map((publishedItem) => (
                            <li key={publishedItem.itemId} className="flex gap-2">
                                <span className="flex-none text-meta text-ink-muted tabular-nums">
                                    {formatShortDate(publishedItem.digestDate)}
                                </span>
                                <span className="min-w-0">{publishedItem.titleKo}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <span className="text-meta text-ink-muted">아직 실린 기사가 없습니다</span>
                )}
            </section>
        </div>
    )
}

/**
 * 출처별 표
 *
 * - 열 머리를 누르면 정렬
 * - 행을 누르면 그 출처의 수집 조건 · 기록 · 실린 기사 펼침
 *
 * @returns {JSX.Element} 출처별 표
 */
export function SourceTable({ sources, showTotal }: { sources: SourceStatDTO[]; showTotal: boolean }) {
    // =============================== 상태 ===================================
    const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'published', desc: true }) // 정렬 기준 열과 방향 (처음에는 실린 수가 많은 순)
    const [openSourceId, setOpenSourceId] = useState<string | null>(null) // 펼친 출처의 id (null이면 모두 접힘)

    // =============================== 계산 ===================================
    // 꺼진 출처는 항상 아래로
    const sortedSources = [...sources].sort((leftSource, rightSource) => {
        if (leftSource.enabled !== rightSource.enabled) return leftSource.enabled ? -1 : 1
        const comparison = SORT_COMPARATORS[sort.key](leftSource, rightSource)
        return sort.desc ? -comparison : comparison
    })

    // 정렬할 수 있는 열 머리 (같은 열을 다시 누르면 방향 반대로)
    const SortableHead = ({ sortKey, children, className }: { sortKey: SortKey; children: string; className?: string }) => (
        <th
            scope="col"
            aria-sort={sort.key === sortKey ? (sort.desc ? 'descending' : 'ascending') : 'none'}
            className={cn('p-0 font-normal', className)}
        >
            <button
                type="button"
                onClick={() =>
                    setSort((previousSort) => ({
                        key: sortKey,
                        desc: previousSort.key === sortKey ? !previousSort.desc : sortKey !== 'name'
                    }))
                }
                className={cn(
                    'flex min-h-9 w-full cursor-pointer items-center gap-1 border-0 bg-transparent px-3 text-meta font-bold text-ink-secondary hover:text-ink',
                    sortKey === 'name' ? 'justify-start' : 'justify-end'
                )}
            >
                {children}
                <span aria-hidden="true" className={cn('text-caption', sort.key === sortKey ? 'text-accent' : 'text-transparent')}>
                    {sort.desc ? '▾' : '▴'}
                </span>
            </button>
        </th>
    )

    const numberCellClass = 'px-3 py-2.5 text-right tabular-nums' // 숫자 칸에 공통으로 쓰는 class

    return (
        <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body">
                {/* 열 머리 */}
                <thead className="border-y border-rule-strong">
                    <tr>
                        <SortableHead sortKey="name">출처</SortableHead>
                        <th scope="col" className="px-3 text-left text-meta font-bold text-ink-secondary">
                            상태
                        </th>
                        <SortableHead sortKey="collected">수집</SortableHead>
                        <SortableHead sortKey="published">실림</SortableHead>
                        <SortableHead sortKey="rate">채택률</SortableHead>
                        <SortableHead sortKey="saved">저장</SortableHead>
                        {showTotal && (
                            <th scope="col" className="px-3 text-right text-meta font-bold whitespace-nowrap text-ink-secondary">
                                전체 수집 · 실림
                            </th>
                        )}
                    </tr>
                </thead>

                {/* 출처 행 (펼치면 바로 아래에 상세 행) */}
                <tbody>
                    {sortedSources.map((source) => {
                        const isExpanded = openSourceId === source.id
                        return (
                            <Fragment key={source.id}>
                                <tr
                                    onClick={() => setOpenSourceId(isExpanded ? null : source.id)}
                                    aria-expanded={isExpanded}
                                    className={cn(
                                        'cursor-pointer border-b border-rule-soft transition-colors duration-120 hover:bg-paper-sunken/50',
                                        isExpanded && 'bg-paper-sunken',
                                        !source.enabled && 'text-ink-muted'
                                    )}
                                >
                                    <td className="px-3 py-2.5">
                                        <span className="flex flex-col">
                                            <span className="font-display font-semibold">{source.name}</span>
                                            <span className="text-caption text-ink-muted">{source.method}</span>
                                        </span>
                                    </td>
                                    <td className="px-3 py-2.5 text-meta">
                                        <SourceStatus source={source} />
                                    </td>
                                    <td className={numberCellClass}>{source.period.collected.toLocaleString('ko-KR')}</td>
                                    <td className={cn(numberCellClass, 'font-bold')}>{source.period.published}</td>
                                    <td className={numberCellClass}>
                                        {source.period.collected
                                            ? `${((source.period.published / source.period.collected) * 100).toFixed(0)}%`
                                            : '—'}
                                    </td>
                                    <td className={numberCellClass}>{source.period.saved}</td>
                                    {showTotal && (
                                        <td className={cn(numberCellClass, 'text-ink-muted')}>
                                            {source.total.collected.toLocaleString('ko-KR')} · {source.total.published}
                                        </td>
                                    )}
                                </tr>
                                {isExpanded && (
                                    <tr className="border-b border-rule bg-paper-sunken/40">
                                        <td colSpan={showTotal ? 7 : 6} className="animate-ink-in">
                                            <SourceDetail source={source} />
                                        </td>
                                    </tr>
                                )}
                            </Fragment>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}
