import type Groq from 'groq-sdk'
import { dateKey } from '@shared/schedule'
import type { ChatEvent, ChatScope, UsageSummary } from '@shared/types'
import type { WorkerApi } from '@shared/worker-protocol'
import { loadConfig, type AppConfig } from './config'
import { openDb, type Db } from './db/db'
import * as repo from './db/repo'
import { askQuestion } from './knowledge/chat'
import { enrichSavedItem } from './knowledge/enrich'
import { translateItem } from './knowledge/translate'
import { LlmSession } from './llm/service'
import { createGroq } from './llm/groq'
import { collectAndStore, runPipeline, type PipelineDeps } from './pipeline/run'

// Worker의 RPC 구현. Electron에 의존하지 않는다 (Worker 프로세스의 메시지 처리는 index.ts).

/** 미리 수집할 때 받는 구간. 중복은 DB에서 거르므로 넉넉하게 둔다 */
const COLLECT_ONLY_HOURS = 24

type Async<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> | Awaited<R> : never }

export interface ServiceOptions {
  dbPath: string
  configDir: string
  apiKey: string | null
  onProgress: PipelineDeps['onProgress']
  log: PipelineDeps['log']
  /** 저장 후 본문 추출·태그 추천처럼 뒤에서 끝난 작업으로 기사 정보가 바뀜 */
  onItemUpdated(itemId: number): void
  /** 질문 답변 스트리밍 알림 */
  onChatEvent(event: ChatEvent): void
}

export class WorkerService implements Async<WorkerApi> {
  private readonly db: Db
  private readonly config: AppConfig
  private groq: Groq | null
  private running: Promise<unknown> | null = null
  private collecting: Promise<unknown> | null = null
  /** 진행 중인 번역 (같은 기사를 두 번 번역하지 않게) */
  private readonly translating = new Map<number, Promise<boolean>>()

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

  /**
   * 낮 동안 미리 수집 (DESIGN.md 4.3절). LLM은 부르지 않고 최근 24시간 글을 받아 쌓기만 한다.
   * 아침 브리핑은 지난 실행 이후 쌓인 글을 후보로 쓰므로, 피드에서 금방 밀려나는 글(인기글·릴리스)도 놓치지 않는다.
   * 브리핑을 만드는 중이거나 이미 수집 중이면 건너뛴다.
   */
  async collectOnly() {
    if (this.running || this.collecting) return { collected: 0, skipped: true }
    const job = collectAndStore({ db: this.db, config: this.config, log: this.opts.log }, new Date(Date.now() - COLLECT_ONLY_HOURS * 3600_000))
    this.collecting = job
    try {
      const { collected, failedSources } = await job
      this.opts.log('info', `미리 수집: 새 글 ${collected}건${failedSources.length ? `, 실패 ${failedSources.length}곳` : ''}`)
      return { collected, skipped: false }
    } finally {
      this.collecting = null
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

  /** 저장한 기사의 본문 추출·태그 추천·번역을 응답을 기다리지 않고 뒤에서 한다 */
  private enrichLater(itemId: number): void {
    void enrichSavedItem({ db: this.db, config: this.config, groq: this.groq, log: this.opts.log }, itemId)
      .then((handled) => {
        if (handled) this.opts.onItemUpdated(itemId)
        // 본문을 새로 뽑았으면 번역이 비었으므로 다시 번역한다 (절약 모드면 읽을 때 번역)
        if (handled && !this.getUsage().saveMode) void this.translateItem({ itemId })
      })
      .catch((err: unknown) => this.opts.log('warn', `저장 후 처리 실패: ${(err as Error).message}`))
  }

  /**
   * 기사 본문을 번역한다 (읽기 화면에서 번역이 없을 때 요청). 끝나면 item-updated로 알린다.
   * 하루 상한에 닿았거나 키가 없으면 하지 않는다. 번역을 새로 만들었으면 true.
   */
  translateItem({ itemId }: { itemId: number }): Promise<boolean> {
    const pending = this.translating.get(itemId)
    if (pending) return pending
    const usage = this.getUsage()
    if (!this.groq || usage.todayUsd >= usage.dailyCapUsd) return Promise.resolve(false)
    const llm = new LlmSession(this.groq, this.db, this.config.pricing, null)
    const job = translateItem({ db: this.db, config: this.config, llm, saveMode: usage.saveMode, log: this.opts.log }, itemId)
      .catch((err: unknown) => {
        this.opts.log('warn', `번역 실패: ${(err as Error).message}`)
        return false
      })
      .finally(() => {
        this.translating.delete(itemId)
        this.opts.onItemUpdated(itemId)
      })
    this.translating.set(itemId, job)
    return job
  }

  addHighlights({ itemId, ranges }: Parameters<WorkerApi['addHighlights']>[0]) {
    const r = repo.addHighlights(this.db, itemId, ranges)
    if (r.newlySaved) this.enrichLater(itemId)
    return r.highlights
  }

  updateHighlightNote({ id, note }: { id: number; note: string }) {
    return repo.updateHighlightNote(this.db, id, note)
  }

  removeHighlight({ id }: { id: number }) {
    return repo.removeHighlight(this.db, id)
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

  getChat({ scope }: { scope: ChatScope }) {
    return repo.listChatMessages(this.db, scope)
  }

  ask({ requestId, scope, question }: { requestId: string; scope: ChatScope; question: string }) {
    return askQuestion(
      { db: this.db, config: this.config, groq: this.groq, emit: this.opts.onChatEvent, log: this.opts.log },
      requestId,
      scope,
      question
    )
  }

  clearChat({ scope }: { scope: ChatScope }) {
    repo.clearChat(this.db, scope)
  }

  getQuickActions() {
    return this.config.quickActions
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
