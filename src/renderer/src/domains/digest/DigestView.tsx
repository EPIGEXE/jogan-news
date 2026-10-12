// ============================================================================
// 브리핑 한 호 화면
//
// [역할]
// - 브리핑 한 호를 지면 머리 · 섹션별 기사 목록 · 옆 패널(선택한 기사 개요)로 표시
// - 분류 필터와 키보드 단축키로 기사 선택 (선택한 기사는 읽음 처리)
// - "기사 읽기"를 누르면 같은 자리에 읽기 화면 표시
// - 오늘 화면과 아카이브가 함께 사용
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CATEGORIES, CATEGORY_SHORT, SECTION_LABEL, SECTION_ORDER, type Category, type DigestDTO } from '@shared/types'
import { ArticleGroup } from '@/domains/article/components/ArticleGroup'
import { ArticlePreview } from '@/domains/article/components/ArticlePreview'
import { ArticleRow } from '@/domains/article/components/ArticleRow'
import { EditionHeader } from '@/domains/digest/EditionHeader'
import { DetailPane, ListPane } from '@/common/layout/AppShell'
import { Tabs, type TabItem } from '@/common/ui/Tabs'
import { useArticleActions, useEnrichingQuery, useMarkReadMutation } from '@/domains/article/queries'
import { useListKeys } from '@/common/lib/useListKeys'
import { ArticleReader } from '@/domains/article/views/ArticleReader'

type Filter = 'all' | Category // 분류 필터 값 (전체 또는 분류 하나)

interface Props {
    digest: DigestDTO
    notice?: string
    headerActions?: ReactNode // 머리 아래쪽에 놓을 것 (오늘 브리핑 만들기 버튼 등)
    belowHeader?: ReactNode // 머리와 목록 사이에 놓을 것 (진행 상황, 오류 안내 등)
    readingItemId: number | null // 읽기 화면으로 보고 있는 기사 (목록을 보는 중이면 null), 화면 쪽에서 주소로 관리
    onRead(itemId: number | null): void // 기사를 읽기 화면으로 열기(번호) 또는 목록으로 돌아가기(null)
    backLabel?: string // 읽기 화면의 "← …" 글자
    isFresh?: boolean // 방금 만들어진 브리핑인지 (지면 머리 이중선이 그어지는 움직임)
}

/**
 * 브리핑 한 호 (지면 머리 + 섹션별 목록 + 옆 패널의 개요)
 *
 * - "기사 읽기"를 누르면 읽기 화면으로 전환
 * - 오늘 화면과 아카이브가 함께 사용
 *
 * @param {Props} props - 보여줄 브리핑과 읽기 화면 열고 닫기 연결
 * @returns {JSX.Element} 목록 + 옆 패널, 또는 읽기 화면
 */
