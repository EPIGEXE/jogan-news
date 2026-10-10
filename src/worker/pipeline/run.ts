import type Groq from 'groq-sdk'
import { dateKey, type TriggerReason } from '@shared/schedule'
import { SECTION_LABEL, type DigestStats, type RunProgress } from '@shared/types'
import type { RunResult } from '@shared/worker-protocol'
import { collectSource } from '../collectors'
import type { RawItem } from '../collectors/types'
import { modelFor, type AppConfig } from '../config'
import { tx, type Db } from '../db/db'
import * as repo from '../db/repo'
import { ensureContent } from '../knowledge/content'
import { translateItem } from '../knowledge/translate'
import { LlmSession } from '../llm/service'
import { applyClusters, fillWithContent, finalScore, ruleScore, selectEntries, type Triaged } from './select'
import {
  ClusterJsonSchema,
  ClusterZod,
  DigestJsonSchema,
  DigestZod,
  RecentJsonSchema,
  RecentZod,
  SummaryJsonSchema,
  SummaryZod,
  summaryUserMessage,
  TriageJsonSchema,
  TriageZod
} from './schemas'

// 브리핑 생성 파이프라인 (DESIGN.md 9절). Worker 프로세스 안에서 실행된다.

const TRIAGE_LIMIT = 120
const TRIAGE_BATCH = 10
const FIRST_RUN_HOURS = 24
const MAX_WINDOW_HOURS = 72
const SAVE_MODE_DIGEST_SIZE = 15
/** 이 기간 안에 실린 소식은 다시 싣지 않는다 (큰 후속 소식은 '후속'으로 싣는다) */
const RECENT_DAYS = 7
/** 출처별 수집 기록을 남겨 두는 기간 */
const SOURCE_FETCH_KEEP_DAYS = 90
/** 이보다 본문이 짧으면(제목·한 줄 소개뿐) 브리핑에 싣지 않는다 */
const MIN_BODY_CHARS = 300
/** 본문 추출을 시도하는 후보 수 상한 = 브리핑 크기 × 이 값 */
const EXTRACT_ATTEMPT_FACTOR = 2

const bodyChars = (paragraphs: string[]) => paragraphs.reduce((n, p) => n + p.length, 0)

export interface PipelineDeps {
  db: Db
  config: AppConfig
  groq: Groq | null
  onProgress(p: RunProgress): void
  log(level: 'info' | 'warn' | 'error', message: string): void
}

const HOUR = 3600 * 1000

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * 수집 구간 시작: 오늘 이전에 성공한 마지막 실행 시각. 최대 72시간 전까지, 첫 실행이면 24시간 전.
 * 같은 날 다시 만들 때도 오늘 아침 실행이 아니라 어제 실행을 기준으로 해서 후보가 줄지 않게 한다.
 */
function collectionSince(db: Db, now: Date): Date {
  const floor = new Date(now.getTime() - MAX_WINDOW_HOURS * HOUR)
  const last = repo.lastSuccessfulRunStartedAt(db, startOfLocalDay(now).toISOString())
  if (!last) return new Date(now.getTime() - FIRST_RUN_HOURS * HOUR)
  const t = new Date(last)
  return t < floor ? floor : t
}

/**
 * ① 수집 · ② 저장·중복 제거. 낮 동안 미리 수집(collectOnly)도 이 함수를 쓴다.
 * 소스 하나가 실패해도 나머지는 계속한다. 새로 쌓인 글 수와 실패한 소스를 돌려준다.
 */
