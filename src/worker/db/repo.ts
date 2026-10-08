import type { SQLInputValue } from 'node:sqlite'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type Category,
  type ChatMessageDTO,
  type ChatScope,
  type DigestDTO,
  type DigestEntryDTO,
  type DigestStats,
  type DigestSummaryDTO,
  type HighlightDTO,
  type HighlightRange,
  type ItemDetailDTO,
  type LibraryItemDTO,
  type SearchParams,
  type Section,
  type SourceRef,
  type TagCount
} from '@shared/types'
import type { RawItem } from '../collectors/types'
import type { ItemKind } from '../config'
import type { TokenUsage } from '../llm/pricing'
import { normalizeTitle, urlKey } from '../pipeline/normalize'
import { tx, type Db } from './db'

// DB 접근은 이 파일에서만 한다. 다른 모듈은 SQL을 직접 쓰지 않는다.

export interface ItemRow {
  id: number
  url: string
  source_id: string
  source_name: string
  kind: ItemKind
  title: string
  snippet: string
  lang: string | null
  published_at: string | null
  collected_at: string
  engagement: number
  engagement_label: string | null
  other_sources: string
  triage_category: Category | null
  triage_relevance: number | null
  triage_importance: number | null
  title_ko: string | null
  summary_ko: string | null
  key_points: string | null
  why_ko: string | null
  follow_up_of: number | null
}

const nowIso = () => new Date().toISOString()

function all<T>(db: Db, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[]
}
function one<T>(db: Db, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined
}
function run(db: Db, sql: string, ...params: SQLInputValue[]): void {
  db.prepare(sql).run(...params)
}

// ── 수집 ─────────────────────────────────────────────

/**
 * 수집 항목을 저장한다. URL이 같거나 최근 3일 안에 제목이 같은 항목이 있으면 새로 만들지 않고
 * 출처 목록과 참여도만 합친다 (DESIGN.md 9절 ③).
 */
