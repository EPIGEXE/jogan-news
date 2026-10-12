// ============================================================================
// 공용 도메인 타입
//
// [역할]
// - Main · Worker · 화면(renderer)이 함께 쓰는 데이터 모양 정의 (브리핑 · 기사 · 하이라이트 · 질문 · 출처 통계 · 설정)
// - 기사 분류와 브리핑 섹션의 종류 · 순서 · 표시 이름 정의
// - 이름이 DTO로 끝나는 타입은 Worker가 DB에서 읽어 화면까지 그대로 전달하는 모양
// - 시각은 ISO 형식 글자, 날짜는 로컬 시간 기준 'YYYY-MM-DD', 비용은 달러(USD)
// - 타입과 상수만 담음 (Electron · DB에 기대지 않음)
// ============================================================================

// 기사 분류
export const CATEGORIES = ['model_release', 'tools', 'applied', 'research', 'community', 'industry', 'other'] as const
export type Category = (typeof CATEGORIES)[number]

// 분류의 표시 이름
export const CATEGORY_LABEL: Record<Category, string> = {
    model_release: '모델 출시',
    tools: '도구·라이브러리',
    applied: '실전·응용',
    research: '주목할 논문',
    community: '커뮤니티 화제',
    industry: '업계·정책',
    other: '그 외 주요 소식'
}

// 분류 필터 탭처럼 좁은 곳에 쓰는 짧은 이름
export const CATEGORY_SHORT_LABEL: Record<Category, string> = {
    model_release: '모델',
    tools: '도구',
    applied: '실전',
    research: '논문',
    community: '커뮤니티',
    industry: '업계',
    other: '그 외'
}

// 브리핑 섹션: 상위 5개는 'top', 나머지는 분류별
export type Section = 'top' | Category

export const SECTION_ORDER: Section[] = ['top', ...CATEGORIES] // 브리핑에 보여주는 섹션 순서

export const SECTION_LABEL: Record<Section, string> = { top: '오늘의 톱', ...CATEGORY_LABEL } // 섹션의 표시 이름

// 기사를 다룬 출처 하나
export interface SourceRef {
    sourceName: string // 출처 이름
    url: string // 그 출처에 실린 글의 주소
    engagementLabel: string | null // 그 출처에서의 참여도 문구 ('HN 1,234점' 등, 없으면 null)
}

// 브리핑에 실린 기사 하나
export interface DigestEntryDTO {
    itemId: number // 기사 번호
    rank: number // 브리핑 안에서의 순위 (1부터)
    section: Section // 실린 섹션 (상위 5개는 'top', 나머지는 자기 분류)
    category: Category // AI 선별이 매긴 분류 (아직 선별하지 않았으면 'other')
    titleKo: string // 한국어 제목 (아직 요약하지 않았으면 원래 제목)
    originalTitle: string // 원래 제목
    summaryKo: string // 한국어 요약 (아직 요약하지 않았으면 수집한 소개 글의 앞 300자)
    keyPoints: string[] // 핵심 요점 (아직 요약하지 않았으면 빈 배열)
    whyItMatters: string | null // 왜 중요한지 (없으면 null)
    url: string // 원문 주소 (대표 출처의 것)
    sourceName: string // 대표 출처 이름
    engagementLabel: string | null // 참여도 문구 ('HN 1,234점' · '추천 12' 등, 없으면 null). 여러 출처면 참여도가 가장 큰 쪽의 것
    otherSources: SourceRef[] // 같은 소식을 다룬 다른 출처
    publishedAt: string | null // 원문이 게시된 시각 (출처가 알려 주지 않으면 null)
    isRead: boolean // 읽음 표시를 했는지
    isSaved: boolean // 저장했는지
    memo: string // 내 메모 (없으면 빈 글자)
    tags: string[] // 붙은 태그 이름 (이름순)
    followUpOf: FollowUpRef | null // 지난 브리핑 소식의 후속 보도면 그 지난 기사
}