export async function collectAndStore(
  deps: Pick<PipelineDeps, 'db' | 'config' | 'log'> & { onProgress?: PipelineDeps['onProgress'] },
  since: Date,
  reason: 'briefing' | 'collect' = 'briefing'
): Promise<{ collected: number; failedSources: string[] }> {
  const { db, config, log } = deps
  const onProgress = deps.onProgress ?? (() => {})
  const failedSources: string[] = []
  // 출처별 수집 기록 (출처 페이지의 상태·실패 기록)
  const errors = new Map<string, string>()
  let done = 0
  onProgress({ stage: 'collect', message: '소스에서 새 글을 가져오는 중', current: 0, total: config.sources.length })
  const batches = await Promise.all(
    config.sources.map(async (s): Promise<RawItem[]> => {
      try {
        return await collectSource(s, since, config.interests)
      } catch (err) {
        failedSources.push(`${s.name} (${(err as Error).message})`)
        errors.set(s.id, (err as Error).message.split('\n')[0]!.slice(0, 200))
        log('warn', `수집 실패: ${s.name}: ${(err as Error).message}`)
        return []
      } finally {
        onProgress({ stage: 'collect', message: '소스에서 새 글을 가져오는 중', current: ++done, total: config.sources.length })
      }
    })
  )

  onProgress({ stage: 'dedup', message: '중복을 합치는 중' })
  let collected = 0
  const at = new Date().toISOString()
  tx(db, () => {
    config.sources.forEach((s, i) => {
      const items = batches[i]!
      let fresh = 0
      for (const raw of items) if (repo.upsertRawItem(db, raw).isNew) fresh++
      collected += fresh
      repo.recordSourceFetch(db, { sourceId: s.id, at, reason, ok: !errors.has(s.id), fetched: items.length, newItems: fresh, error: errors.get(s.id) ?? null })
    })
    repo.pruneSourceFetches(db, SOURCE_FETCH_KEEP_DAYS)
  })
  return { collected, failedSources }
}

