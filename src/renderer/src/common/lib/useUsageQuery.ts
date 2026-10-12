// ============================================================================
// LLM 사용액 조회
//
// [역할]
// - 이번 달 · 오늘 LLM 사용액과 예산 읽기 (메뉴 아래 비용 표시 · 설정 화면에서 사용)
// - 브리핑 생성이 끝나거나 예산을 바꾸면 새로 읽음
// ============================================================================
import { useQuery } from '@tanstack/react-query'
import { api } from '@/common/lib/api'
import { queryKeys } from '@/common/lib/queryKeys'

/**
 * 이번 달 · 오늘 LLM 사용액과 예산 조회
 *
 * - 생성이 끝나거나 예산을 바꾸면 무효화되어 다시 읽음
 *
 * @returns {UseQueryResult} 사용액 조회 결과 (data에 사용액과 예산)
 */
export function useUsageQuery() {
    return useQuery({ queryKey: queryKeys.usage, queryFn: () => api.getUsage() })
}
