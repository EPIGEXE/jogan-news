// ============================================================================
// 출처 화면 조회 훅
//
// [역할]
// - 출처별 수집 · 게재 통계를 Main에서 읽어 오기
// ============================================================================
import { useQuery } from '@tanstack/react-query'
import type { StatsPeriod } from '@shared/types'
import { api } from '@/common/lib/api'
import { queryKeys } from '@/common/lib/queryKeys'

/**
 * 출처별 수집 · 게재 통계 조회
 *
 * - 새 브리핑이 게시되면 무효화되어 다시 조회
 *
 * @param {StatsPeriod} period - 통계를 낼 기간 (7일 · 30일 · 전체)
 * @returns {UseQueryResult} 통계 조회 결과
 */
export function useSourceStatsQuery(period: StatsPeriod) {
    return useQuery({ queryKey: queryKeys.sourceStats(period), queryFn: () => api.getSourceStats(period) })
}
