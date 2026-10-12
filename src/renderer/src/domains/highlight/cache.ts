// ============================================================================
// 하이라이트 캐시 반영
//
// [역할]
// - 바뀐 하이라이트 목록을 기사 상세 캐시에 반영 (하이라이트 목록이 기사 상세 안에 들어 있기 때문)
// ============================================================================
import type { QueryClient } from '@tanstack/react-query'
import type { HighlightDTO, ItemDetailDTO } from '@shared/types'
import { queryKeys } from '@/common/lib/queryKeys'

/**
 * 바뀐 하이라이트 목록을 기사 상세 캐시에 반영
 *
 * @param {QueryClient} queryClient - 쿼리 캐시
 * @param {number} itemId - 기사 번호
 * @param {HighlightDTO[]} highlights - 바뀐 뒤의 하이라이트 목록
 * @returns {void}
 */
export function setHighlights(queryClient: QueryClient, itemId: number, highlights: HighlightDTO[]): void {
    queryClient.setQueryData<ItemDetailDTO | null>(queryKeys.itemDetail(itemId), (itemDetail) =>
        itemDetail ? { ...itemDetail, highlights } : itemDetail
    )
}