export function upsertRawItem(db: Db, raw: RawItem): { id: number; isNew: boolean } {
  const key = urlKey(raw.url)
  const titleNorm = normalizeTitle(raw.title)
  const recent = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
  const existing =
    one<ItemRow>(db, 'SELECT * FROM items WHERE url_key = ?', key) ??
    (titleNorm.length >= 12
      ? one<ItemRow>(db, 'SELECT * FROM items WHERE title_norm = ? AND collected_at >= ?', titleNorm, recent)
      : undefined)

  if (!existing) {
    const r = db
      .prepare(
        `INSERT INTO items (url_key, url, source_id, source_name, kind, title, title_norm, snippet, lang,
           published_at, collected_at, engagement, engagement_label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        key,
        raw.url,
        raw.sourceId,
        raw.sourceName,
        raw.kind,
        raw.title,
        titleNorm,
        raw.snippet,
        raw.lang,
        raw.publishedAt,
        nowIso(),
        raw.engagement,
        raw.engagementLabel
      )
    const id = Number(r.lastInsertRowid)
    reindexItem(db, id)
    return { id, isNew: true }
  }

  // 같은 출처에서 다시 들어온 경우: 참여도만 갱신
  if (existing.source_id === raw.sourceId) {
    if (raw.engagement > existing.engagement) {
      run(db, 'UPDATE items SET engagement = ?, engagement_label = ? WHERE id = ?', raw.engagement, raw.engagementLabel, existing.id)
    }
    if (!existing.snippet && raw.snippet) run(db, 'UPDATE items SET snippet = ? WHERE id = ?', raw.snippet, existing.id)
    return { id: existing.id, isNew: false }
  }

  const others = JSON.parse(existing.other_sources) as SourceRef[]
  if (!others.some((o) => o.sourceName === raw.sourceName)) {
    others.push({ sourceName: raw.sourceName, url: raw.url, engagementLabel: raw.engagementLabel })
  }
  // 참여도가 더 큰 출처(예: HN 점수)를 대표 참여도로 쓴다. 논문은 HF 초록이 더 길면 그걸 쓴다.
  const engagement = Math.max(existing.engagement, raw.engagement)
  const label = raw.engagement > existing.engagement ? raw.engagementLabel : existing.engagement_label
  const snippet = raw.snippet.length > existing.snippet.length ? raw.snippet : existing.snippet
  run(
    db,
    'UPDATE items SET other_sources = ?, engagement = ?, engagement_label = ?, snippet = ? WHERE id = ?',
    JSON.stringify(others),
    engagement,
    label,
    snippet,
    existing.id
  )
  return { id: existing.id, isNew: false }
}

/** 이번 브리핑 후보: 수집 구간 안에 들어왔고, 오늘이 아닌 날의 브리핑에 이미 실린 적이 없는 항목 */
export function getCandidates(db: Db, sinceIso: string, today: string): ItemRow[] {
  return all<ItemRow>(
    db,
    `SELECT i.* FROM items i
     WHERE i.collected_at >= ?
       AND i.merged_into IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM digest_entries de JOIN digests d ON d.id = de.digest_id
         WHERE de.item_id = i.id AND d.date <> ?)`,
    sinceIso,
    today
  )
}

/** 지난 며칠 동안 브리핑에 실린 기사 (오늘 브리핑은 빼고). 7일 중복 확인에 쓴다 */
export function recentPublished(db: Db, today: string, days: number): { id: number; date: string; title: string }[] {
  const from = new Date(`${today}T00:00:00`)
  from.setDate(from.getDate() - days)
  const fromKey = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`
  return all<{ id: number; date: string; title: string }>(
    db,
    `SELECT i.id, d.date, coalesce(i.title_ko, i.title) AS title
     FROM digest_entries de JOIN digests d ON d.id = de.digest_id JOIN items i ON i.id = de.item_id
     WHERE d.date < ? AND d.date >= ?
     ORDER BY d.date DESC, de.rank`,
    today,
    fromKey
  )
}

/** 지난 브리핑 기사의 후속 소식으로 표시한다 */
export function markFollowUp(db: Db, itemId: number, previousId: number): void {
  run(db, 'UPDATE items SET follow_up_of = ? WHERE id = ?', previousId, itemId)
}

/**
 * 같은 소식으로 묶인 항목들을 대표 항목 하나로 합친다. 나머지 항목의 출처는 대표의 other_sources로 옮기고
 * merged_into를 표시해 다음 후보에서 빠지게 한다.
 */
export function mergeInto(db: Db, repId: number, memberIds: number[]): { otherSources: number; engagement: number } {
  return tx(db, () => {
    const rep = one<ItemRow>(db, 'SELECT * FROM items WHERE id = ?', repId)!
    const others = JSON.parse(rep.other_sources) as SourceRef[]
    let engagement = rep.engagement
    let label = rep.engagement_label
    const add = (ref: SourceRef) => {
      if (ref.sourceName === rep.source_name && ref.url === rep.url) return
      if (!others.some((o) => o.sourceName === ref.sourceName && o.url === ref.url)) others.push(ref)
    }
    for (const id of memberIds) {
      const m = one<ItemRow>(db, 'SELECT * FROM items WHERE id = ?', id)
      if (!m || m.id === repId) continue
      add({ sourceName: m.source_name, url: m.url, engagementLabel: m.engagement_label })
      for (const o of JSON.parse(m.other_sources) as SourceRef[]) add(o)
      if (m.engagement > engagement) {
        engagement = m.engagement
        label = m.engagement_label
      }
      run(db, 'UPDATE items SET merged_into = ? WHERE id = ?', repId, m.id)
    }
    run(db, 'UPDATE items SET other_sources = ?, engagement = ?, engagement_label = ? WHERE id = ?', JSON.stringify(others), engagement, label, repId)
    return { otherSources: others.length, engagement }
  })
}

export function saveTriage(db: Db, id: number, t: { category: Category; relevance: number; importance: number }): void {
  run(
    db,
    'UPDATE items SET triage_category = ?, triage_relevance = ?, triage_importance = ?, triaged_at = ? WHERE id = ?',
    t.category,
    t.relevance,
    t.importance,
    nowIso(),
    id
  )
}

export function saveSummary(
  db: Db,
  id: number,
  s: { titleKo: string; summaryKo: string; keyPoints: string[]; whyKo: string },
  model: string
): void {
  run(
    db,
    'UPDATE items SET title_ko = ?, summary_ko = ?, key_points = ?, why_ko = ?, summary_model = ?, summarized_at = ? WHERE id = ?',
    s.titleKo,
    s.summaryKo,
    JSON.stringify(s.keyPoints),
    s.whyKo,
    model,
    nowIso(),
    id
  )
  reindexItem(db, id)
}

export interface Content {
  paragraphs: string[]
  fullText: boolean
  /** 문단별 번역. 아직 번역하지 않았으면 null */
  paragraphsKo: (string | null)[] | null
}

export function getContent(db: Db, itemId: number): Content | null {
  const row = one<{ paragraphs: string; full_text: number; paragraphs_ko: string | null }>(
    db,
    'SELECT paragraphs, full_text, paragraphs_ko FROM contents WHERE item_id = ?',
    itemId
  )
  if (!row) return null
  return {
    paragraphs: JSON.parse(row.paragraphs) as string[],
    fullText: row.full_text === 1,
    paragraphsKo: row.paragraphs_ko ? (JSON.parse(row.paragraphs_ko) as (string | null)[]) : null
  }
}

/** 문단별 번역을 저장한다. 본문을 다시 추출하면(saveContent) 번역은 지워진다 */
export function saveTranslation(db: Db, itemId: number, paragraphsKo: (string | null)[], model: string): void {
  run(
    db,
    'UPDATE contents SET paragraphs_ko = ?, translated_at = ?, translate_model = ? WHERE item_id = ?',
    JSON.stringify(paragraphsKo),
    nowIso(),
    model,
    itemId
  )
  reindexItem(db, itemId)
}

export function saveContent(db: Db, itemId: number, paragraphs: string[], fullText: boolean): void {
  run(
    db,
    `INSERT INTO contents (item_id, paragraphs, full_text, extracted_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET paragraphs = excluded.paragraphs, full_text = excluded.full_text, extracted_at = excluded.extracted_at,
       paragraphs_ko = NULL, translated_at = NULL, translate_model = NULL`,
    itemId,
    JSON.stringify(paragraphs),
    fullText ? 1 : 0,
    nowIso()
  )
  reindexItem(db, itemId)
}

// ── 실행 기록 ─────────────────────────────────────────

export function createRun(db: Db, reason: string, sinceIso: string): number {
  const r = db
    .prepare('INSERT INTO runs (reason, started_at, status, since) VALUES (?, ?, ?, ?)')
    .run(reason, nowIso(), 'running', sinceIso)
  return Number(r.lastInsertRowid)
}

export function finishRun(db: Db, id: number, status: 'ok' | 'error', stats: unknown, error?: string): void {
  run(db, 'UPDATE runs SET finished_at = ?, status = ?, stats = ?, error = ? WHERE id = ?', nowIso(), status, JSON.stringify(stats ?? null), error ?? null, id)
}

/** beforeIso 이전에 시작해 성공한 마지막 실행의 시작 시각 */
export function lastSuccessfulRunStartedAt(db: Db, beforeIso: string): string | null {
  return (
    one<{ started_at: string }>(
      db,
      "SELECT started_at FROM runs WHERE status = 'ok' AND started_at < ? ORDER BY started_at DESC LIMIT 1",
      beforeIso
    )?.started_at ?? null
  )
}

/** 앱이 중간에 꺼져서 'running'으로 남은 실행을 정리한다 */
export function abandonStaleRuns(db: Db): void {
  run(db, "UPDATE runs SET status = 'error', error = '앱 종료로 중단됨', finished_at = ? WHERE status = 'running'", nowIso())
}

// ── LLM 사용량 ────────────────────────────────────────

export function recordUsage(
  db: Db,
  e: { runId: number | null; role: string; model: string; usage: TokenUsage; latencyMs: number; costUsd: number }
): void {
  run(
    db,
    `INSERT INTO llm_usage (at, run_id, role, model, input_tokens, cached_tokens, output_tokens, reasoning_tokens, latency_ms, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    nowIso(),
    e.runId,
    e.role,
    e.model,
    e.usage.input,
    e.usage.cachedInput,
    e.usage.output,
    e.usage.reasoning,
    e.latencyMs,
    e.costUsd
  )
}

export function costSince(db: Db, sinceIso: string): number {
  return one<{ c: number | null }>(db, 'SELECT SUM(cost_usd) c FROM llm_usage WHERE at >= ?', sinceIso)?.c ?? 0
}

export function costForRun(db: Db, runId: number): number {
  return one<{ c: number | null }>(db, 'SELECT SUM(cost_usd) c FROM llm_usage WHERE run_id = ?', runId)?.c ?? 0
}

// ── 설정 ─────────────────────────────────────────────

export function getSettings(db: Db): AppSettings {
  const rows = all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings')
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]))
  return { ...DEFAULT_SETTINGS, ...stored } as AppSettings
}

export function updateSettings(db: Db, patch: Partial<AppSettings>): AppSettings {
  tx(db, () => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue
      run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v))
    }
  })
  return getSettings(db)
}

// ── 브리핑 ───────────────────────────────────────────

export interface PublishEntry {
  itemId: number
  rank: number
  section: Section
  whyItMatters: string | null
}

/** 같은 날짜의 브리핑이 있으면 내용을 바꿔 끼운다 (수동 새로고침) */
export function publishDigest(
  db: Db,
  d: { date: string; headline: string; overview: string | null; stats: DigestStats; entries: PublishEntry[] }
): number {
  return tx(db, () => {
    const existing = one<{ id: number }>(db, 'SELECT id FROM digests WHERE date = ?', d.date)
    let id: number
    if (existing) {
      id = existing.id
      run(db, 'DELETE FROM digest_entries WHERE digest_id = ?', id)
      run(db, 'UPDATE digests SET headline = ?, overview = ?, stats = ?, created_at = ? WHERE id = ?', d.headline, d.overview, JSON.stringify(d.stats), nowIso(), id)
    } else {
      const r = db
        .prepare('INSERT INTO digests (date, headline, overview, stats, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(d.date, d.headline, d.overview, JSON.stringify(d.stats), nowIso())
      id = Number(r.lastInsertRowid)
    }
    const ins = db.prepare('INSERT INTO digest_entries (digest_id, item_id, rank, section, why_it_matters) VALUES (?, ?, ?, ?, ?)')
    for (const e of d.entries) ins.run(id, e.itemId, e.rank, e.section, e.whyItMatters)
    return id
  })
}

export function lastDigestDate(db: Db): string | null {
  return one<{ date: string }>(db, 'SELECT date FROM digests ORDER BY date DESC LIMIT 1')?.date ?? null
}

interface DigestRow {
  id: number
  date: string
  headline: string
  overview: string | null
  stats: string
  created_at: string
}

/** 기사 한 건을 화면용으로 읽을 때 쓰는 공통 열: 저장·메모·읽음·태그·실린 브리핑 날짜 */
const ITEM_VIEW_COLUMNS = `
  i.*, r.read_at, s.saved_at, n.body AS memo,
  (SELECT group_concat(t.name, char(31)) FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id) AS tag_list,
  (SELECT max(d.date) FROM digest_entries de2 JOIN digests d ON d.id = de2.digest_id WHERE de2.item_id = i.id) AS digest_date,
  (SELECT coalesce(p.title_ko, p.title) FROM items p WHERE p.id = i.follow_up_of) AS follow_up_title,
  (SELECT max(d.date) FROM digest_entries de3 JOIN digests d ON d.id = de3.digest_id WHERE de3.item_id = i.follow_up_of) AS follow_up_date`

const ITEM_VIEW_JOINS = `
  LEFT JOIN reads r ON r.item_id = i.id
  LEFT JOIN saves s ON s.item_id = i.id
  LEFT JOIN notes n ON n.item_id = i.id`

interface ItemViewRow extends ItemRow {
  read_at: string | null
  saved_at: string | null
  memo: string | null
  tag_list: string | null
  digest_date: string | null
  follow_up_title: string | null
  follow_up_date: string | null
}

interface EntryRow extends ItemViewRow {
  rank: number
  section: Section
  why_it_matters: string | null
}

const TAG_SEPARATOR = String.fromCharCode(31) // SQL의 char(31)과 같은 구분자

const splitTags = (list: string | null) => (list ? list.split(TAG_SEPARATOR).sort((a, b) => a.localeCompare(b)) : [])

function toEntryBase(r: ItemViewRow): Omit<DigestEntryDTO, 'rank' | 'section' | 'whyItMatters'> {
  return {
    itemId: r.id,
    category: r.triage_category ?? 'other',
    titleKo: r.title_ko ?? r.title,
    originalTitle: r.title,
    summaryKo: r.summary_ko ?? r.snippet.slice(0, 300),
    keyPoints: r.key_points ? (JSON.parse(r.key_points) as string[]) : [],
    url: r.url,
    sourceName: r.source_name,
    engagementLabel: r.engagement_label,
    otherSources: JSON.parse(r.other_sources) as SourceRef[],
    publishedAt: r.published_at,
    isRead: r.read_at !== null,
    isSaved: r.saved_at !== null,
    memo: r.memo ?? '',
    tags: splitTags(r.tag_list),
    followUpOf:
      r.follow_up_of !== null && r.follow_up_title !== null
        ? { itemId: r.follow_up_of, titleKo: r.follow_up_title, digestDate: r.follow_up_date }
        : null
  }
}

function digestFromRow(db: Db, d: DigestRow | undefined): DigestDTO | null {
  if (!d) return null
  const rows = all<EntryRow>(
    db,
    `SELECT ${ITEM_VIEW_COLUMNS}, de.rank, de.section, de.why_it_matters
     FROM digest_entries de
     JOIN items i ON i.id = de.item_id
     ${ITEM_VIEW_JOINS}
     WHERE de.digest_id = ?
     ORDER BY de.rank`,
    d.id
  )
  return {
    id: d.id,
    date: d.date,
    headline: d.headline,
    overview: d.overview,
    createdAt: d.created_at,
    stats: JSON.parse(d.stats) as DigestStats,
    entries: rows.map((r) => ({
      ...toEntryBase(r),
      rank: r.rank,
      section: r.section,
      whyItMatters: r.why_it_matters ?? r.why_ko
    }))
  }
}

export function getLatestDigest(db: Db): DigestDTO | null {
  return digestFromRow(db, one<DigestRow>(db, 'SELECT * FROM digests ORDER BY date DESC LIMIT 1'))
}

export function getDigestByDate(db: Db, date: string): DigestDTO | null {
  return digestFromRow(db, one<DigestRow>(db, 'SELECT * FROM digests WHERE date = ?', date))
}

export function listDigests(db: Db): DigestSummaryDTO[] {
  return all<DigestSummaryDTO>(
    db,
    `SELECT d.id, d.date, d.headline,
            (SELECT count(*) FROM digest_entries de WHERE de.digest_id = d.id) AS entries,
            (SELECT count(*) FROM digest_entries de JOIN saves s ON s.item_id = de.item_id WHERE de.digest_id = d.id) AS saved
     FROM digests d
     ORDER BY d.date DESC`
  )
}

export function getItemDetail(db: Db, itemId: number): ItemDetailDTO | null {
  const r = one<ItemViewRow>(db, `SELECT ${ITEM_VIEW_COLUMNS} FROM items i ${ITEM_VIEW_JOINS} WHERE i.id = ?`, itemId)
  if (!r) return null
  const content = getContent(db, itemId)
  return {
    ...toEntryBase(r),
    whyItMatters: r.why_ko,
    savedAt: r.saved_at,
    digestDate: r.digest_date,
    paragraphs: content?.paragraphs ?? (r.snippet ? [r.snippet] : []),
    fullText: content?.fullText ?? false,
    paragraphsKo: content?.paragraphsKo ?? null,
    translation: !needsTranslation(r) ? 'not_needed' : content?.paragraphsKo ? 'done' : 'missing',
    highlights: listHighlights(db, itemId)
  }
}

const HANGUL = /[가-힣]/g

/** 한국어 기사는 번역하지 않는다. 소스 언어가 ko이거나 제목·첫 부분이 대부분 한글이면 한국어로 본다 */
export function needsTranslation(r: Pick<ItemRow, 'lang' | 'title' | 'snippet'>): boolean {
  if (r.lang === 'ko') return false
  const sample = `${r.title} ${r.snippet.slice(0, 300)}`.replace(/\s/g, '')
  const hangul = sample.match(HANGUL)?.length ?? 0
  return sample.length === 0 || hangul / sample.length < 0.3
}

// ── 전문 검색 ─────────────────────────────────────────

/** 검색 색인을 이 항목의 현재 내용으로 다시 쓴다. 제목·요약·본문·메모가 바뀔 때마다 부른다 */
export function reindexItem(db: Db, itemId: number): void {
  run(db, 'DELETE FROM search_fts WHERE rowid = ?', itemId)
  run(
    db,
    `INSERT INTO search_fts (rowid, title, body, memo)
     SELECT i.id,
            i.title || ' ' || coalesce(i.title_ko, ''),
            coalesce(i.summary_ko, '') || ' ' || coalesce(i.key_points, '') || ' ' || coalesce(i.snippet, '') || ' ' ||
              coalesce((SELECT group_concat(value, ' ') FROM json_each(c.paragraphs)), '') || ' ' ||
              coalesce((SELECT group_concat(value, ' ') FROM json_each(c.paragraphs_ko) WHERE value IS NOT NULL), ''),
            coalesce(n.body, '') || ' ' ||
              coalesce((SELECT group_concat(h.text || ' ' || h.note, ' ') FROM highlights h WHERE h.item_id = i.id), '')
     FROM items i
     LEFT JOIN contents c ON c.item_id = i.id
     LEFT JOIN notes n ON n.item_id = i.id
     WHERE i.id = ?`,
    itemId
  )
}

const TRIGRAM_MIN = 3

function escapeLike(word: string): string {
  return word.replace(/[!%_]/g, (c) => `!${c}`)
}

/**
 * 검색어를 SQL 조건으로 바꾼다. 3글자 이상 낱말은 FTS(trigram) MATCH로,
 * 2글자 이하 낱말(예: "모델")은 trigram으로 찾을 수 없어 LIKE로 찾는다. 모든 낱말을 AND로 묶는다.
 */
export function buildSearchFilter(query: string): { sql: string; params: string[] } {
  const words = query.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { sql: '', params: [] }
  const long = words.filter((w) => [...w].length >= TRIGRAM_MIN)
  const short = words.filter((w) => [...w].length < TRIGRAM_MIN)
  const parts: string[] = []
  const params: string[] = []
  if (long.length) {
    parts.push('i.id IN (SELECT rowid FROM search_fts WHERE search_fts MATCH ?)')
    params.push(long.map((w) => `"${w.replaceAll('"', '""')}"`).join(' AND '))
  }
  for (const w of short) {
    const like = `%${escapeLike(w)}%`
    parts.push(
      "i.id IN (SELECT rowid FROM search_fts WHERE title LIKE ? ESCAPE '!' OR body LIKE ? ESCAPE '!' OR memo LIKE ? ESCAPE '!')"
    )
    params.push(like, like, like)
  }
  return { sql: parts.join(' AND '), params }
}

const SEARCH_LIMIT = 200

/**
 * 라이브러리(scope=saved: 저장한 기사)와 아카이브(scope=published: 브리핑에 실린 기사) 검색.
 * 저장한 기사는 저장 순, 실린 기사는 최신 브리핑 순으로 돌려준다.
 */
export function searchItems(db: Db, p: SearchParams): LibraryItemDTO[] {
  const where: string[] = []
  const params: SQLInputValue[] = []
  if (p.scope === 'saved') where.push('s.saved_at IS NOT NULL')
  else where.push('EXISTS (SELECT 1 FROM digest_entries de WHERE de.item_id = i.id)')
  if (p.memoOnly) where.push('n.body IS NOT NULL')
  if (p.tag) {
    where.push('EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id AND t.name = ?)')
    params.push(p.tag)
  }
  if (p.query) {
    const f = buildSearchFilter(p.query)
    if (f.sql) {
      where.push(f.sql)
      params.push(...f.params)
    }
  }
  const order = p.scope === 'saved' ? 's.saved_at DESC' : 'digest_date DESC, i.id DESC'
  const rows = all<ItemViewRow>(
    db,
    `SELECT ${ITEM_VIEW_COLUMNS} FROM items i ${ITEM_VIEW_JOINS}
     WHERE ${where.join(' AND ')}
     ORDER BY ${order}
     LIMIT ${SEARCH_LIMIT}`,
    ...params
  )
  return rows.map((r) => {
    const base = toEntryBase(r)
    return {
      itemId: base.itemId,
      titleKo: base.titleKo,
      originalTitle: base.originalTitle,
      summaryKo: base.summaryKo,
      category: base.category,
      sourceName: base.sourceName,
      url: base.url,
      isSaved: base.isSaved,
      savedAt: r.saved_at,
      digestDate: r.digest_date,
      memo: base.memo,
      tags: base.tags
    }
  })
}

// ── 태그 ─────────────────────────────────────────────

/** 태그 이름 정리: 앞뒤 공백·# 제거, 공백은 하이픈, 영문은 소문자, 최대 30자 */
export function normalizeTag(name: string): string {
  return name
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 30)
}

