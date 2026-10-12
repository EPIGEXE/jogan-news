// ============================================================================
// 아카이브 화면
//
// [역할]
// - 날짜별 지난 브리핑 목록 표시, 고른 날짜의 브리핑 열기
// - 지금까지 브리핑에 실린 모든 기사에서 검색
// - 연 날짜 · 검색어 · 읽는 기사를 주소에 보관 (뒤로 가면 직전 목록으로 돌아감)
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { RowReadButton } from '@/domains/article/components/RowReadButton'
import { EmptyState } from '@/common/ui/Notice'
import { ListHeader } from '@/common/layout/ListHeader'
import { SinglePane } from '@/common/layout/AppShell'
import { Button } from '@/common/ui/Button'
import { SearchInput } from '@/common/ui/SearchInput'
import { SkeletonList } from '@/common/ui/Skeleton'
import { useSearchQuery } from '@/domains/article/queries'
import { useDigestByDateQuery, useDigestListQuery } from '@/domains/digest/queries'
import { formatKoreanDate } from '@/common/lib/format'
import { paths, useReadingRoute } from '@/common/lib/paths'
import { useListKeys } from '@/common/lib/useListKeys'
import { DigestView } from '@/domains/digest/DigestView'
import { ItemListView } from '@/domains/article/views/ItemListView'

/**
 * 아카이브 화면 (날짜별 지난 브리핑 목록, 화면 폭 전체)
 *
 * - 다른 목록처럼 J/K로 고르고 Enter · "보기"로 그날 지면 열기
 * - 검색하면 지금까지 브리핑에 실린 모든 기사에서 찾기
 * - 연 날짜 · 검색어 · 읽는 기사는 주소에 보관 (뒤로 가면 직전 목록으로 돌아감)
 *
 * @returns {JSX.Element} 아카이브 화면
 */
