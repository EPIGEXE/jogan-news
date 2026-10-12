// ============================================================================
// 라이브러리 화면
//
// [역할]
// - 저장한 기사 목록 표시 (기사를 열면 읽기 화면)
// - 검색어 · 메모 있는 기사 · 태그로 목록 좁히기
// ============================================================================
import { useEffect, useState } from 'react'
import { EmptyState } from '@/common/ui/Notice'
import { ListHeader } from '@/common/layout/ListHeader'
import { SinglePane } from '@/common/layout/AppShell'
import { SearchInput } from '@/common/ui/SearchInput'
import { SkeletonList } from '@/common/ui/Skeleton'
import { Tabs } from '@/common/ui/Tabs'
import { Tag } from '@/common/ui/Tag'
import { paths, useReadingRoute } from '@/common/lib/paths'
import { useSearchQuery, useTagsQuery } from '@/domains/article/queries'
import { ItemListView } from '@/domains/article/views/ItemListView'

type Filter = 'all' | 'memo' // 보기 탭 (전체 · 메모 있는 기사)

/**
 * 라이브러리 화면 (저장한 기사)
 *
 * - 검색, 메모 있는 기사, 태그로 거르기
 *
 * @returns {JSX.Element} 라이브러리 화면
 */
export function LibraryPage() {
    // =============================== 훅 ===================================
    const { readingItemId, onRead } = useReadingRoute(paths.library)

    // =============================== 상태 ===================================
    const [searchText, setSearchText] = useState('') // 검색어
    const [viewFilter, setViewFilter] = useState<Filter>('all')
    const [selectedTagName, setSelectedTagName] = useState<string | null>(null) // 고른 태그 (null이면 태그로 거르지 않음)

    // =============================== 쿼리 훅 ===================================
    const savedItems =
        useSearchQuery({ scope: 'saved', query: searchText, memoOnly: viewFilter === 'memo', tag: selectedTagName ?? undefined }).data ??
        null // 조건에 맞는 저장 기사 (읽어 오는 중이면 null)
    const savedTotal = useSearchQuery({ scope: 'saved' }).data?.length ?? 0 // 거르기 전 저장 기사 수
    const tagsQuery = useTagsQuery()

    // =============================== 계산 ===================================
    const tags = tagsQuery.data ?? []
    const isFiltered = searchText || viewFilter === 'memo' || selectedTagName // 검색 · 필터 · 태그 중 하나라도 걸려 있는지

    // =============================== useEffect ===================================
    // 고른 태그가 더는 없으면(마지막 기사에서 떼면) 필터 해제
    useEffect(() => {
        if (selectedTagName && tagsQuery.data && !tagsQuery.data.some((tag) => tag.name === selectedTagName)) setSelectedTagName(null)
    }, [selectedTagName, tagsQuery.data])

    // 저장 기사를 읽어 오는 중
    if (!savedItems) {
        return (
            <SinglePane label="라이브러리">
                <div className="max-w-190 px-7 py-6">
                    <SkeletonList />
                </div>
            </SinglePane>
        )
    }

    // 목록 머리 (제목 · 건수 · 검색 · 보기 탭 · 태그)
    const listHeader = (
        <ListHeader title="라이브러리" meta={isFiltered ? `${savedItems.length} / ${savedTotal}건` : `${savedTotal}건`}>
            {/* 검색 */}
            <SearchInput value={searchText} onChange={setSearchText} label="라이브러리 검색" placeholder="제목·요약·본문·메모에서 찾기" />

            {/* 보기 탭 */}
            <Tabs
                items={[
                    { id: 'all', label: '전체' },
                    { id: 'memo', label: '메모 있는 기사' }
                ]}
                value={viewFilter}
                onChange={setViewFilter}
                label="보기"
            />

            {/* 태그 (고른 태그를 다시 누르면 해제) */}
            {tags.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {tags.map((tag) => (
                        <Tag
                            key={tag.name}
                            name={tag.name}
                            count={tag.count}
                            selected={selectedTagName === tag.name}
                            onSelect={() => setSelectedTagName(selectedTagName === tag.name ? null : tag.name)}
                        />
                    ))}
                </div>
            )}
        </ListHeader>
    )

    return (
        <ItemListView
            header={listHeader}
            libraryItems={savedItems}
            readingItemId={readingItemId}
            onRead={onRead}
            backLabel="라이브러리로"
            emptyState={
                savedTotal === 0 ? (
                    <EmptyState title="저장한 기사가 없습니다">
                        오늘 브리핑에서 저장(S)하거나 메모를 쓰면 여기에 모입니다. 저장하면 원문 본문도 함께 보관하고 태그를 추천합니다.
                    </EmptyState>
                ) : (
                    <EmptyState title="찾는 기사가 없습니다">검색어나 필터를 바꿔 보세요.</EmptyState>
                )
            }
        />
    )
}