// 라이브러리 · 아카이브 검색 결과 한 줄
export interface LibraryItemDTO {
    itemId: number // 기사 번호
    titleKo: string // 한국어 제목 (없으면 원래 제목)
    originalTitle: string // 원래 제목
    summaryKo: string // 한국어 요약 (없으면 수집한 소개 글의 앞 300자)
    category: Category // 분류 (선별하지 않았으면 'other')
    sourceName: string // 대표 출처 이름
    url: string // 원문 주소
    isSaved: boolean // 저장했는지
    savedAt: string | null // 저장한 시각 (저장하지 않았으면 null)
    digestDate: string | null // 이 기사가 실린 브리핑 날짜 (없으면 null)
    memo: string // 내 메모 (없으면 빈 글자)
    tags: string[] // 붙은 태그 이름 (이름순)
}

// 하이라이트를 그은 본문 판: 번역문 또는 원문 (문단 번호는 같음)
export type HighlightVariant = 'ko' | 'original'

// 하이라이트 위치: 문단 번호(1부터)와 그 문단 글자 안의 [start, end)
export interface HighlightRange {
    paragraph: number // 문단 번호 (1부터)
    variant: HighlightVariant // 번역문에 그었는지 원문에 그었는지
    start: number // 문단 안에서 시작하는 글자 위치 (0부터, 포함)
    end: number // 끝나는 글자 위치 (포함하지 않음)
}

// 저장된 하이라이트 하나
export interface HighlightDTO extends HighlightRange {
    id: number // 하이라이트 번호
    text: string // 그은 글자 (그을 때 본문에서 잘라 저장한 것)
    note: string // 하이라이트에 단 메모 (없으면 빈 글자)
    createdAt: string // 그은 시각 (겹쳐서 합쳐진 것은 가장 먼저 그은 시각)
}

// 지난 7일 브리핑에 실린 기사의 후속 소식일 때, 그 지난 기사
export interface FollowUpRef {
    itemId: number // 지난 기사의 번호
    titleKo: string // 지난 기사의 한국어 제목 (없으면 원래 제목)
    digestDate: string | null // 지난 기사가 실린 브리핑 날짜 (찾지 못하면 null)
}

// 기사 하나의 전체 정보 (기사 패널 · 본문 탭)
export interface ItemDetailDTO extends Omit<DigestEntryDTO, 'rank' | 'section'> {
    savedAt: string | null // 저장한 시각 (저장하지 않았으면 null)
    digestDate: string | null // 이 기사가 실린 브리핑 날짜 (실린 적이 없으면 null)
    paragraphs: string[] // 원문 문단. 본문을 아직 가져오지 않았으면 수집한 소개 글 한 문단 (그것도 없으면 빈 배열)
    hasFullText: boolean // false면 본문 추출에 실패해 요약 · 초록만 있음 (본문을 아직 가져오지 않았을 때도 false)
    paragraphsKo: (string | null)[] | null // 문단별 한국어 번역. paragraphs와 같은 순서 · 길이, 상한을 넘어 번역하지 않은 문단은 null
    translation: TranslationState // 본문 번역 상태
    highlights: HighlightDTO[] // 이 기사에 그은 하이라이트 (문단 · 시작 위치 순)
}

// 본문 번역 상태
// - not_needed: 한국어 기사라 번역하지 않음
// - missing: 아직 번역하지 않음 (열면 번역 요청)
// - done: 번역됨 (paragraphsKo에 null이 있으면 길어서 앞부분만 번역한 것)
export type TranslationState = 'not_needed' | 'missing' | 'done'

// 브리핑 목록의 한 줄
export interface DigestSummaryDTO {
    id: number // 브리핑 번호
    date: string // 브리핑 날짜 'YYYY-MM-DD'
    headline: string // 오늘의 한 줄
    entryCount: number // 실린 기사 수
    savedCount: number // 그중 저장한 기사 수
}

// 태그 하나와 쓰인 횟수
export interface TagCount {
    name: string // 태그 이름
    count: number // 이 태그가 붙은 저장한 기사 수
}

// 검색 범위: 저장한 기사(라이브러리) 또는 브리핑에 실린 기사(아카이브)
export type SearchScope = 'saved' | 'published'

