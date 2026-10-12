// ============================================================================
// 기사 캐시 갱신
//
// [역할]
// - 기사 한 건이 바뀌면 화면에 보관 중인 데이터(캐시)를 한꺼번에 수정
//   (같은 기사가 브리핑 · 검색 결과 · 기사 상세 캐시에 따로 들어 있음)
// - 저장 후 보강이 도는 중인지 표시하는 값 기록
// ============================================================================
import type { QueryClient } from '@tanstack/react-query'
import type { DigestDTO, ItemDetailDTO, LibraryItemDTO } from '@shared/types'
import { queryKeys } from '@/common/lib/queryKeys'
import type { ArticleView } from '@/domains/article/types'

// 바뀐 내용 중 검색 결과 한 줄(LibraryItemDTO)에도 있는 필드만 추림
function pickLibraryFields(patch: Partial<ArticleView>): Partial<LibraryItemDTO> {
    const libraryPatch: Partial<LibraryItemDTO> = {}
    if (patch.isSaved !== undefined) libraryPatch.isSaved = patch.isSaved
    if (patch.memo !== undefined) libraryPatch.memo = patch.memo
    if (patch.tags !== undefined) libraryPatch.tags = patch.tags
    return libraryPatch
}

/**
 * 기사 한 건을 모든 캐시(브리핑 · 검색 결과 · 상세)에서 수정
 *
 * @param {QueryClient} queryClient - 캐시를 들고 있는 쿼리 클라이언트
 * @param {number} itemId - 고칠 기사 번호
 * @param {Partial<ArticleView>} patch - 바뀐 필드만 담은 값
 * @returns {void}
 */
export function patchArticle(queryClient: QueryClient, itemId: number, patch: Partial<ArticleView>): void {
    // 브리핑: 그 기사가 실린 브리핑만 수정
    queryClient.setQueriesData<DigestDTO | null>({ queryKey: queryKeys.digests }, (digest) =>
        digest && digest.entries.some((entry) => entry.itemId === itemId)
            ? { ...digest, entries: digest.entries.map((entry) => (entry.itemId === itemId ? { ...entry, ...patch } : entry)) }
            : digest
    )
    // 검색 결과: 목록 한 줄에도 있는 필드가 바뀌었을 때만 수정
    const libraryPatch = pickLibraryFields(patch)
    if (Object.keys(libraryPatch).length) {
        queryClient.setQueriesData<LibraryItemDTO[]>({ queryKey: queryKeys.searches }, (libraryItems) =>
            libraryItems?.some((libraryItem) => libraryItem.itemId === itemId)
                ? libraryItems.map((libraryItem) => (libraryItem.itemId === itemId ? { ...libraryItem, ...libraryPatch } : libraryItem))
                : libraryItems
        )
    }
    // 기사 상세
    queryClient.setQueryData<ItemDetailDTO | null>(queryKeys.itemDetail(itemId), (itemDetail) =>
        itemDetail ? { ...itemDetail, ...patch } : itemDetail
    )
}

/**
 * 저장 후 보강(본문 추출 · 태그 추천)이 도는 중인지 표시
 *
 * - 보강이 끝나면 item-updated에서 해제
 *
 * @param {QueryClient} queryClient - 캐시를 들고 있는 쿼리 클라이언트
 * @param {number} itemId - 기사 번호
 * @param {boolean} isEnriching - 보강 중이면 true
 * @returns {void}
 */
export function setEnriching(queryClient: QueryClient, itemId: number, isEnriching: boolean): void {
    queryClient.setQueryData(queryKeys.enriching(itemId), isEnriching)
}
