// ============================================================================
// Main과 화면 사이의 IPC 계약
//
// [역할]
// - Main과 화면(renderer)이 주고받는 IPC 채널 이름 정의 (채널 이름은 여기서만 정의)
// - 채널은 두 종류: 화면이 불러 결과를 받는 요청, Main이 화면으로 보내는 알림
// - 화면이 쓰는 API(window.jogan)의 모양 정의 (preload가 이 모양대로 만들고, Main의 ipc/가 같은 채널로 받음)
// - 진단 · API 키 · 화면 이동에 쓰는 타입 정의
// - 타입과 이름만 담음 (Electron에 기대지 않아 Main · preload · 화면이 함께 가져다 씀)
// ============================================================================

import type {
    AppSettings,
    ChatEvent,
    ChatMessageDTO,
    ChatScope,
    DigestDTO,
    DigestSummaryDTO,
    HighlightDTO,
    HighlightRange,
    ItemDetailDTO,
    LibraryItemDTO,
    QuickActions,
    RunProgress,
    SearchParams,
    SourceStatsDTO,
    StatsPeriod,
    TagCount,
    UsageSummary
} from './types'

// IPC 채널 이름
// 꼬리 주석에 "알림"이라고 적은 채널은 Main이 화면으로 보내는 것, 나머지는 화면이 불러 결과를 받는 요청
export const IPC = {
    // 브리핑
    getLatestDigest: 'digest:get-latest',
    runNow: 'digest:run-now',
    isRunning: 'digest:is-running',
    runProgress: 'digest:progress', // 알림: 브리핑 생성 진행 상황
    digestUpdated: 'digest:updated', // 알림: 새 브리핑 게시
    markRead: 'item:mark-read',
    setSaved: 'item:set-saved',
    saveMemo: 'item:save-memo',
    openExternal: 'shell:open-external',
    itemUpdated: 'item:updated', // 알림: 기사 정보 변경 (본문 보강 · 번역 완료 등)
    getItem: 'item:get',
    translateItem: 'item:translate',
    addHighlights: 'item:add-highlights',
    updateHighlightNote: 'item:update-highlight-note',
    removeHighlight: 'item:remove-highlight',
    addTag: 'item:add-tag',
    removeTag: 'item:remove-tag',
    // 라이브러리 · 아카이브
    search: 'library:search',
    getSourceStats: 'sources:get-stats',
    listTags: 'library:list-tags',
    listDigests: 'archive:list-digests',
    getDigest: 'archive:get-digest',
    // AI 질문
    getChat: 'chat:get',
    ask: 'chat:ask',
    clearChat: 'chat:clear',
    chatEvent: 'chat:event', // 알림: AI 답변 스트리밍
    getQuickActions: 'chat:quick-actions',
    navigate: 'app:navigate', // 알림: 화면 이동 요청
    // 창 (직접 그린 제목 표시줄의 버튼)
    windowMinimize: 'window:minimize',
    windowToggleMaximize: 'window:toggle-maximize',
    windowClose: 'window:close',
    windowIsMaximized: 'window:is-maximized',
    windowMaximizedChanged: 'window:maximized-changed', // 알림: 최대화 상태 변경
    // 설정
    getSettings: 'settings:get',
    updateSettings: 'settings:update',
    getUsage: 'settings:get-usage',
    getApiKeyStatus: 'settings:api-key-status',
    setApiKey: 'settings:set-api-key',
    getAutostart: 'settings:get-autostart',
    setAutostart: 'settings:set-autostart',
    // 진단
    getDiagEvents: 'diag:get-events',
    diagEvent: 'diag:event', // 알림: 진단 기록 한 줄
    testNotification: 'diag:test-notification',
    runNetworkChecks: 'diag:run-network-checks',
    getTriggerState: 'diag:get-trigger-state'
} as const

