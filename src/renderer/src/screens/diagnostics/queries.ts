// ============================================================================
// 진단 화면 조회 · 변경 훅
//
// [역할]
// - 생성 트리거 상태 · 이벤트 기록을 Main에서 읽어 오기 (화면을 열 때마다 새로 읽음)
// - 네트워크 점검 · 알림 테스트 실행
// ============================================================================
import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DiagEvent } from '@shared/ipc'
import { api } from '@/common/lib/api'
import { queryKeys } from '@/common/lib/queryKeys'

const EMPTY_DIAG_EVENTS: DiagEvent[] = [] // 기록을 읽기 전에 돌려주는 빈 목록

/**
 * 생성 트리거 상태 조회 (마지막 생성 날짜, 다음 타이머 시각)
 *
 * - 화면을 열 때마다 새로 읽음 (staleTime 0)
 *
 * @returns {UseQueryResult} 트리거 상태 조회 결과
 */
export function useTriggerStateQuery() {
    return useQuery({ queryKey: queryKeys.triggerState, queryFn: () => api.getTriggerState(), staleTime: 0 })
}

/**
 * 이벤트 기록 조회
 *
 * - 지금까지의 기록을 읽고, 화면이 열려 있는 동안 새 이벤트를 끝에 추가
 * - 화면을 열 때마다 새로 읽음 (staleTime 0)
 *
 * @returns {DiagEvent[]} 이벤트 기록 (읽기 전이면 빈 목록)
 */
export function useDiagEventsQuery(): DiagEvent[] {
    const queryClient = useQueryClient()

    // 새 이벤트 구독 (도착하면 캐시의 목록 끝에 추가)
    useEffect(
        () =>
            api.onEvent((diagEvent) =>
                queryClient.setQueryData<DiagEvent[]>(queryKeys.diagEvents, (cachedDiagEvents) => [...(cachedDiagEvents ?? []), diagEvent])
            ),
        [queryClient]
    )

    return useQuery({ queryKey: queryKeys.diagEvents, queryFn: () => api.getEvents(), staleTime: 0 }).data ?? EMPTY_DIAG_EVENTS
}

/**
 * 네트워크 점검 실행 (결과는 mutation의 data로 받음)
 *
 * @returns {UseMutationResult} 점검 실행 함수와 결과 · 진행 상태
 */
export function useNetworkChecksMutation() {
    return useMutation({ mutationFn: () => api.runNetworkChecks() })
}

/**
 * 알림 테스트 실행
 *
 * @returns {UseMutationResult} 테스트 실행 함수와 진행 상태
 */
export function useTestNotificationMutation() {
    return useMutation({ mutationFn: () => api.testNotification() })
}
