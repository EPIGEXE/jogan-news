// ============================================================================
// 기사 목록 화면
//
// [역할]
// - 기사 목록과 고른 기사의 개요(옆 패널)를 나란히 표시 (라이브러리와 아카이브 검색이 함께 사용)
// - 기사를 열면 목록 대신 읽기 화면을 표시하고 이전 · 다음 기사로 이동 제공
// - 목록이 바뀌거나 읽기 화면에서 돌아올 때 고른 기사와 목록 위치를 맞춤
// - 목록 단축키 처리 (기사 고르기 · 저장 · 읽기 · 원문 열기)
// ============================================================================
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { LibraryItemDTO } from '@shared/types'
import { ArticlePreview } from '@/domains/article/components/ArticlePreview'
import { LibraryRow } from '@/domains/article/components/LibraryRow'
import { DetailPane, ListPane } from '@/common/layout/AppShell'
import { SkeletonParagraphs } from '@/common/ui/Skeleton'
import { useArticleActions, useEnrichingQuery, useItemDetailQuery } from '@/domains/article/queries'
import { useListKeys } from '@/common/lib/useListKeys'
import { ArticleReader } from '@/domains/article/views/ArticleReader'

interface Props {
    header: ReactNode // 목록 위에 놓을 것 (제목 · 검색창 · 필터)
    libraryItems: LibraryItemDTO[]
    emptyState: ReactNode // 목록이 비었을 때 보여줄 것
    readingItemId: number | null // 읽기 화면으로 보고 있는 기사 (목록을 보는 중이면 null), 화면 쪽에서 주소로 관리
    onRead(itemId: number | null): void // 기사를 읽기 화면으로 열기(번호) 또는 목록으로 돌아가기(null)
    backLabel: string // 읽기 화면의 "← …" 글자
}

/**
 * 기사 목록 + 옆 패널(개요) + 읽기 화면
 *
 * - 라이브러리와 아카이브 검색이 함께 사용
 *
 * @returns {JSX.Element} 목록과 개요, 기사를 읽는 중이면 읽기 화면
 */
