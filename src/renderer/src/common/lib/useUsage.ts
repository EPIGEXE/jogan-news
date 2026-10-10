import { useQuery } from '@tanstack/react-query'
import { api } from '@/common/lib/api'
import { qk } from '@/common/lib/queryKeys'

/** 이번 달·오늘 LLM 사용액과 예산 (메뉴 아래 비용 표시, 설정 화면). 생성이 끝나거나 예산을 바꾸면 무효화된다 */
export function useUsage() {
  return useQuery({ queryKey: qk.usage, queryFn: () => api.getUsage() })
}
