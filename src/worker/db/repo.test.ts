import { describe, expect, it } from 'vitest'
import type { RawItem } from '../collectors/types'
import { openDb } from './db'
import * as repo from './repo'

const raw = (over: Partial<RawItem> = {}): RawItem => ({
  sourceId: 'hn',
  sourceName: 'Hacker News',
  kind: 'community',
  title: 'Mistral Large 4 released',
  url: 'https://mistral.ai/news/large-4?utm_source=hn',
  publishedAt: new Date().toISOString(),
  snippet: '',
  engagement: 100,
  engagementLabel: 'HN 100점',
  lang: 'en',
  ...over
})

const stats = { sources: 1, collected: 1, candidates: 1, selected: 1, costUsd: 0, failedSources: [], saveMode: false }

describe('repo', () => {
  it('같은 URL은 한 항목으로 합치고, 다른 출처는 other_sources에 쌓는다', () => {
    const db = openDb(':memory:')
    const a = repo.upsertRawItem(db, raw())
    const b = repo.upsertRawItem(db, raw({ sourceId: 'gn', sourceName: 'GeekNews', url: 'https://mistral.ai/news/large-4', engagement: 0, engagementLabel: null }))
    expect(a.isNew).toBe(true)
    expect(b).toEqual({ id: a.id, isNew: false })
    const [item] = repo.getCandidates(db, new Date(0).toISOString(), '2026-10-07')
    expect(JSON.parse(item!.other_sources)).toEqual([{ sourceName: 'GeekNews', url: 'https://mistral.ai/news/large-4', engagementLabel: null }])
    expect(item!.engagement).toBe(100)
  })

  it('합쳐진 항목은 다음 후보에서 빠진다', () => {
    const db = openDb(':memory:')
    const a = repo.upsertRawItem(db, raw())
    const b = repo.upsertRawItem(db, raw({ sourceId: 'tc', sourceName: 'TechCrunch', title: 'Mistral launches a 1T model', url: 'https://techcrunch.com/mistral', engagement: 0 }))
    const r = repo.mergeInto(db, a.id, [b.id])
    expect(r.otherSources).toBe(1)
    expect(repo.getCandidates(db, new Date(0).toISOString(), '2026-10-07').map((c) => c.id)).toEqual([a.id])
  })

  it('메모를 쓰면 자동으로 저장되고, 빈 메모는 지워진다. 읽음도 브리핑에 반영된다', () => {
    const db = openDb(':memory:')
    const { id } = repo.upsertRawItem(db, raw())
    repo.publishDigest(db, { date: '2026-10-07', headline: 'h', overview: null, stats, entries: [{ itemId: id, rank: 1, section: 'top', whyItMatters: null }] })

    repo.saveMemo(db, id, '비용 계산해 볼 것')
    repo.markRead(db, id)
    let e = repo.getLatestDigest(db)!.entries[0]!
    expect(e).toMatchObject({ memo: '비용 계산해 볼 것', isSaved: true, isRead: true })

    repo.saveMemo(db, id, '  ')
    repo.setSaved(db, id, false)
    e = repo.getLatestDigest(db)!.entries[0]!
    expect(e).toMatchObject({ memo: '', isSaved: false })
  })

  it('같은 날짜로 다시 게시하면 브리핑을 바꿔 끼운다', () => {
    const db = openDb(':memory:')
    const a = repo.upsertRawItem(db, raw())
    const b = repo.upsertRawItem(db, raw({ title: 'Another story here', url: 'https://example.com/other' }))
    repo.publishDigest(db, { date: '2026-10-07', headline: '1차', overview: null, stats, entries: [{ itemId: a.id, rank: 1, section: 'top', whyItMatters: null }] })
    repo.publishDigest(db, { date: '2026-10-07', headline: '2차', overview: null, stats, entries: [{ itemId: b.id, rank: 1, section: 'top', whyItMatters: null }] })
    const d = repo.getLatestDigest(db)!
    expect(d.headline).toBe('2차')
    expect(d.entries.map((e) => e.itemId)).toEqual([b.id])
  })

  it('설정은 기본값 위에 저장한 값만 덮는다', () => {
    const db = openDb(':memory:')
    expect(repo.getSettings(db).budgetUsd).toBe(5)
    expect(repo.updateSettings(db, { budgetUsd: 3 })).toMatchObject({ budgetUsd: 3, dailyCapUsd: 0.5 })
  })

  it('검색: 3글자 이상은 전문 검색, 2글자는 LIKE로 찾고, 메모 내용도 찾는다', () => {
    const db = openDb(':memory:')
    const a = repo.upsertRawItem(db, raw({ title: 'Agent memory benchmark', url: 'https://a.com/1' }))
    const b = repo.upsertRawItem(db, raw({ title: 'Pricing update for API', url: 'https://a.com/2' }))
    repo.saveSummary(db, a.id, { titleKo: '에이전트 메모리 벤치마크', summaryKo: '새 모델 평가', keyPoints: [], whyKo: '' }, 'm')
    repo.setSaved(db, a.id, true)
    repo.saveMemo(db, b.id, '사내 분류기 비용 비교')
    const ids = (q: string) => repo.searchItems(db, { scope: 'saved', query: q }).map((r) => r.itemId)
    expect(ids('에이전트')).toEqual([a.id])
    expect(ids('모델')).toEqual([a.id]) // 2글자
    expect(ids('분류기')).toEqual([b.id]) // 메모
    expect(ids('benchmark 에이전트')).toEqual([a.id]) // AND
    expect(ids('없는말')).toEqual([])
    expect(ids('50%_')).toEqual([]) // LIKE 특수문자
  })

  it('라이브러리는 저장한 기사만, 메모 필터와 태그 필터를 지원한다', () => {
    const db = openDb(':memory:')
    const a = repo.upsertRawItem(db, raw({ url: 'https://a.com/1' }))
    const b = repo.upsertRawItem(db, raw({ title: 'Other title here', url: 'https://a.com/2' }))
    repo.upsertRawItem(db, raw({ title: 'Not saved item', url: 'https://a.com/3' }))
    repo.setSaved(db, a.id, true)
    repo.saveMemo(db, b.id, '메모')
    repo.addTag(db, a.id, ' #Coding Agent ', 'user')
    expect(repo.searchItems(db, { scope: 'saved' }).map((r) => r.itemId).sort()).toEqual([a.id, b.id].sort())
    expect(repo.searchItems(db, { scope: 'saved', memoOnly: true }).map((r) => r.itemId)).toEqual([b.id])
    expect(repo.searchItems(db, { scope: 'saved', tag: 'coding-agent' }).map((r) => r.itemId)).toEqual([a.id])
    expect(repo.listTags(db)).toEqual([{ name: 'coding-agent', count: 1 }])
  })

  it('태그: 정리해서 붙이고, 떼면 아무도 안 쓰는 태그는 지운다', () => {
    const db = openDb(':memory:')
    const { id } = repo.upsertRawItem(db, raw())
    expect(repo.addTag(db, id, 'MCP', 'auto')).toEqual(['mcp'])
    expect(repo.addTag(db, id, 'mcp', 'user')).toEqual(['mcp'])
    expect(repo.addTag(db, id, 'open weight', 'user')).toEqual(['mcp', 'open-weight'])
    expect(repo.addTag(db, id, 'openweight', 'auto')).toEqual(['mcp', 'open-weight']) // 하이픈만 다르면 기존 표기로
    expect(repo.removeTag(db, id, 'MCP')).toEqual(['open-weight'])
    expect(repo.getItemDetail(db, id)!.tags).toEqual(['open-weight'])
  })

  it('아카이브: 날짜별 브리핑 목록과 특정 날짜 브리핑, 실린 기사 검색', () => {
    const db = openDb(':memory:')
    const a = repo.upsertRawItem(db, raw({ url: 'https://a.com/1' }))
    const b = repo.upsertRawItem(db, raw({ title: 'Second day story', url: 'https://a.com/2' }))
    repo.publishDigest(db, { date: '2026-10-06', headline: '어제', overview: null, stats, entries: [{ itemId: a.id, rank: 1, section: 'top', whyItMatters: null }] })
    repo.publishDigest(db, { date: '2026-10-07', headline: '오늘', overview: null, stats, entries: [{ itemId: b.id, rank: 1, section: 'top', whyItMatters: null }] })
    repo.setSaved(db, a.id, true)
    expect(repo.listDigests(db).map((d) => [d.date, d.entries, d.saved])).toEqual([['2026-10-07', 1, 0], ['2026-10-06', 1, 1]])
    expect(repo.getDigestByDate(db, '2026-10-06')!.headline).toBe('어제')
    expect(repo.searchItems(db, { scope: 'published', query: 'Second' }).map((r) => [r.itemId, r.digestDate])).toEqual([[b.id, '2026-10-07']])
  })

  it('기사 상세: 본문 문단과 추출 여부를 돌려준다', () => {
    const db = openDb(':memory:')
    const { id } = repo.upsertRawItem(db, raw({ snippet: '요약만 있음' }))
    expect(repo.getItemDetail(db, id)).toMatchObject({ paragraphs: ['요약만 있음'], fullText: false })
    repo.saveContent(db, id, ['첫 문단', '둘째 문단'], true)
    expect(repo.getItemDetail(db, id)).toMatchObject({ paragraphs: ['첫 문단', '둘째 문단'], fullText: true })
  })
})