// 검색 조건 (준 조건을 모두 만족하는 기사만)
export interface SearchParams {
    scope: SearchScope // 검색 범위
    query?: string // 검색어 (띄어 쓴 낱말을 모두 포함한 기사, 없으면 전체)
    tag?: string // 이 태그가 붙은 기사만
    memoOnly?: boolean // true면 메모가 있는 기사만
}

// 질문 범위: 기사 하나 또는 그날 브리핑 전체
export type ChatScope = { kind: 'item'; itemId: number } | { kind: 'digest'; date: string }

// 대화의 말 하나 (내 질문 또는 AI 답변)
export interface ChatMessageDTO {
    id: number // 메시지 번호
    role: 'user' | 'assistant' // user: 내 질문, assistant: AI 답변
    content: string // 답변에는 인용 표시가 들어 있음: 기사 채팅은 [¶n](문단 번호), 브리핑 채팅은 [#n](브리핑 순위)
    citations: number[] // 답변이 실제로 인용한 번호 (있는 번호만 남김)
    createdAt: string // 저장한 시각
}

// 답변 스트리밍 중 Worker에서 Main을 거쳐 화면으로 오는 알림
// requestId는 질문할 때 받은 요청 번호 (자기 질문의 알림만 골라 쓰는 데 사용)
export type ChatEvent =
    | { type: 'delta'; requestId: string; text: string } // 답변 조각 (text는 새로 온 부분)
    | { type: 'done'; requestId: string; message: ChatMessageDTO } // 답변 완료 (message는 저장된 전체 답변)
    | { type: 'error'; requestId: string; message: string } // 답변 실패 (message는 오류 내용)

// 빠른 질문 하나
export interface QuickAction {
    label: string // 버튼에 보이는 이름
    prompt: string // 누르면 보내는 질문
}

// 설정 파일에 정해 둔 빠른 질문 목록
export interface QuickActions {
    item: QuickAction[] // 기사 하나에 대한 질문
    digest: QuickAction[] // 그날 브리핑 전체에 대한 질문
}

// 출처 페이지의 기간: 최근 7일 · 30일 또는 전체
export type StatsPeriod = 7 | 30 | 'all'

// 수집부터 저장까지 단계별 개수 (기간은 글을 수집한 시각 기준)
export interface FunnelCounts {
    collected: number // 이 출처에서 처음 수집한 글
    merged: number // 같은 소식으로 다른 기사에 합쳐진 글
    triaged: number // AI 선별까지 간 글
    published: number // 브리핑에 실린 글
    saved: number // 저장한 글
}

// 출처 하나를 한 번 수집한 기록
export interface SourceFetchDTO {
    fetchedAt: string // 수집한 시각
    reason: 'briefing' | 'collect' // briefing: 브리핑을 만들면서 수집, collect: 낮 동안 미리 수집
    ok: boolean // 수집에 성공했는지
    fetchedCount: number // 받아 온 글 수
    newItems: number // 그중 새로 쌓인 글 수 (이미 있던 글 제외)
    error: string | null // 실패한 이유 (성공하면 null)
}

// 출처 하나의 설정과 통계
export interface SourceStatDTO {
    id: string // 설정 파일에 적은 출처 ID
    name: string // 출처 이름
    method: string // 수집 방식 이름 (RSS, GitHub 릴리스 …)
    enabled: boolean // 설정에서 켜져 있는지 (꺼진 출처는 수집하지 않음)
    weight: number // 신뢰도 가중치 (기본 1)
    rules: string[] // 사람이 읽을 수 있게 풀어 쓴 수집 조건
    url: string | null // 출처 주소 (RSS는 피드 주소, 그 밖은 사이트 주소)
    period: FunnelCounts // 고른 기간의 단계별 개수
    total: FunnelCounts // 전체 기간의 단계별 개수
    lastFetch: SourceFetchDTO | null // 가장 최근 수집 기록 (기록이 없으면 null)
    failures: number // 고른 기간 안의 수집 실패 횟수
    recentFetches: SourceFetchDTO[] // 최근 수집 기록 (최신부터, 최대 10건)
    recentPublished: { itemId: number; titleKo: string; digestDate: string }[] // 최근 브리핑에 실린 기사 (최신부터, 최대 5건)
}

