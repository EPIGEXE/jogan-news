import type { ChatScope, SearchParams, StatsPeriod } from '@shared/types'

/**
 * TanStack Query 키. 화면 데이터는 모두 Worker(IPC)에서 오고, 여기 키 아래에 캐시된다.
 * 같은 기사가 여러 목록에 있어도 domains/article/cache.ts의 patchArticle이 한꺼번에 고친다.
 */
export const qk = {
  /** 모든 브리핑 (최신 + 날짜별) */
  digests: ['digest'] as const,
  latestDigest: ['digest', 'latest'] as const,
  digestByDate: (date: string) => ['digest', 'date', date] as const,
  /** 아카이브 날짜 목록 */
  digestList: ['digestList'] as const,
  item: (itemId: number) => ['item', itemId] as const,
  /** 저장 후 보강(본문 추출·태그 추천) 중인지: 서버 데이터가 아니라 화면 표시용 값 */
  enriching: (itemId: number) => ['enriching', itemId] as const,
  searches: ['search'] as const,
  search: (p: SearchParams) => ['search', p] as const,
  tags: ['tags'] as const,
  chat: (scope: ChatScope) => ['chat', scope.kind === 'item' ? `item:${scope.itemId}` : `digest:${scope.date}`] as const,
  quickActions: ['quickActions'] as const,
  usage: ['usage'] as const,
  settings: ['settings'] as const,
  apiKey: ['apiKey'] as const,
  autostart: ['autostart'] as const,
  sources: (period: StatsPeriod) => ['sources', period] as const,
  allSources: ['sources'] as const
}