export function getTags(db: Db, itemId: number): string[] {
  return all<{ name: string }>(
    db,
    'SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ? ORDER BY t.name',
    itemId
  ).map((r) => r.name)
}

export function addTag(db: Db, itemId: number, name: string, source: 'auto' | 'user'): string[] {
  let tag = normalizeTag(name)
  if (!tag) return getTags(db, itemId)
  // 하이픈만 다른 기존 태그가 있으면 그 표기를 쓴다 (openweight → open-weight)
  const loose = tag.replaceAll('-', '')
  const existing = one<{ name: string }>(db, "SELECT name FROM tags WHERE replace(name, '-', '') = ? LIMIT 1", loose)
  if (existing) tag = existing.name
  tx(db, () => {
    run(db, 'INSERT OR IGNORE INTO tags (name) VALUES (?)', tag)
    const { id } = one<{ id: number }>(db, 'SELECT id FROM tags WHERE name = ?', tag)!
    run(db, 'INSERT OR IGNORE INTO item_tags (item_id, tag_id, source) VALUES (?, ?, ?)', itemId, id, source)
  })
  return getTags(db, itemId)
}

/** 태그를 뗀다. 더 이상 쓰는 기사가 없는 태그는 지운다 */
export function removeTag(db: Db, itemId: number, name: string): string[] {
  tx(db, () => {
    run(db, 'DELETE FROM item_tags WHERE item_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)', itemId, normalizeTag(name))
    run(db, 'DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM item_tags)')
  })
  return getTags(db, itemId)
}

