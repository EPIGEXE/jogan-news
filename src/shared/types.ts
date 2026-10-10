// Main · Worker · Renderer가 함께 쓰는 도메인 타입.

export const CATEGORIES = [
  'model_release',
  'tools',
  'applied',
  'research',
  'community',
  'industry',
  'other'
] as const
export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABEL: Record<Category, string> = {
  model_release: '모델 출시',
  tools: '도구·라이브러리',
  applied: '실전·응용',
  research: '주목할 논문',
  community: '커뮤니티 화제',
  industry: '업계·정책',
  other: '그 외 주요 소식'
}

/** 분류 필터 탭처럼 좁은 곳에 쓰는 짧은 이름 */
export const CATEGORY_SHORT: Record<Category, string> = {
  model_release: '모델',
  tools: '도구',
  applied: '실전',
  research: '논문',
  community: '커뮤니티',
  industry: '업계',
  other: '그 외'
}

/** 브리핑 섹션: 상위 5개는 'top', 나머지는 분류별 */
export type Section = 'top' | Category

export const SECTION_ORDER: Section[] = ['top', ...CATEGORIES]

export const SECTION_LABEL: Record<Section, string> = { top: '오늘의 톱', ...CATEGORY_LABEL }

export interface SourceRef {
  sourceName: string
  url: string
  engagementLabel: string | null
}

export interface DigestEntryDTO {
  itemId: number
  rank: number
  section: Section
  category: Category
  titleKo: string
  originalTitle: string
  summaryKo: string
  keyPoints: string[]
  whyItMatters: string | null
  url: string
  sourceName: string
  engagementLabel: string | null
  /** 같은 소식을 다룬 다른 출처 */
  otherSources: SourceRef[]
  publishedAt: string | null
  isRead: boolean
  isSaved: boolean
  memo: string
  tags: string[]
  /** 지난 브리핑 소식의 후속 보도면 그 지난 기사 */
  followUpOf: FollowUpRef | null
}

/** 라이브러리·아카이브 검색 결과 한 줄 */
export interface LibraryItemDTO {
  itemId: number
  titleKo: string
  originalTitle: string
  summaryKo: string
  category: Category
  sourceName: string
  url: string
  isSaved: boolean
  savedAt: string | null
  /** 이 기사가 실린 브리핑 날짜 (없으면 null) */
  digestDate: string | null
  memo: string
  tags: string[]
}

/** 하이라이트를 그은 본문 판: 번역문 또는 원문 (문단 번호는 같다) */
export type HighlightVariant = 'ko' | 'original'

/** 하이라이트 위치: 문단 번호(1부터)와 그 문단 글자 안의 [start, end) */
export interface HighlightRange {
  paragraph: number
  variant: HighlightVariant
  start: number
  end: number
}

export interface HighlightDTO extends HighlightRange {
  id: number
  text: string
  note: string
  createdAt: string
}

/** 지난 7일 브리핑에 실린 기사의 후속 소식일 때, 그 지난 기사 */
export interface FollowUpRef {
  itemId: number
  titleKo: string
  digestDate: string | null
}

/** 기사 하나의 전체 정보 (기사 패널·본문 탭) */
export interface ItemDetailDTO extends Omit<DigestEntryDTO, 'rank' | 'section'> {
  savedAt: string | null
  digestDate: string | null
  paragraphs: string[]
  /** false면 본문 추출에 실패해 요약·초록만 있음 */
  fullText: boolean
  /** 문단별 한국어 번역. paragraphs와 같은 순서·길이, 상한을 넘어 번역하지 않은 문단은 null */
  paragraphsKo: (string | null)[] | null
  translation: TranslationState
  highlights: HighlightDTO[]
}

/**
 * 본문 번역 상태
 * - not_needed: 한국어 기사라 번역하지 않음
 * - missing: 아직 번역하지 않음 (열면 번역을 요청한다)
 * - done: 번역됨 (paragraphsKo에 null이 있으면 길어서 앞부분만 번역한 것)
 */
export type TranslationState = 'not_needed' | 'missing' | 'done'

