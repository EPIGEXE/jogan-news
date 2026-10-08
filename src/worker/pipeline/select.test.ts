import { describe, expect, it } from 'vitest'
import { applyClusters, engagementScore, fillWithContent, keywordScore, selectEntries, type Triaged } from './select'

const t = (id: number, over: Partial<Triaged> = {}): Triaged => ({
  id,
  category: 'model_release',
  relevance: 0.9,
  importance: 3,
  ruleScore: 1,
  engagement: 0,
  otherSources: 0,
  ...over
})

describe('selectEntries', () => {
  it('중요도와 관련도가 높은 순으로 고르고 상위 5개를 top으로 둔다', () => {
    const items = [t(1, { importance: 2 }), t(2, { importance: 5 }), t(3, { importance: 4 }), t(4), t(5), t(6), t(7)]
    const sel = selectEntries(items, 10)
    expect(sel[0]!.id).toBe(2)
    expect(sel[1]!.id).toBe(3)
    expect(sel.slice(0, 5).every((s) => s.section === 'top')).toBe(true)
    expect(sel[5]!.section).toBe('model_release')
    expect(sel.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('관련도가 낮으면 빼되, 중요도 5는 그 외 주요 소식으로 남긴다', () => {
    const items = [t(1), t(2), t(3), t(4), t(5), t(6, { relevance: 0.1, importance: 4 }), t(7, { relevance: 0.1, importance: 5 })]
    const sel = selectEntries(items, 10)
    expect(sel.find((s) => s.id === 6)).toBeUndefined()
    // 7은 다른 5개보다 점수가 낮아 6위가 되고, 분류가 other로 바뀌어 그 섹션에 들어간다
    const seven = sel.find((s) => s.id === 7)
    expect(seven).toMatchObject({ rank: 6, section: 'other' })
  })

  it('분류별 상한을 지킨다 (논문 최대 3개)', () => {
    const papers = Array.from({ length: 8 }, (_, i) => t(i + 1, { category: 'research', importance: 5 }))
    const sel = selectEntries([...papers, t(100, { importance: 1 })], 20)
    expect(sel.filter((s) => s.id <= 8)).toHaveLength(3)
    expect(sel.find((s) => s.id === 100)).toBeDefined()
  })

  it('도구·실전 분류는 점수가 낮아도 최소 몫(3·2)을 채우고, 순위는 점수대로 매긴다', () => {
    const big = Array.from({ length: 10 }, (_, i) => t(i + 1, { importance: 5 }))
    const tools = Array.from({ length: 4 }, (_, i) => t(20 + i, { category: 'tools', importance: 2 }))
    const applied = Array.from({ length: 3 }, (_, i) => t(30 + i, { category: 'applied', importance: 2 }))
    const sel = selectEntries([...big, ...tools, ...applied], 8)
    expect(sel).toHaveLength(8)
    expect(sel.filter((s) => s.id >= 20 && s.id < 30)).toHaveLength(3)
    expect(sel.filter((s) => s.id >= 30)).toHaveLength(2)
    expect(sel.slice(0, 3).map((s) => s.id)).toEqual([1, 2, 3])
  })

  it('최소 몫은 관련도 0.6·중요도 2 이상인 후보로만 채운다', () => {
    const big = Array.from({ length: 5 }, (_, i) => t(i + 1, { importance: 5 }))
    const weak = [t(20, { category: 'tools', relevance: 0.5, importance: 3 }), t(21, { category: 'applied', relevance: 0.9, importance: 1 })]
    expect(selectEntries([...big, ...weak], 5).map((s) => s.id)).toEqual([1, 2, 3, 4, 5])
  })

  it('크기를 넘지 않는다', () => {
    expect(selectEntries(Array.from({ length: 30 }, (_, i) => t(i + 1)), 18)).toHaveLength(18)
  })
})

describe('점수 보조 함수', () => {
  it('키워드 점수는 합을 1에서 자른다', () => {
    const interests = [
      { term: 'agent', weight: 0.6 },
      { term: 'MCP', weight: 0.6 }
    ]
    expect(keywordScore('An MCP agent framework', interests)).toBe(1)
    expect(keywordScore('nothing here', interests)).toBe(0)
  })
  it('참여도 점수는 0~1 사이', () => {
    expect(engagementScore(0)).toBe(0)
    expect(engagementScore(999)).toBeCloseTo(1, 2)
    expect(engagementScore(100000)).toBe(1)
  })
})

describe('applyClusters', () => {
  it('LLM이 고른 primary를 대표로 쓴다', () => {
    const r = applyClusters([t(1, { importance: 5 }), t(2, { importance: 3 })], [{ ids: [1, 2], primary: 2 }])
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ id: 2, importance: 5, otherSources: 1 })
  })

  it('같은 소식 묶음을 점수가 가장 높은 대표 하나로 합치고 출처 수와 참여도를 물려준다', () => {
    const items = [t(1, { importance: 5 }), t(2, { importance: 3, engagement: 900 }), t(3, { otherSources: 1 }), t(4)]
    const r = applyClusters(items, [{ ids: [1, 2, 3] }])
    expect(r.items.map((x) => x.id)).toEqual([1, 4])
    expect(r.items[0]).toMatchObject({ id: 1, otherSources: 3, engagement: 900, importance: 5 })
    expect(r.merges.get(1)).toEqual([2, 3])
  })

  it('없는 id, 한 개짜리 묶음, 이미 쓴 id는 무시한다', () => {
    const r = applyClusters([t(1), t(2), t(3)], [{ ids: [1, 99] }, { ids: [2, 3] }, { ids: [3, 1] }])
    expect(r.items.map((x) => x.id).sort()).toEqual([1, 2])
    expect(r.merges.size).toBe(1)
  })
})

describe('fillWithContent', () => {
  const ranked = (n: number) => Array.from({ length: n }, (_, i) => t(i + 1, { importance: 5 - i * 0.1 }))

  it('본문이 부족한 항목은 빼고 다음 순위 후보로 채운다', async () => {
    const thin = new Set([2, 4])
    const { selected, excluded } = await fillWithContent(ranked(10), 5, 10, async (id) => !thin.has(id))
    expect(selected.map((s) => s.id)).toEqual([1, 3, 5, 6, 7])
    expect(selected.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5])
    expect(excluded.sort()).toEqual([2, 4])
  })

  it('항목마다 한 번만 확인하고, 확인 횟수 상한에 걸린 자리는 비워 둔다', async () => {
    const calls: number[] = []
    const { selected } = await fillWithContent(ranked(10), 4, 5, async (id) => {
      calls.push(id)
      return id > 3 // 1·2·3은 본문 없음
    })
    expect(new Set(calls).size).toBe(calls.length)
    expect(calls).toHaveLength(5)
    expect(selected.map((s) => s.id)).toEqual([4, 5])
  })
})