export function ItemListView({ header, libraryItems, emptyState, readingItemId, onRead, backLabel }: Props) {
    // =============================== 상태 ===================================
    const [selectedId, setSelectedId] = useState<number | null>(readingItemId) // 목록에서 고른 기사 (처음에는 주소로 연 기사)

    // =============================== 쿼리 훅 ===================================
    // 목록 행에는 요약 · 핵심 포인트가 없어서, 고른 기사의 상세를 불러와 개요 · 읽기 화면에 사용 (캐시에 있으면 바로)
    const selectedArticle = useItemDetailQuery(selectedId).data ?? null
    const isEnriching = useEnrichingQuery(selectedId) // 고른 기사의 저장 후 보강이 도는 중인지

    // =============================== 훅 ===================================
    const articleActions = useArticleActions(selectedArticle) // 고른 기사에 대한 동작 (상세를 아직 못 받았으면 null)

    // =============================== Ref ===================================
    const rowRefs = useRef(new Map<number, HTMLButtonElement>()) // 기사 번호별 목록 행 요소 (행을 보이는 곳으로 스크롤하는 용도)
    const lastReadingId = useRef(readingItemId) // 직전 렌더에서 읽던 기사, 목록으로 돌아온 순간을 알아내는 용도

    // =============================== 계산 ===================================
    const isReading = readingItemId !== null // 읽기 화면을 보는 중인지
    const itemIds = useMemo(() => libraryItems.map((libraryItem) => libraryItem.itemId), [libraryItems])

    // 기사 고르기 (shouldScroll이 true면 그 행이 보이게 목록을 이동)
    const selectItem = (itemId: number, shouldScroll = false) => {
        setSelectedId(itemId)
        if (shouldScroll) setTimeout(() => rowRefs.current.get(itemId)?.scrollIntoView({ block: 'nearest' }), 0)
    }

    // =============================== useEffect ===================================
    // 목록이 바뀌면(검색 · 필터) 첫 기사 선택 (고른 기사가 목록에 남아 있으면 유지)
    useEffect(() => {
        if (selectedId !== null && itemIds.includes(selectedId)) return
        // 읽는 중인데 목록이 비어 있으면 아직 목록을 받는 중이므로 유지
        if (isReading && itemIds.length === 0) return
        setSelectedId(itemIds[0] ?? null)
        if (isReading) onRead(null)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [itemIds])

    // 주소로 읽기 화면이 열리거나 이전 · 다음 기사로 옮기면 그 기사 선택
    useEffect(() => {
        if (readingItemId !== null) setSelectedId(readingItemId)
    }, [readingItemId])

    // 읽기 화면에서 목록으로 돌아오면 읽던 기사가 보이게 목록 이동
    useEffect(() => {
        if (lastReadingId.current !== null && readingItemId === null)
            rowRefs.current.get(lastReadingId.current)?.scrollIntoView({ block: 'nearest' })
        lastReadingId.current = readingItemId
    }, [readingItemId])

    // 목록 단축키 (읽기 화면에서는 끔)
    useListKeys({
        ids: itemIds,
        selectedId,
        onSelect: (itemId) => selectItem(itemId, true),
        onSave: articleActions?.onToggleSave,
        onOpen: selectedArticle ? () => onRead(selectedArticle.itemId) : undefined,
        onOpenOriginal: selectedArticle ? () => articleActions?.onOpenUrl(selectedArticle.url) : undefined,
        enabled: !isReading
    })

    // 읽기 화면 (기사를 여는 중이고 상세를 받았을 때)
    if (isReading && selectedArticle) {
        const readingIndex = itemIds.indexOf(selectedArticle.itemId)
        // 목록에서 앞뒤에 있는 기사의 제목과 그 기사로 가는 함수 (없으면 undefined)
        const neighborOf = (neighborItemId: number | undefined) => {
            const neighborItem = libraryItems.find((libraryItem) => libraryItem.itemId === neighborItemId)
            return neighborItem ? { title: neighborItem.titleKo, open: () => onRead(neighborItem.itemId) } : undefined
        }
        return (
            <ArticleReader
                article={selectedArticle}
                onBack={() => onRead(null)}
                backLabel={backLabel}
                previousArticle={neighborOf(itemIds[readingIndex - 1])}
                nextArticle={neighborOf(itemIds[readingIndex + 1])}
            />
        )
    }

    return (
        <>
            {/* 기사 목록 */}
            <ListPane label="기사 목록">
                <div className="flex min-h-full flex-col px-7 pt-6">
                    {header}
                    <div className="flex-1 pb-8">
                        {libraryItems.length === 0 ? (
                            emptyState
                        ) : (
                            <ol className="-mx-3 mt-2 list-none p-0">
                                {libraryItems.map((libraryItem) => (
                                    <li key={libraryItem.itemId}>
                                        <LibraryRow
                                            ref={(rowElement) => {
                                                if (rowElement) rowRefs.current.set(libraryItem.itemId, rowElement)
                                                else rowRefs.current.delete(libraryItem.itemId)
                                            }}
                                            libraryItem={libraryItem}
                                            selected={libraryItem.itemId === selectedId}
                                            onSelect={() => selectItem(libraryItem.itemId)}
                                            onOpen={() => {
                                                selectItem(libraryItem.itemId)
                                                onRead(libraryItem.itemId)
                                            }}
                                        />
                                    </li>
                                ))}
                            </ol>
                        )}
                    </div>
                </div>
            </ListPane>

            {/* 고른 기사의 개요 (상세를 받는 동안은 뼈대) */}
            <DetailPane label="선택한 기사">
                {selectedId !== null && !selectedArticle && (
                    <div className="px-7 py-6">
                        <SkeletonParagraphs count={3} />
                    </div>
                )}
                {selectedArticle && articleActions && (
                    <ArticlePreview
                        article={selectedArticle}
                        onToggleSave={articleActions.onToggleSave}
                        onOpenOriginal={() => articleActions.onOpenUrl(selectedArticle.url)}
                        onAddTag={articleActions.onAddTag}
                        onRemoveTag={articleActions.onRemoveTag}
                        isEnriching={isEnriching}
                    />
                )}
            </DetailPane>
        </>
    )
}