export interface DigestSummaryDTO {
  id: number
  date: string
  headline: string
  entries: number
  saved: number
}

export interface TagCount {
  name: string
  count: number
}

export type SearchScope = 'saved' | 'published'

export interface SearchParams {
  scope: SearchScope
  query?: string
  tag?: string
  memoOnly?: boolean
}

/** 질문 범위: 기사 하나 또는 그날 브리핑 전체 */
export type ChatScope = { kind: 'item'; itemId: number } | { kind: 'digest'; date: string }

export interface ChatMessageDTO {
  id: number
  role: 'user' | 'assistant'
  /** 답변에는 인용 표시가 들어 있다: 기사 채팅은 [¶n](문단 번호), 브리핑 채팅은 [#n](브리핑 순위) */
  content: string
  /** 답변이 실제로 인용한 번호 (있는 번호만 남김) */
  citations: number[]
  createdAt: string
}

/** 답변 스트리밍 중 Worker → Main → 화면으로 오는 알림 */
export type ChatEvent =
  | { type: 'delta'; requestId: string; text: string }
  | { type: 'done'; requestId: string; message: ChatMessageDTO }
  | { type: 'error'; requestId: string; message: string }

export interface QuickAction {
  label: string
  prompt: string
}

export interface QuickActions {
  item: QuickAction[]
  digest: QuickAction[]
}

/** 출처 페이지의 기간: 최근 7일·30일 또는 전체 */
export type StatsPeriod = 7 | 30 | 'all'

/** 수집부터 저장까지 단계별 개수 */
export interface FunnelCounts {
  /** 이 출처에서 처음 수집한 글 */
  collected: number
  /** 같은 소식으로 다른 기사에 합쳐진 글 */
  merged: number
  /** AI 선별까지 간 글 */
  triaged: number
  /** 브리핑에 실린 글 */
  published: number
  saved: number
}

export interface SourceFetchDTO {
  at: string
  reason: 'briefing' | 'collect'
  ok: boolean
  fetched: number
  newItems: number
  error: string | null
}

export interface SourceStatDTO {
  id: string
  name: string
  /** 수집 방식 이름 (RSS, GitHub 릴리스 …) */
  method: string
  enabled: boolean
  weight: number
  /** 사람이 읽을 수 있게 풀어 쓴 수집 조건 */
  rules: string[]
  url: string | null
  period: FunnelCounts
  total: FunnelCounts
  lastFetch: SourceFetchDTO | null
  /** 고른 기간 안의 수집 실패 횟수 */
  failures: number
  recentFetches: SourceFetchDTO[]
  recentPublished: { itemId: number; titleKo: string; digestDate: string }[]
}

export interface SourceStatsDTO {
  period: StatsPeriod
  funnel: { period: FunnelCounts; total: FunnelCounts }
  /** LLM 비용: 고른 기간과 전체, 단계(역할)별 */
  cost: { period: number; total: number; byRole: { role: string; usd: number }[] }
  /** 최근 30일 날마다 수집·실린 수 */
  daily: { date: string; collected: number; published: number }[]
  sources: SourceStatDTO[]
}

export interface DigestStats {
  sources: number
  collected: number
  candidates: number
  selected: number
  costUsd: number
  failedSources: string[]
  saveMode: boolean
}

export interface DigestDTO {
  id: number
  date: string
  headline: string
  overview: string | null
  createdAt: string
  stats: DigestStats
  entries: DigestEntryDTO[]
}

export type RunStage =
  | 'collect'
  | 'dedup'
  | 'triage'
  | 'extract'
  | 'summarize'
  | 'translate'
  | 'digest'
  | 'publish'
  | 'done'
  | 'error'

export interface RunProgress {
  stage: RunStage
  message: string
  current?: number
  total?: number
}

export interface UsageSummary {
  monthUsd: number
  todayUsd: number
  budgetUsd: number
  dailyCapUsd: number
  saveMode: boolean
}

export interface AppSettings {
  budgetUsd: number
  dailyCapUsd: number
  digestSize: number
}

export const DEFAULT_SETTINGS: AppSettings = { budgetUsd: 5, dailyCapUsd: 0.5, digestSize: 20 }