/** 저장한 기사에 붙은 태그와 개수 (많이 쓴 순) */
export function listTags(db: Db): TagCount[] {
  return all<TagCount>(
    db,
    `SELECT t.name, count(*) AS count
     FROM item_tags it JOIN tags t ON t.id = it.tag_id JOIN saves s ON s.item_id = it.item_id
     GROUP BY t.id ORDER BY count DESC, t.name`
  )
}

// ── 저장 후 처리 (본문 추출·태그 추천) ─────────────────

export function needsEnrichment(db: Db, itemId: number): boolean {
  return one<{ x: number }>(db, 'SELECT 1 AS x FROM saves WHERE item_id = ? AND enriched_at IS NULL', itemId) !== undefined
}

export function markEnriched(db: Db, itemId: number): void {
  run(db, 'UPDATE saves SET enriched_at = ? WHERE item_id = ?', nowIso(), itemId)
}

export function getItemRow(db: Db, itemId: number): ItemRow | undefined {
  return one<ItemRow>(db, 'SELECT * FROM items WHERE id = ?', itemId)
}

// ── 사용자 동작 ──────────────────────────────────────

export function markRead(db: Db, itemId: number): void {
  run(db, 'INSERT OR IGNORE INTO reads (item_id, read_at) VALUES (?, ?)', itemId, nowIso())
}

