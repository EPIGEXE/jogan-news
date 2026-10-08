import type { Category, Section } from '@shared/types'
import type { Interest } from '../config'

// 점수 계산과 브리핑 항목 선정. DB나 네트워크를 쓰지 않는 순수 함수라 테스트로 동작을 고정한다.

export interface ScoreInput {
  id: number
  title: string
  snippet: string
  sourceWeight: number
  engagement: number
  /** 같은 소식을 다룬 다른 출처 수 */
  otherSources: number
  /** 발행 또는 수집 후 지난 시간 */
  ageHours: number
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

export function keywordScore(text: string, interests: Interest[]): number {
  const lower = text.toLowerCase()
  const sum = interests.reduce((s, k) => (lower.includes(k.term.toLowerCase()) ? s + k.weight : s), 0)
  return clamp01(sum)
}

/** 참여도(HN 점수, HF 추천수)를 0~1로: 1000점 근처에서 1 */
export function engagementScore(engagement: number): number {
  return clamp01(Math.log10(1 + engagement) / 3)
}

/** LLM에 보내기 전 1차 점수 (DESIGN.md 9절 ④) */
export function ruleScore(x: ScoreInput, interests: Interest[]): number {
  return (
    x.sourceWeight +
    keywordScore(`${x.title} ${x.snippet}`, interests) +
    engagementScore(x.engagement) +
    0.3 * Math.min(3, x.otherSources) +
    0.5 * clamp01(1 - x.ageHours / 72)
  )
}

export interface Triaged {
  id: number
  category: Category
  relevance: number
  importance: number
  ruleScore: number
  engagement: number
  otherSources: number
}

/** LLM 선별 결과를 반영한 최종 점수 */
export function finalScore(t: Triaged): number {
  return clamp01(t.relevance) * t.importance + 0.5 * engagementScore(t.engagement) + 0.3 * Math.min(3, t.otherSources) + 0.1 * t.ruleScore
}

const CATEGORY_CAP: Partial<Record<Category, number>> = { research: 3, community: 4, industry: 3, other: 3 }
/** 충분히 관련 있는 후보가 있으면 이만큼은 꼭 싣는다 (개발 도구·실전 소식이 큰 뉴스에 밀려 빠지지 않게) */
const CATEGORY_QUOTA: Partial<Record<Category, number>> = { tools: 3, applied: 2 }
/** 최소 몫으로 넣을 수 있는 기준. 일반 기준보다 높여서 자리 채우기용 약한 글이 들어오지 않게 한다 */
const QUOTA_MIN_RELEVANCE = 0.6
const QUOTA_MIN_IMPORTANCE = 2
const MIN_RELEVANCE = 0.4
const TOP_COUNT = 5

export interface Selected {
  id: number
  rank: number
  section: Section
}

/**
 * 최종 점수 순으로 브리핑 항목을 고른다.
 * - 관련도가 낮은 항목은 빼되, 중요도 5짜리는 '그 외 주요 소식'으로 남긴다.
 * - 도구·실전 분류는 최소 몫을 먼저 채우고, 나머지 자리는 점수 순으로 채운다.
 * - 분류별 상한을 지킨다. 상위 5개는 'top' 섹션, 나머지는 자기 분류 섹션에 들어간다.
 */
export function selectEntries(items: Triaged[], size: number): Selected[] {
  const eligible = items
    .map((t) => {
      if (t.relevance >= MIN_RELEVANCE) return t
      if (t.importance >= 5) return { ...t, category: 'other' as const }
      return null
    })
    .filter((t): t is Triaged => t !== null)
    .sort((a, b) => finalScore(b) - finalScore(a))

  const picked = new Set<Triaged>()
  for (const [category, quota] of Object.entries(CATEGORY_QUOTA) as [Category, number][]) {
    const strong = eligible.filter(
      (x) => x.category === category && x.relevance >= QUOTA_MIN_RELEVANCE && x.importance >= QUOTA_MIN_IMPORTANCE
    )
    for (const t of strong.slice(0, quota)) {
      if (picked.size < size) picked.add(t)
    }
  }
  const counts = new Map<Category, number>()
  for (const t of picked) counts.set(t.category, (counts.get(t.category) ?? 0) + 1)
  for (const t of eligible) {
    if (picked.size >= size) break
    if (picked.has(t)) continue
    const cap = CATEGORY_CAP[t.category]
    const n = counts.get(t.category) ?? 0
    if (cap !== undefined && n >= cap) continue
    counts.set(t.category, n + 1)
    picked.add(t)
  }
  return [...picked]
    .sort((a, b) => finalScore(b) - finalScore(a))
    .map((t, i) => ({ id: t.id, rank: i + 1, section: i < TOP_COUNT ? 'top' : t.category }))
}

/**
 * 순위대로 고른 항목의 본문을 확인하며, 본문이 부족한 항목은 빼고 다음 순위 후보로 채운다.
 * hasBody는 항목마다 한 번만 부르고(결과를 기억), 전체 확인 횟수는 maxChecks까지만 한다.
 * 상한에 걸려 확인하지 못한 자리는 비워 둔다. 분류별 최소 몫·상한은 selectEntries가 다시 지킨다.
 */
export async function fillWithContent(
  items: Triaged[],
  size: number,
  maxChecks: number,
  hasBody: (id: number) => Promise<boolean>
): Promise<{ selected: Selected[]; excluded: number[] }> {
  const checked = new Map<number, boolean>()
  let selected = selectEntries(items, size)
  for (;;) {
    const pending = selected.filter((s) => !checked.has(s.id)).slice(0, Math.max(0, maxChecks - checked.size))
    if (pending.length === 0) break
    const results = await Promise.all(pending.map(async (s) => [s.id, await hasBody(s.id)] as const))
    for (const [id, ok] of results) checked.set(id, ok)
    // 빠진 항목이 있으면 그 자리를 다음 순위 후보로 채워 다시 고른다
    if (results.some(([, ok]) => !ok)) selected = selectEntries(items.filter((t) => checked.get(t.id) !== false), size)
  }
  const okIds = new Set(selected.filter((s) => checked.get(s.id) === true).map((s) => s.id))
  return {
    selected: selectEntries(
      items.filter((t) => okIds.has(t.id)),
      size
    ),
    excluded: [...checked].filter(([, ok]) => !ok).map(([id]) => id)
  }
}

export interface ClusterResult {
  items: Triaged[]
  /** 대표 id → 합쳐진 나머지 id */
  merges: Map<number, number[]>
}

export interface ClusterGroup {
  ids: number[]
  /** LLM이 고른 원본에 가장 가까운 기사 (공식 발표 > 보도 > 커뮤니티) */
  primary?: number
}

/**
 * LLM이 묶은 같은 소식 그룹을 대표 하나로 합친다. 대표는 LLM이 고른 primary,
 * 없거나 그룹에 없으면 중요도가 가장 높은 항목이다. 대표는 다른 출처 수와 참여도·중요도(최댓값)를 물려받는다.
 * 한 항목이 여러 그룹에 나오면 처음 그룹만 인정한다.
 */
export function applyClusters(items: Triaged[], groups: ClusterGroup[]): ClusterResult {
  const byId = new Map(items.map((t) => [t.id, t]))
  const used = new Set<number>()
  const merges = new Map<number, number[]>()
  const replaced = new Map<number, Triaged>()
  for (const g of groups) {
    const members = [...new Set(g.ids)].filter((id) => byId.has(id) && !used.has(id)).map((id) => byId.get(id)!)
    if (members.length < 2) continue
    members.forEach((m) => used.add(m.id))
    // 대표: 중요도가 가장 높은 항목(보통 공식 발표), 같으면 최종 점수가 높은 항목
    const rank = (x: Triaged) => x.importance * 100 + finalScore(x)
    const rep = members.find((m) => m.id === g.primary) ?? members.reduce((a, b) => (rank(b) > rank(a) ? b : a))
    const rest = members.filter((m) => m.id !== rep.id)
    merges.set(
      rep.id,
      rest.map((m) => m.id)
    )
    replaced.set(rep.id, {
      ...rep,
      otherSources: rep.otherSources + rest.reduce((n, m) => n + 1 + m.otherSources, 0),
      engagement: Math.max(rep.engagement, ...rest.map((m) => m.engagement)),
      importance: Math.max(rep.importance, ...rest.map((m) => m.importance))
    })
  }
  const dropped = new Set([...merges.values()].flat())
  return {
    items: items.filter((t) => !dropped.has(t.id)).map((t) => replaced.get(t.id) ?? t),
    merges
  }
}