export function ArchivePage() {
    // =============================== 훅 ===================================
    const navigate = useNavigate()
    const openedDate = useParams().date ?? null // 주소에 들어 있는, 지금 연 브리핑 날짜 (목록 화면이면 null)
    const searchText = useSearchParams()[0].get('q') ?? '' // 주소에 들어 있는 검색어
    // 읽기 화면의 주소: 날짜를 열었으면 그날 브리핑 아래, 아니면 검색 결과 아래
    const { readingItemId, onRead } = useReadingRoute((itemId) =>
        openedDate
            ? paths.archiveDate(openedDate, itemId)
            : itemId === null
              ? paths.archive(searchText)
              : paths.archiveSearch(searchText, itemId)
    )

    // =============================== 쿼리 훅 ===================================
    const digestSummaries = useDigestListQuery().data ?? null // 지난 브리핑 목록 (읽어 오는 중이면 null)
    const searchResults = useSearchQuery({ scope: 'published', query: searchText }, searchText !== '').data ?? [] // 검색 결과 (검색어가 있을 때만 조회)
    const openedDigest = useDigestByDateQuery(openedDate).data ?? null // 연 날짜의 브리핑

    // =============================== 상태 ===================================
    const [selectedDate, setSelectedDate] = useState<string | null>(null) // 목록에서 고른 날짜

    // =============================== Ref ===================================
    const rowRefs = useRef(new Map<string, HTMLButtonElement>()) // 날짜별 행 버튼 (고른 행을 화면 안으로 스크롤하는 용도)
    const refocusSearchInput = useRef(false) // 검색어를 방금 바꿨는지 (화면 구성이 바뀌어 다시 나타나는 검색창에 포커스를 돌려주는 용도)

    // =============================== 계산 ===================================
    // 검색어 변경 (글자를 칠 때마다 방문 기록이 쌓이지 않게 바꿔치기)
    // 검색어가 생기거나 없어지면 날짜 목록 ↔ 검색 결과로 화면 구성이 바뀌어 검색창이 새로 만들어지므로, 입력을 이어 갈 수 있게 포커스를 돌려주도록 표시
    const setSearchText = (nextSearchText: string) => {
        refocusSearchInput.current = true
        void navigate(paths.archive(nextSearchText), { replace: true })
    }

    const digestIds = (digestSummaries ?? []).map((digestSummary) => digestSummary.id)
    const dateOfDigest = (digestId: number) => digestSummaries?.find((digestSummary) => digestSummary.id === digestId)?.date ?? null
    const selectedDigestId = digestSummaries?.find((digestSummary) => digestSummary.date === selectedDate)?.id ?? null
    // 단축키로 고른 브리핑을 선택하고 그 행이 보이도록 스크롤
    const selectDigestById = useCallback(
        (digestId: number) => {
            const digestDate = digestSummaries?.find((digestSummary) => digestSummary.id === digestId)?.date
            if (!digestDate) return
            setSelectedDate(digestDate)
            rowRefs.current.get(digestDate)?.scrollIntoView({ block: 'nearest' })
        },
        [digestSummaries]
    )

    const openDigest = (digestDate: string) => navigate(paths.archiveDate(digestDate)) // 그날 브리핑 열기

    // 검색 입력란 (검색 결과 화면과 날짜 목록 화면이 함께 사용)
    const searchInput = (
        <SearchInput
            value={searchText}
            onChange={setSearchText}
            label="아카이브 검색"
            placeholder="지금까지 브리핑에 실린 기사에서 찾기"
            autoFocus={refocusSearchInput.current}
        />
    )

    // =============================== useEffect ===================================
    // 포커스 돌려주기 표시는 검색어를 바꾼 직후의 화면에만 적용 (읽기 화면에서 돌아올 때 검색창이 포커스를 가져가지 않게)
    useEffect(() => {
        refocusSearchInput.current = false
    })

    // 처음에는 가장 최근 날짜 선택
    useEffect(() => {
        if (selectedDate === null && digestSummaries?.[0]) setSelectedDate(digestSummaries[0].date)
    }, [digestSummaries, selectedDate])

    // 날짜 목록 단축키 (날짜를 열었거나 검색 중이면 끔)
    useListKeys({
        ids: digestIds,
        selectedId: selectedDigestId,
        onSelect: selectDigestById,
        onOpen: selectedDigestId !== null ? () => openDigest(dateOfDigest(selectedDigestId)!) : undefined,
        enabled: !openedDate && !searchText
    })

    // 브리핑 목록을 읽어 오는 중
    if (!digestSummaries) {
        return (
            <SinglePane label="아카이브">
                <div className="max-w-190 px-7 py-6">
                    <SkeletonList />
                </div>
            </SinglePane>
        )
    }

    // 날짜를 열었으면 그날 지면
    if (openedDigest) {
        return (
            <DigestView
                digest={openedDigest}
                readingItemId={readingItemId}
                onRead={onRead}
                backLabel="그날 목록으로"
                headerActions={
                    <div className="mt-1">
                        <Button variant="text" onClick={() => navigate(paths.archive())}>
                            ← 아카이브로
                        </Button>
                    </div>
                }
            />
        )
    }

    // 검색어가 있으면 검색 결과 목록
    if (searchText) {
        return (
            <ItemListView
                header={
                    <ListHeader title="아카이브" meta={`검색 결과 ${searchResults.length}건`}>
                        {searchInput}
                    </ListHeader>
                }
                libraryItems={searchResults}
                readingItemId={readingItemId}
                onRead={onRead}
                backLabel="검색 결과로"
                emptyState={<EmptyState title="찾는 기사가 없습니다">다른 검색어로 찾아 보세요.</EmptyState>}
            />
        )
    }

    return (
        <SinglePane label="아카이브">
            <div className="flex flex-col gap-2 px-7 pt-6 pb-7">
                {/* 머리 (제목 · 발행 수 · 검색) */}
                <ListHeader title="아카이브" meta={`${digestSummaries.length}호`}>
                    {searchInput}
                </ListHeader>

                {/* 날짜별 브리핑 목록 (한 번 누르면 선택, 두 번 누르거나 "보기"로 열기) */}
                {digestSummaries.length === 0 ? (
                    <EmptyState title="아직 지난 브리핑이 없습니다" />
                ) : (
                    <ol className="m-0 list-none p-0">
                        {digestSummaries.map((digestSummary) => {
                            const isSelected = digestSummary.date === selectedDate
                            return (
                                <li key={digestSummary.id} className="group/row relative">
                                    <button
                                        ref={(rowElement) => {
                                            if (rowElement) rowRefs.current.set(digestSummary.date, rowElement)
                                            else rowRefs.current.delete(digestSummary.date)
                                        }}
                                        type="button"
                                        aria-current={isSelected ? 'true' : undefined}
                                        data-selected={isSelected || undefined}
                                        onClick={() => setSelectedDate(digestSummary.date)}
                                        onDoubleClick={() => openDigest(digestSummary.date)}
                                        className="relative flex w-full cursor-pointer flex-col gap-1 border-0 border-b border-rule-soft bg-transparent py-4 pr-24 pl-3 text-left transition-colors duration-120 hover:bg-paper-sunken/50 data-selected:bg-paper-sunken before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:origin-top before:scale-y-0 before:bg-accent before:transition-transform before:duration-200 before:ease-ink data-selected:before:scale-y-100"
                                    >
                                        <span className="flex flex-wrap gap-x-3 gap-y-1 text-meta font-medium tracking-dateline text-ink-muted tabular-nums">
                                            <span>{formatKoreanDate(digestSummary.date)}</span>
                                            <span>
                                                {digestSummary.entryCount}건
                                                {digestSummary.savedCount ? ` · 저장 ${digestSummary.savedCount}` : ''}
                                            </span>
                                        </span>
                                        <span className="font-display text-title font-semibold text-ink">{digestSummary.headline}</span>
                                    </button>
                                    <RowReadButton
                                        selected={isSelected}
                                        onClick={() => openDigest(digestSummary.date)}
                                        label="보기"
                                        title="이 날 브리핑 보기 (Enter)"
                                    />
                                </li>
                            )
                        })}
                    </ol>
                )}
            </div>
        </SinglePane>
    )
}
