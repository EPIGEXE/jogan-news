// ============================================================================
// 창 최대화 여부 조회
//
// [역할]
// - 창이 최대화돼 있는지 알려줌 (제목 표시줄의 최대화 · 복원 버튼 모양 결정용)
// - 처음 한 번 읽고, 그 뒤로는 Main이 알려줄 때 값 갱신
// ============================================================================
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/common/lib/api'
import { queryKeys } from '@/common/lib/queryKeys'

/**
 * 창이 최대화돼 있는지 읽기
 *
 * - 처음 한 번 Main에 물어보고, 그 뒤로는 Main의 변경 알림으로 캐시 값을 고침
 *
 * @returns {boolean} 최대화 여부 (아직 읽지 못했으면 false)
 */
export function useWindowMaximizedQuery(): boolean {
    const queryClient = useQueryClient()

    // Main의 최대화 상태 변경 알림 구독
    useEffect(
        () => api.onWindowMaximizedChanged((isMaximized) => queryClient.setQueryData(queryKeys.windowMaximized, isMaximized)),
        [queryClient]
    )

    return useQuery({ queryKey: queryKeys.windowMaximized, queryFn: () => api.windowIsMaximized() }).data ?? false
}