export function setSaved(db: Db, itemId: number, saved: boolean): void {
  if (saved) run(db, 'INSERT OR IGNORE INTO saves (item_id, saved_at) VALUES (?, ?)', itemId, nowIso())
  else run(db, 'DELETE FROM saves WHERE item_id = ?', itemId)
}

/** 메모를 저장한다. 메모를 쓴 기사는 자동으로 저장 처리한다 (DESIGN.md 6.3절). 빈 메모는 지운다. */
export function saveMemo(db: Db, itemId: number, body: string): string {
  const at = nowIso()
  tx(db, () => {
    if (body.trim() === '') {
      run(db, 'DELETE FROM notes WHERE item_id = ?', itemId)
    } else {
      run(
        db,
        'INSERT INTO notes (item_id, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at',
        itemId,
        body,
        at
      )
      run(db, 'INSERT OR IGNORE INTO saves (item_id, saved_at) VALUES (?, ?)', itemId, at)
    }
    reindexItem(db, itemId)
  })
  return at
}

// ── 하이라이트 ────────────────────────────────────────

interface HighlightRow {
  id: number
  item_id: number
  paragraph: number
  variant: 'ko' | 'original'
  start_offset: number
  end_offset: number
  text: string
  note: string
  created_at: string
}

const toHighlight = (r: HighlightRow): HighlightDTO => ({
  id: r.id,
  paragraph: r.paragraph,
  variant: r.variant,
  start: r.start_offset,
  end: r.end_offset,
  text: r.text,
  note: r.note,
  createdAt: r.created_at
})