export function DigestView(props: Props) {
    const { digest } = props
    const { readingItemId, onRead } = props

    // =============================== 상태 ===================================
    const [categoryFilter, setCategoryFilter] = useState<Filter>('all') // 고른 분류 필터
    const [selectedId, setSelectedId] = useState<number | null>(null) // 목록에서 고른 기사 (옆 패널에 개요 표시)

    // =============================== 쿼리 훅 ===================================
    const { mutate: markRead } = useMarkReadMutation()
    const isEnriching = useEnrichingQuery(selectedId) // 고른 기사의 저장 후 보강이 도는 중인지

    // =============================== Ref ===================================
    const rowRefs = useRef(new Map<number, HTMLButtonElement>()) // 기사 번호별 목록 줄 요소 (스크롤 맞춤용)
    const lastReadingId = useRef(readingItemId) // 직전 렌더에서 읽던 기사, 읽기 화면에서 돌아온 순간을 알아내는 용도

    // =============================== 계산 ===================================
    const entries = digest.entries
    // 필터에 맞는 기사
    const visibleEntries = useMemo(
        () => (categoryFilter === 'all' ? entries : entries.filter((entry) => entry.category === categoryFilter)),
        [entries, categoryFilter]
    )
    // 섹션별 묶음 (기사가 없는 섹션은 제외)
    const sectionGroups = useMemo(
        () =>
            SECTION_ORDER.map((section) => ({ section, items: visibleEntries.filter((entry) => entry.section === section) })).filter(
                (sectionGroup) => sectionGroup.items.length
            ),
        [visibleEntries]
    )
    // 화면에 보이는 순서(섹션 순)의 기사 번호 (이동은 이 순서를 따름)
    const orderedIds = useMemo(
        () => sectionGroups.flatMap((sectionGroup) => sectionGroup.items.map((entry) => entry.itemId)),
        [sectionGroups]
    )
    const selectedEntry = entries.find((entry) => entry.itemId === selectedId) ?? null
    const readingEntry = entries.find((entry) => entry.itemId === readingItemId) ?? null

    // 분류 필터 탭 (기사가 있는 분류만, 이름 옆에 기사 수)
    const filterTabs: TabItem<Filter>[] = useMemo(() => {
        const entryCountByCategory = new Map<Category, number>()
        for (const entry of entries) entryCountByCategory.set(entry.category, (entryCountByCategory.get(entry.category) ?? 0) + 1)
        return [
            { id: 'all' as const, label: `전체 ${entries.length}` },
            ...CATEGORIES.filter((category) => entryCountByCategory.get(category)).map((category) => ({
                id: category,
                label: `${CATEGORY_SHORT[category]} ${entryCountByCategory.get(category)}`
            }))
        ]
    }, [entries])

    // 기사 고르기 (아직 안 읽은 기사면 읽음 처리)
    const selectEntry = useCallback(
        (itemId: number, shouldScroll = false) => {
            setSelectedId(itemId)
            // 키보드로 옮길 때만 목록을 따라 스크롤 (첫 자동 선택이나 클릭에서는 화면을 움직이지 않음)
            if (shouldScroll) setTimeout(() => rowRefs.current.get(itemId)?.scrollIntoView({ block: 'nearest' }), 0)
            const targetEntry = entries.find((entry) => entry.itemId === itemId)
            if (targetEntry && !targetEntry.isRead) markRead(itemId)
        },
        [entries, markRead]
    )

    // 기사를 고르고 읽기 화면으로 열기
    const readEntry = (itemId: number) => {
        selectEntry(itemId)
        onRead(itemId)
    }

    // =============================== 훅 ===================================
    const articleActions = useArticleActions(selectedEntry) // 고른 기사의 저장 · 태그 · 원문 열기 동작 (고른 기사가 없으면 null)

    // =============================== useEffect ===================================
    // 브리핑이나 필터가 바뀌면 첫 기사 선택 (읽는 기사가 있으면 아래에서 그 기사를 고르므로 건너뜀)
    useEffect(() => {
        if (readingEntry) return
        if (orderedIds.length && (selectedId === null || !orderedIds.includes(selectedId))) selectEntry(orderedIds[0]!)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [digest.id, categoryFilter])

    // 주소로 읽기 화면이 열리면(질문 화면의 인용, 뒤로 · 앞으로) 그 기사를 고르고, 필터에 가려 있으면 필터 해제
    // 이 브리핑에 없는 기사 번호면 목록으로 복귀
    useEffect(() => {
        if (readingItemId === null) return
        if (!readingEntry) {
            onRead(null)
            return
        }
        if (!orderedIds.includes(readingItemId)) setCategoryFilter('all')
        selectEntry(readingItemId)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [readingItemId, digest.id])

    // 읽기 화면에서 목록으로 돌아오면 읽던 기사가 보이게 목록 스크롤 맞춤
    useEffect(() => {
        if (lastReadingId.current !== null && readingItemId === null)
            rowRefs.current.get(lastReadingId.current)?.scrollIntoView({ block: 'nearest' })
        lastReadingId.current = readingItemId
    }, [readingItemId])

    // 목록 단축키 연결 (읽기 화면을 보는 동안은 끔)
    useListKeys({
        ids: orderedIds,
        selectedId,
        onSelect: (itemId) => selectEntry(itemId, true),
        onSave: articleActions?.onToggleSave,
        onOpen: selectedEntry ? () => readEntry(selectedEntry.itemId) : undefined,
        onOpenOriginal: selectedEntry ? () => articleActions?.onOpenUrl(selectedEntry.url) : undefined,
        enabled: !readingEntry
    })

    // 읽기 화면 (이전 · 다음 기사는 목록에 보이는 순서 기준)
    if (readingEntry) {
        const readingIndex = orderedIds.indexOf(readingEntry.itemId)
        const neighborLink = (neighborId: number | undefined) => {
            const neighborEntry = entries.find((entry) => entry.itemId === neighborId)
            return neighborEntry ? { title: neighborEntry.titleKo, open: () => readEntry(neighborEntry.itemId) } : undefined
        }
        return (
            <ArticleReader
                article={readingEntry}
                onBack={() => onRead(null)}
                backLabel={props.backLabel ?? '목록으로'}
                previousArticle={neighborLink(orderedIds[readingIndex - 1])}
                nextArticle={neighborLink(orderedIds[readingIndex + 1])}
            />
        )
    }

    return (
        <>
            {/* 기사 목록 */}
            <ListPane label="기사 목록">
                <div className="flex min-h-full flex-col px-7 pt-6">
                    {/* 지면 머리 */}
                    <EditionHeader
                        date={digest.date}
                        createdAt={digest.createdAt}
                        headline={digest.headline}
                        overview={digest.overview}
                        stats={digest.stats}
                        notice={props.notice}
                        actions={props.headerActions}
                        isFresh={props.isFresh}
                    />
                    {props.belowHeader}

                    {/* 분류 필터 */}
                    <div className="border-b border-rule py-3">
                        <Tabs items={filterTabs} value={categoryFilter} onChange={setCategoryFilter} label="분류" scroll />
                    </div>

                    {/* 섹션별 기사 */}
                    <div className="flex-1 pb-8">
                        {sectionGroups.map((sectionGroup) => (
                            <ArticleGroup key={sectionGroup.section} label={SECTION_LABEL[sectionGroup.section]}>
                                {sectionGroup.items.map((entry) => (
                                    <li key={entry.itemId}>
                                        <ArticleRow
                                            ref={(rowElement) => {
                                                if (rowElement) rowRefs.current.set(entry.itemId, rowElement)
                                                else rowRefs.current.delete(entry.itemId)
                                            }}
                                            entry={entry}
                                            selected={entry.itemId === selectedId}
                                            onSelect={() => selectEntry(entry.itemId)}
                                            onOpen={() => readEntry(entry.itemId)}
                                        />
                                    </li>
                                ))}
                            </ArticleGroup>
                        ))}
                    </div>
                </div>
            </ListPane>

            {/* 선택한 기사 개요 */}
            <DetailPane label="선택한 기사">
                {selectedEntry && articleActions && (
                    <ArticlePreview
                        article={selectedEntry}
                        onToggleSave={articleActions.onToggleSave}
                        onOpenOriginal={() => articleActions.onOpenUrl(selectedEntry.url)}
                        onAddTag={articleActions.onAddTag}
                        onRemoveTag={articleActions.onRemoveTag}
                        isEnriching={isEnriching}
                    />
                )}
            </DetailPane>
        </>
    )
}
