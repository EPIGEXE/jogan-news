// ============================================================================
// 하이라이트 쿼리 훅
//
// [역할]
// - 하이라이트를 긋고 · 메모를 고치고 · 지우는 훅 모음
// - 결과로 돌아온 하이라이트 목록을 기사 상세 캐시에 반영
// - 실패하면 안내 메시지 표시
// ============================================================================
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { HighlightRange } from '@shared/types'
import { api } from '@/common/lib/api'
import { toast } from '@/common/lib/toast'
import { setHighlights } from '@/domains/highlight/cache'

/**
 * 하이라이트 긋기
 *
 * - 그은 기사는 Worker가 자동으로 저장 (저장 표시는 부르는 쪽에서 반영)
 *
 * @returns {UseMutationResult<HighlightDTO[]>} 기사 번호(itemId)와 위치 목록(ranges)을 받는 요청 훅
 */
export function useAddHighlightsMutation() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ itemId, ranges }: { itemId: number; ranges: HighlightRange[] }) => api.addHighlights(itemId, ranges),
        onSuccess: (highlights, { itemId }) => setHighlights(queryClient, itemId, highlights),
        onError: () => toast('하이라이트하지 못했습니다')
    })
}

/**
 * 하이라이트 메모 고치기
 *
 * @returns {UseMutationResult<HighlightDTO[]>} 기사 번호(itemId) · 하이라이트 id · 메모(note)를 받는 요청 훅
 */
export function useUpdateHighlightNoteMutation() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ highlightId, note }: { itemId: number; highlightId: number; note: string }) =>
            api.updateHighlightNote(highlightId, note),
        onSuccess: (highlights, { itemId }) => setHighlights(queryClient, itemId, highlights),
        onError: () => toast('메모를 저장하지 못했습니다')
    })
}

/**
 * 하이라이트 지우기
 *
 * @returns {UseMutationResult<HighlightDTO[]>} 기사 번호(itemId) · 하이라이트 id를 받는 요청 훅
 */
export function useRemoveHighlightMutation() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ highlightId }: { itemId: number; highlightId: number }) => api.removeHighlight(highlightId),
        onSuccess: (highlights, { itemId }) => setHighlights(queryClient, itemId, highlights),
        onError: () => toast('하이라이트를 지우지 못했습니다')
    })
}