// 출처 페이지 전체 통계
export interface SourceStatsDTO {
    period: StatsPeriod // 고른 기간
    funnel: { period: FunnelCounts; total: FunnelCounts } // 모든 출처를 합한 단계별 개수 (설정에서 빠진 옛 출처 포함)
    cost: { period: number; total: number; byRole: { role: string; usd: number }[] } // LLM 비용: 고른 기간과 전체, 단계(역할)별
    daily: { date: string; collected: number; published: number }[] // 최근 30일 날마다 수집 · 실린 수
    sources: SourceStatDTO[] // 설정의 모든 출처 (꺼진 것 포함)
}

// 브리핑 하나를 만들 때의 수치
export interface DigestStats {
    sources: number // 수집한 출처 수 (설정에서 켜진 출처)
    collected: number // 이번 수집에서 새로 쌓인 글 수
    candidates: number // 브리핑 후보가 된 글 수
    selected: number // 브리핑에 실은 기사 수
    costUsd: number // 이 브리핑을 만드는 데 든 LLM 비용 (달러)
    failedSources: string[] // 수집에 실패한 출처 ('이름 (오류 내용)' 모양)
    saveMode: boolean // 절약 모드로 만들었는지 (이번 달 사용액이 월 예산에 도달)
}

// 브리핑 하나
export interface DigestDTO {
    id: number // 브리핑 번호
    date: string // 브리핑 날짜 'YYYY-MM-DD'
    headline: string // 오늘의 한 줄 (만들지 못했으면 1위 기사 제목)
    overview: string | null // 오늘의 흐름 (만들지 못했으면 null)
    createdAt: string // 만든 시각 (같은 날 다시 만들면 그때로 바뀜)
    stats: DigestStats // 만들 때의 수치
    entries: DigestEntryDTO[] // 실린 기사 (순위 순)
}

// 브리핑 생성 단계
// - collect: 출처에서 새 글 수집 (네트워크 연결을 기다리는 동안에도 이 단계로 표시)
// - dedup: 중복 합치기
// - triage: 관련도 · 중요도 매기기, 같은 소식 묶기
// - extract: 본문 가져오기
// - summarize: 한국어 요약
// - translate: 본문 번역 (절약 모드에서는 건너뜀)
// - digest: 오늘의 한 줄 쓰기
// - publish: 브리핑 저장
// - done: 완료
// - error: 실패 (message에 이유)
export type RunStage = 'collect' | 'dedup' | 'triage' | 'extract' | 'summarize' | 'translate' | 'digest' | 'publish' | 'done' | 'error'

// 브리핑 생성 진행 상황
export interface RunProgress {
    stage: RunStage // 지금 단계
    message: string // 화면에 보여줄 안내 문구 (error 단계에서는 실패 이유)
    current?: number // 이 단계에서 끝낸 개수 (세지 않는 단계에서는 없음)
    total?: number // 이 단계에서 해야 할 전체 개수 (세지 않는 단계에서는 없음)
}

// LLM 비용 사용량과 한도 (모두 달러)
export interface UsageSummary {
    monthUsd: number // 이번 달 1일부터 쓴 금액
    todayUsd: number // 오늘 0시부터 쓴 금액
    budgetUsd: number // 월 예산 (설정값)
    dailyCapUsd: number // 하루 상한 (설정값)
    saveMode: boolean // 이번 달 사용액이 월 예산에 도달해 절약 모드인지
}

// 사용자가 바꿀 수 있는 설정
export interface AppSettings {
    budgetUsd: number // 월 예산 (달러). 도달하면 절약 모드로 생성
    dailyCapUsd: number // 하루 상한 (달러). 도달하면 그날은 브리핑 생성 · 번역을 하지 않음
    digestSize: number // 브리핑 하나에 싣는 기사 수 (절약 모드에서는 15건까지)
}

export const DEFAULT_SETTINGS: AppSettings = { budgetUsd: 5, dailyCapUsd: 0.5, digestSize: 20 } // 저장된 값이 없는 항목에 쓰는 기본값
