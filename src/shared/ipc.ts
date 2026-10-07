// Main ↔ Renderer IPC 계약. 채널 이름과 타입은 여기서만 정의한다.

import type {
  AppSettings,
  DigestDTO,
  DigestSummaryDTO,
  ItemDetailDTO,
  LibraryItemDTO,
  RunProgress,
  SearchParams,
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
  addTag: 'item:add-tag',
  removeTag: 'item:remove-tag',
  // 라이브러리·아카이브
  search: 'library:search',
  listTags: 'library:list-tags',
  listDigests: 'archive:list-digests',
  getDigest: 'archive:get-digest',
  navigate: 'app:navigate',
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

export type Route = 'today' | 'library' | 'archive' | 'ask' | 'settings' | 'diagnostics' | 'dev-components'

export interface AinewsApi {
  // 브리핑
  getLatestDigest(): Promise<DigestDTO | null>
  runNow(): Promise<void>
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
  addTag(itemId: number, name: string): Promise<string[]>
  removeTag(itemId: number, name: string): Promise<string[]>
  // 라이브러리·아카이브
  search(p: SearchParams): Promise<LibraryItemDTO[]>
  listTags(): Promise<TagCount[]>
  listDigests(): Promise<DigestSummaryDTO[]>
  getDigest(date: string): Promise<DigestDTO | null>
  // 설정
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  getUsage(): Promise<UsageSummary>
  getApiKeyStatus(): Promise<ApiKeyStatus>
  setApiKey(key: string | null): Promise<ApiKeyStatus>
  getAutostart(): Promise<boolean>
  setAutostart(on: boolean): Promise<boolean>
  // 진단
  getEvents(): Promise<DiagEvent[]>
  onEvent(cb: (e: DiagEvent) => void): () => void
  testNotification(): Promise<void>
  runNetworkChecks(): Promise<NetCheckResult[]>
  getTriggerState(): Promise<TriggerState>
}