export async function runPipeline(deps: PipelineDeps, reason: TriggerReason): Promise<RunResult> {
  const { db, config, onProgress, log } = deps
  if (!deps.groq) throw new Error('Groq API 키가 없습니다. 설정에서 키를 입력하세요.')
  const groq = deps.groq
  const now = new Date()
  const today = dateKey(now)

  // ── 예산 확인 (DESIGN.md 7.5절 ⑤) ──
  const settings = repo.getSettings(db)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const monthUsd = repo.costSince(db, monthStart)
  const todayUsd = repo.costSince(db, startOfLocalDay(now).toISOString())
  if (todayUsd >= settings.dailyCapUsd) {
    throw new Error(`오늘 LLM 사용액($${todayUsd.toFixed(2)})이 하루 상한($${settings.dailyCapUsd})에 도달해 생성을 중단했습니다.`)
  }
  const saveMode = monthUsd >= settings.budgetUsd
  if (saveMode) log('warn', `월 예산 $${settings.budgetUsd} 도달 → 절약 모드로 실행`)

  const since = collectionSince(db, now)
  const runId = repo.createRun(db, reason, since.toISOString())
  const llm = new LlmSession(groq, db, config.pricing, runId)

  try {
    // ── ① 수집 · ② 저장·중복 제거 ──
    const { collected, failedSources } = await collectAndStore(deps, since)

    // ── ③ 규칙 점수로 1차 거르기 ──
    const weightOf = new Map(config.sources.map((s) => [s.id, s.weight]))
    const candidates = repo.getCandidates(db, since.toISOString(), today)
    const scored = candidates
      .map((c) => {
        const others = (JSON.parse(c.other_sources) as unknown[]).length
        const ref = Date.parse(c.published_at ?? c.collected_at)
        return {
          row: c,
          others,
          rule: ruleScore(
            {
              id: c.id,
              title: c.title,
              snippet: c.snippet,
              sourceWeight: weightOf.get(c.source_id) ?? 1,
              engagement: c.engagement,
              otherSources: others,
              ageHours: Number.isNaN(ref) ? 0 : (now.getTime() - ref) / HOUR
            },
            config.interests
          )
        }
      })
      .sort((a, b) => b.rule - a.rule)
      .slice(0, TRIAGE_LIMIT)
    log('info', `후보 ${candidates.length}건 중 ${scored.length}건을 선별 단계로`)

    // ── ④ LLM 선별 (이미 선별한 항목은 건너뜀) ──
    const toTriage = scored.filter((s) => s.row.triage_category === null)
    const triageSpec = modelFor(config.models, 'triage', saveMode)
    const triageBatches: (typeof toTriage)[] = []
    for (let i = 0; i < toTriage.length; i += TRIAGE_BATCH) triageBatches.push(toTriage.slice(i, i + TRIAGE_BATCH))
    let triagedBatches = 0
    let triageFailures = 0
    onProgress({ stage: 'triage', message: '관련도와 중요도를 매기는 중', current: 0, total: triageBatches.length })
    await Promise.all(
      triageBatches.map(async (batch) => {
        const user = batch
          .map((s) => JSON.stringify({ id: s.row.id, source: s.row.source_name, title: s.row.title, snippet: s.row.snippet.slice(0, 200) }))
          .join('\n')
        try {
          const r = await llm.json('triage', triageSpec, { system: config.prompts.triage, user }, {
            name: 'triage',
            jsonSchema: TriageJsonSchema,
            zod: TriageZod
          })
          const ids = new Set(batch.map((s) => s.row.id))
          for (const t of r.results) {
            if (!ids.has(t.id)) continue
            repo.saveTriage(db, t.id, t)
            const s = batch.find((b) => b.row.id === t.id)!
            s.row.triage_category = t.category
            s.row.triage_relevance = t.relevance
            s.row.triage_importance = t.importance
          }
        } catch (err) {
          triageFailures++
          log('warn', `선별 배치 실패: ${(err as Error).message}`)
        } finally {
          onProgress({ stage: 'triage', message: '관련도와 중요도를 매기는 중', current: ++triagedBatches, total: triageBatches.length })
        }
      })
    )
    if (triageBatches.length > 0 && triageFailures === triageBatches.length) {
      throw new Error('LLM 선별이 모두 실패했습니다. API 키와 네트워크를 확인하세요.')
    }

    // ── ⑤ 최종 선정 ──
    const triaged: Triaged[] = scored
      .filter((s) => s.row.triage_category !== null)
      .map((s) => ({
        id: s.row.id,
        category: s.row.triage_category!,
        relevance: s.row.triage_relevance ?? 0,
        importance: s.row.triage_importance ?? 1,
        ruleScore: s.rule,
        engagement: s.row.engagement,
        otherSources: s.others
      }))
    const size = saveMode ? Math.min(settings.digestSize, SAVE_MODE_DIGEST_SIZE) : settings.digestSize

    const rowById = new Map(scored.map((s) => [s.row.id, s.row]))

    // 같은 소식을 LLM에게 묶게 하고 대표 하나로 합친다. 실패하면 묶지 않고 진행한다.
    // 판단이 까다로워 요약용 큰 모델을 쓴다. 호출 한 번이라 비용은 미미하다.
    const clusterAndMerge = async (items: Triaged[], describe: (id: number) => object): Promise<Triaged[]> => {
      if (items.length < 2) return items
      try {
        const user = items.map((t) => JSON.stringify({ id: t.id, ...describe(t.id) })).join('\n')
        const { groups } = await llm.json('cluster', modelFor(config.models, 'summary', saveMode), { system: config.prompts.cluster, user }, {
          name: 'clusters',
          jsonSchema: ClusterJsonSchema,
          zod: ClusterZod
        })
        const result = applyClusters(items, groups)
        for (const [repId, memberIds] of result.merges) repo.mergeInto(db, repId, memberIds)
        if (result.merges.size) log('info', `같은 소식 ${result.merges.size}묶음을 합침`)
        return result.items
      } catch (err) {
        log('warn', `같은 소식 묶기 실패, 묶지 않고 진행: ${(err as Error).message}`)
        return items
      }
    }

    // ── 같은 소식 묶기 1차: 상위 후보끼리, 원제와 첫 부분으로 ──
    onProgress({ stage: 'triage', message: '같은 소식을 묶는 중' })
    const pool = triaged
      .filter((t) => t.relevance >= 0.4 || t.importance >= 5)
      .sort((a, b) => finalScore(b) - finalScore(a))
      .slice(0, size * 2)
    const poolIds = new Set(pool.map((t) => t.id))
    const mergedPool = await clusterAndMerge(pool, (id) => {
      const r = rowById.get(id)!
      return { source: r.source_name, title: r.title, snippet: r.snippet.slice(0, 160) }
    })

    // ── 지난 7일 중복 확인: 이미 보낸 소식은 빼고, 중요한 새 전개가 있는 후속 소식은 표시해서 싣는다 ──
    const recent = repo.recentPublished(db, today, RECENT_DAYS)
    const dropped = new Set<number>()
    if (recent.length > 0 && mergedPool.length > 0) {
      try {
        const user = [
          '지난 브리핑:',
          ...recent.map((r) => JSON.stringify({ id: r.id, date: r.date, title: r.title })),
          '',
          '오늘 후보:',
          ...mergedPool.map((t) => {
            const r = rowById.get(t.id)!
            return JSON.stringify({ id: r.id, source: r.source_name, title: r.title, snippet: r.snippet.slice(0, 160) })
          })
        ].join('\n')
        const { matches } = await llm.json('recent', modelFor(config.models, 'summary', saveMode), { system: config.prompts.recent, user }, {
          name: 'recent_matches',
          jsonSchema: RecentJsonSchema,
          zod: RecentZod
        })
        const recentIds = new Set(recent.map((r) => r.id))
        let followUps = 0
        for (const m of matches) {
          if (!poolIds.has(m.id) || !recentIds.has(m.previous_id) || dropped.has(m.id)) continue
          if (m.follow_up) {
            repo.markFollowUp(db, m.id, m.previous_id)
            followUps++
          } else {
            // 지난 기사에 출처로 붙이고 후보에서 뺀다
            repo.mergeInto(db, m.previous_id, [m.id])
            dropped.add(m.id)
          }
        }
        if (matches.length) log('info', `지난 ${RECENT_DAYS}일 중복 ${dropped.size}건 제외, 후속 소식 ${followUps}건`)
      } catch (err) {
        log('warn', `지난 브리핑 중복 확인 실패, 확인 없이 진행: ${(err as Error).message}`)
      }
    }
    const clustered = [...mergedPool.filter((t) => !dropped.has(t.id)), ...triaged.filter((t) => !poolIds.has(t.id))]
    let selected = selectEntries(clustered, size)
    if (selected.length === 0) throw new Error('선정할 기사가 없습니다. 수집된 글이 없거나 모두 관련도가 낮습니다.')

    // ── ⑥ 본문 추출: 본문을 못 가져온(제목뿐인) 기사는 빼고 다음 순위 후보로 채운다 ──
    // 제목만으로 요약하면 내용을 지어내게 되므로 싣지 않는다. 추출 시도는 브리핑 크기의 2배까지만 한다.
    let ready = 0
    onProgress({ stage: 'extract', message: '본문을 가져오는 중', current: 0, total: size })
    const filled = await fillWithContent(clustered, size, size * EXTRACT_ATTEMPT_FACTOR, async (id) => {
      const content = await ensureContent(db, rowById.get(id)!, log)
      const ok = bodyChars(content.paragraphs) >= MIN_BODY_CHARS
      if (ok) onProgress({ stage: 'extract', message: '본문을 가져오는 중', current: Math.min(++ready, size), total: size })
      return ok
    })
    selected = filled.selected
    if (filled.excluded.length) log('info', `본문을 가져오지 못한 ${filled.excluded.length}건을 빼고 다음 후보로 채움`)
    if (selected.length === 0) throw new Error('본문을 가져올 수 있는 기사가 없습니다.')

    // ── ⑦ 한국어 요약 (이미 요약한 항목은 건너뜀) ──
    const summarySpec = modelFor(config.models, 'summary', saveMode)
    let summarized = 0
    onProgress({ stage: 'summarize', message: '한국어로 요약하는 중', current: 0, total: selected.length })
    await Promise.all(
      selected.map(async (sel) => {
        const row = rowById.get(sel.id)!
        if (!row.summary_ko) {
          const content = repo.getContent(db, row.id)!
          try {
            const s = await llm.json(
              'summary',
              summarySpec,
              {
                system: config.prompts.summary,
                user: summaryUserMessage({
                  sourceName: row.source_name,
                  kind: row.kind,
                  title: row.title,
                  paragraphs: content.paragraphs,
                  fullText: content.fullText
                })
              },
              { name: 'article_summary', jsonSchema: SummaryJsonSchema, zod: SummaryZod }
            )
            repo.saveSummary(
              db,
              row.id,
              { titleKo: s.title_ko, summaryKo: s.summary_ko, keyPoints: s.key_points, whyKo: s.why_it_matters },
              summarySpec.model
            )
            row.title_ko = s.title_ko
            row.summary_ko = s.summary_ko
            row.why_ko = s.why_it_matters
          } catch (err) {
            log('warn', `요약 실패(${row.title.slice(0, 40)}): ${(err as Error).message}`)
          }
        }
        onProgress({ stage: 'summarize', message: '한국어로 요약하는 중', current: ++summarized, total: selected.length })
      })
    )

    // ── 같은 소식 묶기 2차: 한국어 요약끼리 비교하면 언어가 다른 중복도 잡힌다. 빠진 자리는 채우지 않는다 ──
    const byIdTriaged = new Map(clustered.map((t) => [t.id, t]))
    const finalItems = await clusterAndMerge(
      selected.map((s) => byIdTriaged.get(s.id)!),
      (id) => {
        const r = rowById.get(id)!
        return { title: r.title_ko ?? r.title, summary: (r.summary_ko ?? r.snippet).slice(0, 160) }
      }
    )
    if (finalItems.length < selected.length) selected = selectEntries(finalItems, finalItems.length)

    // ── ⑧ 본문 번역 (영어 기사만, 절약 모드에서는 읽을 때 번역) ──
    if (!saveMode) {
      let translated = 0
      onProgress({ stage: 'translate', message: '본문을 한국어로 옮기는 중', current: 0, total: selected.length })
      await Promise.all(
        selected.map(async (sel) => {
          try {
            await translateItem({ db, config, llm, saveMode, log }, sel.id)
          } catch (err) {
            log('warn', `번역 실패(${rowById.get(sel.id)!.title.slice(0, 40)}): ${(err as Error).message}`)
          }
          onProgress({ stage: 'translate', message: '본문을 한국어로 옮기는 중', current: ++translated, total: selected.length })
        })
      )
    }

    // ── ⑨ 머리글 ──
    onProgress({ stage: 'digest', message: '오늘의 한 줄을 쓰는 중' })
    const top = rowById.get(selected[0]!.id)!
    let headline = top.title_ko ?? top.title
    let overview: string | null = null
    try {
      const user = selected
        .map((sel) => {
          const r = rowById.get(sel.id)!
          return JSON.stringify({ id: r.id, section: SECTION_LABEL[sel.section], title: r.title_ko ?? r.title, summary: r.summary_ko ?? r.snippet.slice(0, 300) })
        })
        .join('\n')
      const d = await llm.json('digest', modelFor(config.models, 'digest', saveMode), { system: config.prompts.digest, user: `날짜: ${today}\n\n${user}` }, {
        name: 'digest',
        jsonSchema: DigestJsonSchema,
        zod: DigestZod
      })
      headline = d.headline
      overview = d.overview
    } catch (err) {
      log('warn', `머리글 생성 실패, 1위 기사 제목으로 대신함: ${(err as Error).message}`)
    }

    // ── ⑩ 게시 ──
    onProgress({ stage: 'publish', message: '브리핑을 저장하는 중' })
    const stats: DigestStats = {
      sources: config.sources.length,
      collected,
      candidates: candidates.length,
      selected: selected.length,
      costUsd: repo.costForRun(db, runId),
      failedSources,
      saveMode
    }
    const digestId = repo.publishDigest(db, {
      date: today,
      headline,
      overview,
      stats,
      entries: selected.map((s) => ({ itemId: s.id, rank: s.rank, section: s.section, whyItMatters: rowById.get(s.id)!.why_ko }))
    })
    repo.finishRun(db, runId, 'ok', { ...stats, tokens: llm.tokensUsed })
    onProgress({ stage: 'done', message: '완료' })
    return { digestId, date: today, headline, entries: selected.length, costUsd: stats.costUsd }
  } catch (err) {
    const message = (err as Error).message
    repo.finishRun(db, runId, 'error', { tokens: llm.tokensUsed }, message)
    onProgress({ stage: 'error', message })
    throw err
  }
}
