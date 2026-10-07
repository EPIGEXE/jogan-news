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
  return (
    clamp01(t.relevance) * t.importance +
    0.5 * engagementScore(t.engagement) +
    0.3 * Math.min(3, t.otherSources) +
    0.1 * t.ruleScore
  )
}

const CATEGORY_CAP: Partial<Record<Category, number>> = { research: 5, community: 4, industry: 4, other: 3 }
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

  const counts = new Map<Category, number>()
  const picked: Triaged[] = []
  for (const t of eligible) {
    if (picked.length >= size) break
    const cap = CATEGORY_CAP[t.category]
    const n = counts.get(t.category) ?? 0
    if (cap !== undefined && n >= cap) continue
    counts.set(t.category, n + 1)
    picked.push(t)
  }
  return picked.map((t, i) => ({ id: t.id, rank: i + 1, section: i < TOP_COUNT ? 'top' : t.category }))
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
    merges.set(rep.id, rest.map((m) => m.id))
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