export function listHighlights(db: Db, itemId: number): HighlightDTO[] {
  return all<HighlightRow>(db, 'SELECT * FROM highlights WHERE item_id = ? ORDER BY paragraph, start_offset', itemId).map(toHighlight)
}

/**
 * 하이라이트를 긋는다. 글자는 보관된 본문(번역문 또는 원문)에서 잘라 저장하고,
 * 같은 문단·같은 판에서 겹치거나 맞닿는 하이라이트는 하나로 합친다(메모도 합침).
 * 하이라이트를 그은 기사는 메모처럼 자동으로 저장한다. 새로 저장됐으면 newlySaved.
 */
export function addHighlights(db: Db, itemId: number, ranges: HighlightRange[]): { highlights: HighlightDTO[]; newlySaved: boolean } {
  const content = getContent(db, itemId)
  let newlySaved = false
  tx(db, () => {
    for (const r of ranges) {
      const source = r.variant === 'ko' ? content?.paragraphsKo?.[r.paragraph - 1] : content?.paragraphs[r.paragraph - 1]
      if (!source) continue
      let start = Math.max(0, Math.min(r.start, r.end))
      let end = Math.min(source.length, Math.max(r.start, r.end))
      if (source.slice(start, end).trim() === '') continue
      const overlapping = all<HighlightRow>(
        db,
        'SELECT * FROM highlights WHERE item_id = ? AND paragraph = ? AND variant = ? AND start_offset <= ? AND end_offset >= ?',
        itemId,
        r.paragraph,
        r.variant,
        end,
        start
      )
      let createdAt = nowIso()
      const notes: string[] = []
      for (const o of overlapping) {
        start = Math.min(start, o.start_offset)
        end = Math.max(end, o.end_offset)
        if (o.created_at < createdAt) createdAt = o.created_at
        if (o.note.trim()) notes.push(o.note.trim())
        run(db, 'DELETE FROM highlights WHERE id = ?', o.id)
      }
      run(
        db,
        'INSERT INTO highlights (item_id, paragraph, variant, start_offset, end_offset, text, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        itemId,
        r.paragraph,
        r.variant,
        start,
        end,
        source.slice(start, end).trim(),
        notes.join('\n'),
        createdAt
      )
    }
    const saved = db.prepare('INSERT OR IGNORE INTO saves (item_id, saved_at) VALUES (?, ?)').run(itemId, nowIso())
    newlySaved = Number(saved.changes) > 0
    reindexItem(db, itemId)
  })
  return { highlights: listHighlights(db, itemId), newlySaved }
}

