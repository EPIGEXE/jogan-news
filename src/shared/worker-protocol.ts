// Main ↔ Worker(utilityProcess) 메시지 규약.

import type { TriggerReason } from './schedule'
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

export interface RunResult {
  digestId: number
  date: string
  headline: string
  entries: number
  costUsd: number
}

/** Worker가 제공하는 RPC. 키 = 메서드 이름, 값 = (인자) => 결과 */
export interface WorkerApi {
  getLatestDigest(): DigestDTO | null
  getLastDigestDate(): string | null
  runPipeline(p: { reason: TriggerReason }): RunResult
  markRead(p: { itemId: number }): void
  setSaved(p: { itemId: number; saved: boolean }): void
  saveMemo(p: { itemId: number; body: string }): { savedAt: string }
  getUsage(): UsageSummary
  getSettings(): AppSettings
  updateSettings(p: Partial<AppSettings>): AppSettings
  // 라이브러리·아카이브
  search(p: SearchParams): LibraryItemDTO[]
  listTags(): TagCount[]
  getItem(p: { itemId: number }): ItemDetailDTO | null
  addTag(p: { itemId: number; name: string }): string[]
  removeTag(p: { itemId: number; name: string }): string[]
  listDigests(): DigestSummaryDTO[]
  getDigest(p: { date: string }): DigestDTO | null
}

export type WorkerMethod = keyof WorkerApi
export type WorkerParams<M extends WorkerMethod> = Parameters<WorkerApi[M]>[0]
export type WorkerResult<M extends WorkerMethod> = ReturnType<WorkerApi[M]>

export type MainToWorker =
  | { type: 'init'; dbPath: string; configDir: string; apiKey: string | null }
  | { type: 'set-api-key'; apiKey: string | null }
  | { type: 'rpc'; id: number; method: WorkerMethod; params: unknown }

export type WorkerToMain =
  | { type: 'ready' }
  | { type: 'rpc-result'; id: number; ok: true; result: unknown }
  | { type: 'rpc-result'; id: number; ok: false; error: string }
  | { type: 'progress'; progress: RunProgress }
  /** 저장 후 본문 추출·태그 추천처럼 뒤에서 끝난 작업으로 기사 정보가 바뀜 */
  | { type: 'item-updated'; itemId: number }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
