import type Groq from 'groq-sdk'
import { dateKey } from '@shared/schedule'
import type { UsageSummary } from '@shared/types'
import type { WorkerApi } from '@shared/worker-protocol'
import { loadConfig, type AppConfig } from './config'
import { openDb, type Db } from './db/db'
import * as repo from './db/repo'
import { enrichSavedItem } from './knowledge/enrich'
import { createGroq } from './llm/groq'
import { runPipeline, type PipelineDeps } from './pipeline/run'

// Worker의 RPC 구현. Electron에 의존하지 않아서 스크립트(scripts/run-pipeline.ts)에서도 그대로 쓴다.

type Async<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> | Awaited<R> : never }

export interface ServiceOptions {
  dbPath: string
  configDir: string
  apiKey: string | null
  onProgress: PipelineDeps['onProgress']
  log: PipelineDeps['log']
  /** 저장 후 본문 추출·태그 추천처럼 뒤에서 끝난 작업으로 기사 정보가 바뀜 */
  onItemUpdated(itemId: number): void
}

export class WorkerService implements Async<WorkerApi> {
  private readonly db: Db
  private readonly config: AppConfig
  private groq: Groq | null
  private running: Promise<unknown> | null = null

  constructor(private readonly opts: ServiceOptions) {
    this.db = openDb(opts.dbPath)
    repo.abandonStaleRuns(this.db)
    this.config = loadConfig(opts.configDir)
    this.groq = opts.apiKey ? createGroq(opts.apiKey) : null
  }

  setApiKey(apiKey: string | null): void {
    this.groq = apiKey ? createGroq(apiKey) : null
  }

  getLatestDigest() {
    return repo.getLatestDigest(this.db)
  }

  getLastDigestDate() {
    return repo.lastDigestDate(this.db)
  }

  async runPipeline({ reason }: Parameters<WorkerApi['runPipeline']>[0]) {
    if (this.running) throw new Error('이미 브리핑을 만드는 중입니다.')
    const job = runPipeline(
      { db: this.db, config: this.config, groq: this.groq, onProgress: this.opts.onProgress, log: this.opts.log },
      reason
    )
    this.running = job
    try {
      return await job
    } finally {
      this.running = null
    }
  }

  markRead({ itemId }: { itemId: number }) {
    repo.markRead(this.db, itemId)
  }

  setSaved({ itemId, saved }: { itemId: number; saved: boolean }) {
    repo.setSaved(this.db, itemId, saved)
    if (saved) this.enrichLater(itemId)
  }

  saveMemo({ itemId, body }: { itemId: number; body: string }) {
    const savedAt = repo.saveMemo(this.db, itemId, body)
    if (body.trim()) this.enrichLater(itemId)
    return { savedAt }
  }

  /** 저장한 기사의 본문 추출·태그 추천을 응답을 기다리지 않고 뒤에서 한다 */
  private enrichLater(itemId: number): void {
    void enrichSavedItem({ db: this.db, config: this.config, groq: this.groq, log: this.opts.log }, itemId)
      .then((handled) => {
        if (handled) this.opts.onItemUpdated(itemId)
      })
      .catch((err: unknown) => this.opts.log('warn', `저장 후 처리 실패: ${(err as Error).message}`))
  }

  search(p: Parameters<WorkerApi['search']>[0]) {
    return repo.searchItems(this.db, p)
  }

  listTags() {
    return repo.listTags(this.db)
  }

  getItem({ itemId }: { itemId: number }) {
    return repo.getItemDetail(this.db, itemId)
  }

  addTag({ itemId, name }: { itemId: number; name: string }) {
    return repo.addTag(this.db, itemId, name, 'user')
  }

  removeTag({ itemId, name }: { itemId: number; name: string }) {
    return repo.removeTag(this.db, itemId, name)
  }

  listDigests() {
    return repo.listDigests(this.db)
  }

  getDigest({ date }: { date: string }) {
    return repo.getDigestByDate(this.db, date)
  }

  getUsage(): UsageSummary {
    const now = new Date()
    const s = repo.getSettings(this.db)
    const monthUsd = repo.costSince(this.db, new Date(now.getFullYear(), now.getMonth(), 1).toISOString())
    const todayUsd = repo.costSince(this.db, new Date(`${dateKey(now)}T00:00:00`).toISOString())
    return { monthUsd, todayUsd, budgetUsd: s.budgetUsd, dailyCapUsd: s.dailyCapUsd, saveMode: monthUsd >= s.budgetUsd }
  }

  getSettings() {
    return repo.getSettings(this.db)
  }

  updateSettings(patch: Parameters<WorkerApi['updateSettings']>[0]) {
    return repo.updateSettings(this.db, patch)
  }

  close(): void {
    this.db.close()
  }
}