/** 하이라이트 메모를 고친다. 그 기사의 하이라이트 목록을 돌려준다 */
export function updateHighlightNote(db: Db, id: number, note: string): HighlightDTO[] {
  const row = one<HighlightRow>(db, 'SELECT * FROM highlights WHERE id = ?', id)
  if (!row) return []
  run(db, 'UPDATE highlights SET note = ? WHERE id = ?', note, id)
  reindexItem(db, row.item_id)
  return listHighlights(db, row.item_id)
}

export function removeHighlight(db: Db, id: number): HighlightDTO[] {
  const row = one<HighlightRow>(db, 'SELECT * FROM highlights WHERE id = ?', id)
  if (!row) return []
  run(db, 'DELETE FROM highlights WHERE id = ?', id)
  reindexItem(db, row.item_id)
  return listHighlights(db, row.item_id)
}

// ── AI 질문 대화 ─────────────────────────────────────

export function chatScopeKey(scope: ChatScope): string {
  return scope.kind === 'item' ? `item:${scope.itemId}` : `digest:${scope.date}`
}

interface ChatMessageRow {
  id: number
  role: 'user' | 'assistant'
  content: string
  citations: string
  created_at: string
}

export function listChatMessages(db: Db, scope: ChatScope): ChatMessageDTO[] {
  return all<ChatMessageRow>(
    db,
    `SELECT m.id, m.role, m.content, m.citations, m.created_at
     FROM chat_messages m JOIN chats c ON c.id = m.chat_id
     WHERE c.scope_key = ? ORDER BY m.id`,
    chatScopeKey(scope)
  ).map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    citations: JSON.parse(r.citations) as number[],
    createdAt: r.created_at
  }))
}

export function addChatMessage(
  db: Db,
  scope: ChatScope,
  m: { role: 'user' | 'assistant'; content: string; citations?: number[]; model?: string }
): ChatMessageDTO {
  const at = nowIso()
  const key = chatScopeKey(scope)
  return tx(db, () => {
    run(db, 'INSERT INTO chats (scope_key, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(scope_key) DO UPDATE SET updated_at = excluded.updated_at', key, at, at)
    const { id: chatId } = one<{ id: number }>(db, 'SELECT id FROM chats WHERE scope_key = ?', key)!
    const r = db
      .prepare('INSERT INTO chat_messages (chat_id, role, content, citations, model, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(chatId, m.role, m.content, JSON.stringify(m.citations ?? []), m.model ?? null, at)
    return { id: Number(r.lastInsertRowid), role: m.role, content: m.content, citations: m.citations ?? [], createdAt: at }
  })
}

export function clearChat(db: Db, scope: ChatScope): void {
  run(db, 'DELETE FROM chats WHERE scope_key = ?', chatScopeKey(scope))
}
