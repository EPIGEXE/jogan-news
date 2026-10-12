// ============================================================================
// 브리핑 쿼리 훅
//
// [역할]
// - 브리핑 데이터를 읽고 바꾸는 훅 모음 (화면은 api를 직접 부르지 않고 여기 훅만 사용)
// - 최신 브리핑 · 날짜별 브리핑 · 날짜 목록 · 생성 중 여부 조회
// - "지금 만들기" 요청
// ============================================================================
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from '@/common/lib/api'
import { queryKeys } from '@/common/lib/queryKeys'

// =============================== 조회 ===================================

/**
 * 최신 브리핑 조회 (오늘 화면, 질문 화면, 메뉴의 기사 수, 제목 표시줄)
 *
 * @returns {UseQueryResult<DigestDTO | null>} 최신 브리핑 조회 결과
 */
export function useLatestDigestQuery() {
    return useQuery({ queryKey: queryKeys.latestDigest, queryFn: () => api.getLatestDigest() })
}

/**
 * 특정 날짜의 브리핑 조회 (아카이브)
 *
 * @param {string | null} date - 브리핑 날짜 (null이면 조회하지 않음)
 * @returns {UseQueryResult<DigestDTO | null>} 그날 브리핑 조회 결과
 */
export function useDigestByDateQuery(date: string | null) {
    return useQuery({ queryKey: queryKeys.digestByDate(date ?? ''), queryFn: () => api.getDigest(date!), enabled: date !== null })
}

/**
 * 아카이브 날짜 목록 조회 (제목 표시줄의 호수도 이 목록으로 계산)
 *
 * @returns {UseQueryResult<DigestSummaryDTO[]>} 지금까지 발행한 브리핑 목록 조회 결과
 */
export function useDigestListQuery() {
    return useQuery({ queryKey: queryKeys.digestList, queryFn: () => api.listDigests() })
}

/**
 * 지금 브리핑을 만드는 중인지 조회
 *
 * - 처음 한 번만 읽고, 그 뒤로는 진행 알림이 올 때 setRunning으로 수정
 *
 * @returns {boolean} 만드는 중이면 true (아직 읽기 전이면 false)
 */
export function useRunningQuery(): boolean {
    return useQuery({ queryKey: queryKeys.digestRunning, queryFn: () => api.isRunning() }).data ?? false
}

/**
 * "만드는 중" 값 수정 (Main이 화면으로 보낸 진행 알림을 받았을 때)
 *
 * @param {QueryClient} queryClient - 쿼리 캐시
 * @param {boolean} isRunning - 만드는 중인지
 * @returns {void}
 */
export function setRunning(queryClient: QueryClient, isRunning: boolean): void {
    queryClient.setQueryData(queryKeys.digestRunning, isRunning)
}

// =============================== 변경 ===================================

/**
 * 지금 만들기 요청
 *
 * - 결과가 true면 생성 시작, false면 건너뜀 (오늘 브리핑이 이미 있음)
 *
 * @returns {UseMutationResult<boolean>} 지금 만들기 요청 훅
 */
export function useRunNowMutation() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: () => api.runNow(),
        onMutate: () => setRunning(queryClient, true),
        onSuccess: (runStarted) => {
            // 건너뛰었으면 "준비 중"에 멈춰 있지 않게 되돌리고 브리핑을 다시 읽기
            if (!runStarted) {
                setRunning(queryClient, false)
                void queryClient.invalidateQueries({ queryKey: queryKeys.latestDigest })
            }
        },
        onError: () => setRunning(queryClient, false)
    })
}