// 진단 기록 한 줄
export interface DiagEvent {
    at: string // 기록한 시각 (ISO 형식)
    kind: string // 기록 종류 (worker-exit, notification-shown 등)
    detail?: string // 덧붙인 설명 (없을 수 있음)
}

// 네트워크 진단에서 주소 하나를 한 가지 방식으로 호출한 결과
export interface NetCheckResult {
    target: string // 확인 대상 이름 (Groq API 등)
    url: string // 호출한 주소
    method: 'node-fetch' | 'electron-net' // Node 기본 fetch 또는 Electron net.fetch
    ok: boolean // 서버까지 닿았는지
    status?: number // HTTP 상태 코드 (응답을 못 받았으면 없음)
    elapsedMs: number // 걸린 시간 (밀리초)
    error?: string // 실패한 이유 (성공하면 없음)
}

// 진단 화면에 보여주는 브리핑 자동 생성 상태
export interface TriggerState {
    today: string // 오늘 날짜 'YYYY-MM-DD' (로컬 시간 기준)
    lastDigestDate: string | null // 마지막 브리핑 날짜 'YYYY-MM-DD' (브리핑이 하나도 없으면 null)
    nextTimerAt: string | null // 다음 아침 타이머가 울릴 시각 (ISO 형식, 타이머를 예약하기 전이면 null)
    morningHour: number // 켜 둔 채로 있을 때 자동 생성하는 시각 (시)
    dayStartHour: number // 이 시각(시) 이전의 로그인 · 잠금 해제로는 생성하지 않음
    isPackaged: boolean // 설치판으로 실행 중인지 (false면 개발 실행)
}

// API 키의 출처와 끝자리 (키 전체는 화면으로 보내지 않음)
export interface ApiKeyStatus {
    source: 'stored' | 'env' | 'none' // stored: 설정에서 입력해 암호화 저장됨, env: 개발용 .env에서 읽음, none: 없음
    hint: string | null // 키의 끝 4자리만 (키가 없으면 null)
}

// 화면 이름
export type Route = 'today' | 'library' | 'archive' | 'ask' | 'sources' | 'settings' | 'diagnostics'

