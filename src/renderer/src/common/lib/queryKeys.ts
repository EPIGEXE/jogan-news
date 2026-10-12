// ============================================================================
// 캐시 키
//
// [역할]
// - 화면 데이터를 캐시에 넣고 찾을 때 쓰는 이름표(TanStack Query 키) 모음
// - 화면 데이터는 모두 Worker(IPC)에서 오고 여기 키 아래에 보관
// - 같은 기사가 여러 목록에 있어도 domains/article/cache.ts의 patchArticle이 한꺼번에 수정
// ============================================================================
import type { ChatScope, SearchParams, StatsPeriod } from '@shared/types'

export const queryKeys = {
    digests: ['digest'] as const, // 모든 브리핑 (최신 + 날짜별)
    latestDigest: ['digest', 'latest'] as const,
    digestByDate: (date: string) => ['digest', 'date', date] as const,
    digestList: ['digestList'] as const, // 아카이브 날짜 목록
    digestRunning: ['running'] as const, // 지금 브리핑을 만드는 중인지
    itemDetail: (itemId: number) => ['item', itemId] as const,
    enriching: (itemId: number) => ['enriching', itemId] as const, // 저장 후 보강(본문 추출 · 태그 추천) 중인지 (서버 데이터가 아닌 화면 표시용 값)
    searches: ['search'] as const,
    search: (searchParams: SearchParams) => ['search', searchParams] as const,
    tags: ['tags'] as const,
    chat: (scope: ChatScope) => ['chat', scope.kind === 'item' ? `item:${scope.itemId}` : `digest:${scope.date}`] as const,
    chatHistory: ['chatHistory'] as const, // 지난 질문 목록 (질문한 적 있는 기사 · 브리핑)
    quickActions: ['quickActions'] as const,
    usage: ['usage'] as const,
    settings: ['settings'] as const,
    apiKey: ['apiKey'] as const,
    autostart: ['autostart'] as const,
    sourceStats: (period: StatsPeriod) => ['sources', period] as const,
    allSourceStats: ['sources'] as const,
    triggerState: ['diag', 'trigger'] as const,
    diagEvents: ['diag', 'events'] as const,
    windowMaximized: ['windowMaximized'] as const
}
