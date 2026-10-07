// Main · Worker · Renderer가 함께 쓰는 도메인 타입.

export const CATEGORIES = [
  'model_release',
  'agent_tooling',
  'research',
  'community',
  'industry',
  'other'
] as const
export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABEL: Record<Category, string> = {
  model_release: '모델 출시',
  agent_tooling: '에이전트·툴링',
  research: '주목할 논문',
  community: '커뮤니티 화제',
  industry: '업계·정책',
  other: '그 외 주요 소식'
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

/** 기사 하나의 전체 정보 (기사 패널·본문 탭) */
export interface ItemDetailDTO extends Omit<DigestEntryDTO, 'rank' | 'section'> {
  savedAt: string | null
  digestDate: string | null
  paragraphs: string[]
  /** false면 본문 추출에 실패해 요약·초록만 있음 */
  fullText: boolean
}

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

export const DEFAULT_SETTINGS: AppSettings = { budgetUsd: 5, dailyCapUsd: 0.5, digestSize: 18 }