// 화면이 window.jogan으로 쓰는 API
// on으로 시작하는 메서드는 Main의 알림을 구독하고, 반환한 함수를 부르면 구독 해제
export interface JoganApi {
    // 브리핑
    getLatestDigest(): Promise<DigestDTO | null> // 가장 최근 브리핑 (하나도 없으면 null)
    runNow(): Promise<boolean> // 생성 시작. 오늘 브리핑이 이미 있거나 조건이 안 맞아 건너뛰면 false
    isRunning(): Promise<boolean> // 지금 브리핑을 만드는 중인지
    onRunProgress(onRunProgress: (runProgress: RunProgress) => void): () => void // 브리핑 생성 진행 상황 구독
    onDigestUpdated(onDigestChange: () => void): () => void // 새 브리핑 게시 구독
    onNavigate(onRouteRequest: (route: Route) => void): () => void // 화면 이동 요청 구독 (알림 · 트레이에서 화면을 정해 창을 열 때)
    markRead(itemId: number): Promise<void> // 읽음 표시
    setSaved(itemId: number, saved: boolean): Promise<void> // 저장 · 저장 해제
    saveMemo(itemId: number, body: string): Promise<{ savedAt: string }> // 메모 저장 (빈 메모는 삭제) → 저장한 시각
    openExternal(url: string): Promise<void> // 기본 브라우저로 열기 (http · https 주소만)
    onItemUpdated(onItemChange: (itemId: number) => void): () => void // 기사 정보 변경 구독 (본문 보강 · 번역 완료 등)
    getItem(itemId: number): Promise<ItemDetailDTO | null> // 기사 하나의 전체 정보 (없는 기사면 null)
    translateItem(itemId: number): Promise<boolean> // 본문 번역 요청 → 새로 번역했으면 true
    addHighlights(itemId: number, ranges: HighlightRange[]): Promise<HighlightDTO[]> // 하이라이트 긋기 → 그 기사의 하이라이트 목록
    updateHighlightNote(highlightId: number, note: string): Promise<HighlightDTO[]> // 하이라이트 메모 수정 → 그 기사의 하이라이트 목록
    removeHighlight(highlightId: number): Promise<HighlightDTO[]> // 하이라이트 지우기 → 그 기사의 남은 하이라이트 목록
    addTag(itemId: number, name: string): Promise<string[]> // 태그 붙이기 → 그 기사의 태그 목록
    removeTag(itemId: number, name: string): Promise<string[]> // 태그 떼기 → 그 기사의 남은 태그 목록
    // 라이브러리 · 아카이브
    search(searchParams: SearchParams): Promise<LibraryItemDTO[]> // 저장한 기사 또는 브리핑에 실린 기사 검색
    // 출처
    getSourceStats(period: StatsPeriod): Promise<SourceStatsDTO> // 고른 기간의 출처별 통계
    listTags(): Promise<TagCount[]> // 저장한 기사에 붙은 태그와 개수
    listDigests(): Promise<DigestSummaryDTO[]> // 지난 브리핑 목록 (최신 날짜부터)
    getDigest(digestDate: string): Promise<DigestDTO | null> // 그 날짜('YYYY-MM-DD')의 브리핑 (없으면 null)
    // AI 질문
    getChat(chatScope: ChatScope): Promise<ChatMessageDTO[]> // 그 범위에서 나눈 대화
    // 질문을 보내고 바로 돌아옴. 답변은 onChatEvent로 requestId와 함께 흘러옴
    ask(chatScope: ChatScope, question: string): Promise<{ requestId: string; userMessage: ChatMessageDTO }>
    clearChat(chatScope: ChatScope): Promise<void> // 그 범위의 대화 삭제
    getQuickActions(): Promise<QuickActions> // 설정 파일에 정해 둔 빠른 질문 목록
    onChatEvent(onChatEvent: (chatEvent: ChatEvent) => void): () => void // AI 답변 스트리밍 구독 (requestId로 자기 질문의 것만 골라 씀)
    // 설정
    getSettings(): Promise<AppSettings>
    updateSettings(settingsPatch: Partial<AppSettings>): Promise<AppSettings> // 바꿀 항목만 보냄 → 바뀐 뒤의 전체 설정
    getUsage(): Promise<UsageSummary> // LLM 비용 사용량과 한도
    getApiKeyStatus(): Promise<ApiKeyStatus>
    setApiKey(apiKey: string | null): Promise<ApiKeyStatus> // 키 저장 (null이나 빈 문자열이면 저장된 키 삭제) → 바뀐 뒤의 키 상태
    getAutostart(): Promise<boolean> // Windows 시작 시 실행이 켜져 있는지
    setAutostart(shouldEnable: boolean): Promise<boolean> // 켜기 · 끄기 → 바꾼 뒤 실제로 켜져 있는지
    // 창
    windowMinimize(): Promise<void>
    windowToggleMaximize(): Promise<void> // 최대화되어 있으면 원래 크기로, 아니면 최대화
    windowClose(): Promise<void> // 닫기: 앱을 끄지 않고 트레이로 숨김
    windowIsMaximized(): Promise<boolean>
    onWindowMaximizedChanged(onMaximizedChange: (maximized: boolean) => void): () => void // 최대화 상태 변경 구독
    // 진단
    getDiagEvents(): Promise<DiagEvent[]> // 지금까지 쌓인 진단 기록 (오래된 것이 앞)
    onDiagEvent(onDiagEvent: (diagEvent: DiagEvent) => void): () => void // 새 진단 기록 구독
    testNotification(): Promise<void> // 테스트 알림 띄우기
    runNetworkChecks(): Promise<NetCheckResult[]> // 외부 주소에 닿는지 점검
    getTriggerState(): Promise<TriggerState> // 브리핑 자동 생성의 지금 상태
}
