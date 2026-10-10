// Main ↔ Renderer IPC 계약. 채널 이름과 타입은 여기서만 정의한다.

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

export const IPC = {
  // 브리핑
  getLatestDigest: 'digest:get-latest',
  runNow: 'digest:run-now',
  isRunning: 'digest:is-running',
  progress: 'digest:progress',
  digestUpdated: 'digest:updated',
  markRead: 'item:mark-read',
  setSaved: 'item:set-saved',
  saveMemo: 'item:save-memo',
  openExternal: 'shell:open-external',
  itemUpdated: 'item:updated',
  getItem: 'item:get',
  translateItem: 'item:translate',
  addHighlights: 'item:add-highlights',
  updateHighlightNote: 'item:update-highlight-note',
  removeHighlight: 'item:remove-highlight',
  addTag: 'item:add-tag',
  removeTag: 'item:remove-tag',
  // 라이브러리·아카이브
  search: 'library:search',
  getSourceStats: 'sources:get-stats',
  listTags: 'library:list-tags',
  listDigests: 'archive:list-digests',
  getDigest: 'archive:get-digest',
  // AI 질문
  getChat: 'chat:get',
  ask: 'chat:ask',
  clearChat: 'chat:clear',
  chatEvent: 'chat:event',
  getQuickActions: 'chat:quick-actions',
  navigate: 'app:navigate',
  // 창 (직접 그린 제목 표시줄의 버튼)
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',
  windowMaximizedChanged: 'window:maximized-changed',
  // 설정
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  getUsage: 'settings:get-usage',
  getApiKeyStatus: 'settings:api-key-status',
  setApiKey: 'settings:set-api-key',
  getAutostart: 'settings:get-autostart',
  setAutostart: 'settings:set-autostart',
  // 진단
  getEvents: 'diag:get-events',
  event: 'diag:event',
  testNotification: 'diag:test-notification',
  runNetworkChecks: 'diag:run-network-checks',
  getTriggerState: 'diag:get-trigger-state'
} as const

export interface DiagEvent {
  at: string
  kind: string
  detail?: string
}

export interface NetCheckResult {
  target: string
  url: string
  method: 'node-fetch' | 'electron-net'
  ok: boolean
  status?: number
  ms: number
  error?: string
}

export interface TriggerState {
  today: string
  lastDigestDate: string | null
  nextTimerAt: string | null
  morningHour: number
  dayStartHour: number
  isPackaged: boolean
}

export interface ApiKeyStatus {
  /** stored: 설정에서 입력해 암호화 저장됨, env: 개발용 .env에서 읽음, none: 없음 */
  source: 'stored' | 'env' | 'none'
  /** 끝 4자리만 */
  hint: string | null
}

export type Route = 'today' | 'library' | 'archive' | 'ask' | 'sources' | 'settings' | 'diagnostics'

export interface AinewsApi {
  // 브리핑
  getLatestDigest(): Promise<DigestDTO | null>
  /** 생성 시작. 오늘 브리핑이 이미 있거나 조건이 안 맞아 건너뛰면 false */
  runNow(): Promise<boolean>
  isRunning(): Promise<boolean>
  onProgress(cb: (p: RunProgress) => void): () => void
  onDigestUpdated(cb: () => void): () => void
  onNavigate(cb: (route: Route) => void): () => void
  markRead(itemId: number): Promise<void>
  setSaved(itemId: number, saved: boolean): Promise<void>
  saveMemo(itemId: number, body: string): Promise<{ savedAt: string }>
  openExternal(url: string): Promise<void>
  onItemUpdated(cb: (itemId: number) => void): () => void
  getItem(itemId: number): Promise<ItemDetailDTO | null>
  translateItem(itemId: number): Promise<boolean>
  addHighlights(itemId: number, ranges: HighlightRange[]): Promise<HighlightDTO[]>
  updateHighlightNote(id: number, note: string): Promise<HighlightDTO[]>
  removeHighlight(id: number): Promise<HighlightDTO[]>
  addTag(itemId: number, name: string): Promise<string[]>
  removeTag(itemId: number, name: string): Promise<string[]>
  // 라이브러리·아카이브
  search(p: SearchParams): Promise<LibraryItemDTO[]>
  // 출처
  getSourceStats(period: StatsPeriod): Promise<SourceStatsDTO>
  listTags(): Promise<TagCount[]>
  listDigests(): Promise<DigestSummaryDTO[]>
  getDigest(date: string): Promise<DigestDTO | null>
  // AI 질문
  getChat(scope: ChatScope): Promise<ChatMessageDTO[]>
  /** 질문을 보내고 바로 돌아온다. 답변은 onChatEvent로 requestId와 함께 흘러온다 */
  ask(scope: ChatScope, question: string): Promise<{ requestId: string; userMessage: ChatMessageDTO }>
  clearChat(scope: ChatScope): Promise<void>
  getQuickActions(): Promise<QuickActions>
  onChatEvent(cb: (e: ChatEvent) => void): () => void
  // 설정
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  getUsage(): Promise<UsageSummary>
  getApiKeyStatus(): Promise<ApiKeyStatus>
  setApiKey(key: string | null): Promise<ApiKeyStatus>
  getAutostart(): Promise<boolean>
  setAutostart(on: boolean): Promise<boolean>
  // 창
  windowMinimize(): Promise<void>
  windowToggleMaximize(): Promise<void>
  /** 닫기: 앱을 끄지 않고 트레이로 숨긴다 */
  windowClose(): Promise<void>
  windowIsMaximized(): Promise<boolean>
  onWindowMaximizedChanged(cb: (maximized: boolean) => void): () => void
  // 진단
  getEvents(): Promise<DiagEvent[]>
  onEvent(cb: (e: DiagEvent) => void): () => void
  testNotification(): Promise<void>
  runNetworkChecks(): Promise<NetCheckResult[]>
  getTriggerState(): Promise<TriggerState>
}
