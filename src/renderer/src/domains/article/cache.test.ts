// ============================================================================
// 기사 캐시 갱신 테스트
//
// [역할]
// - 기사 한 건을 고쳤을 때 브리핑 · 검색 결과 · 기사 상세 캐시가 함께 바뀌는지 확인
// ============================================================================
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { DigestDTO, DigestEntryDTO, ItemDetailDTO, LibraryItemDTO } from '@shared/types'
import { queryKeys } from '@/common/lib/queryKeys'
import { patchArticle } from '@/domains/article/cache'
import { setHighlights } from '@/domains/highlight/cache'

const entry = (itemId: number): DigestEntryDTO => ({
  itemId,
  rank: itemId,
  section: 'top',
  category: 'tools',
  titleKo: `기사 ${itemId}`,
  originalTitle: `Item ${itemId}`,
  summaryKo: '',
  keyPoints: [],
  whyItMatters: null,
  url: `https://a.com/${itemId}`,
  sourceName: 'A',
  engagementLabel: null,
  otherSources: [],
  publishedAt: null,
  isRead: false,
  isSaved: false,
  memo: '',
  tags: [],
  followUpOf: null
})

const digest = (date: string, ids: number[]): DigestDTO => ({
  id: 1,
  date,
  headline: 'h',
  overview: null,
  createdAt: '',
  stats: { sources: 0, collected: 0, candidates: 0, selected: 0, costUsd: 0, failedSources: [], saveMode: false },
  entries: ids.map(entry)
})

describe('patchArticle', () => {
  it('같은 기사를 최신·날짜별 브리핑, 검색 결과, 상세 캐시에서 한꺼번에 고친다', () => {
    const qc = new QueryClient()
    qc.setQueryData(queryKeys.latestDigest, digest('2026-10-08', [1, 2]))
    qc.setQueryData(queryKeys.digestByDate('2026-10-07'), digest('2026-10-07', [1]))
    const lib: LibraryItemDTO = { itemId: 1, titleKo: '', originalTitle: '', summaryKo: '', category: 'tools', sourceName: 'A', url: '', isSaved: false, savedAt: null, digestDate: null, memo: '', tags: [] }
    qc.setQueryData(queryKeys.search({ scope: 'saved' }), [lib])
    qc.setQueryData(queryKeys.itemDetail(1), { ...entry(1), savedAt: null, digestDate: null, paragraphs: [], fullText: true, paragraphsKo: null, translation: 'missing', highlights: [] } satisfies ItemDetailDTO)

    patchArticle(qc, 1, { isSaved: true, tags: ['mcp'], isRead: true })

    expect(qc.getQueryData<DigestDTO>(queryKeys.latestDigest)!.entries.map((e) => [e.itemId, e.isSaved, e.tags])).toEqual([
      [1, true, ['mcp']],
      [2, false, []]
    ])
    expect(qc.getQueryData<DigestDTO>(queryKeys.digestByDate('2026-10-07'))!.entries[0]!.isSaved).toBe(true)
    // 검색 결과 한 줄에는 그 줄에 있는 필드만 들어간다 (isRead는 없음)
    expect(qc.getQueryData<LibraryItemDTO[]>(queryKeys.search({ scope: 'saved' }))![0]).toEqual({ ...lib, isSaved: true, tags: ['mcp'] })
    expect(qc.getQueryData<ItemDetailDTO>(queryKeys.itemDetail(1))).toMatchObject({ isSaved: true, tags: ['mcp'], isRead: true })
  })

  it('캐시에 없는 기사는 건드리지 않고, 하이라이트는 상세 캐시에 넣는다', () => {
    const qc = new QueryClient()
    const d = digest('2026-10-08', [2])
    qc.setQueryData(queryKeys.latestDigest, d)
    patchArticle(qc, 9, { isSaved: true })
    expect(qc.getQueryData(queryKeys.latestDigest)).toBe(d)
    expect(qc.getQueryData(queryKeys.itemDetail(9))).toBeUndefined()

    qc.setQueryData(queryKeys.itemDetail(2), { ...entry(2), savedAt: null, digestDate: null, paragraphs: [], fullText: true, paragraphsKo: null, translation: 'missing', highlights: [] } satisfies ItemDetailDTO)
    const hl = { id: 5, paragraph: 1, variant: 'ko' as const, start: 0, end: 3, text: 'abc', note: '', createdAt: '' }
    setHighlights(qc, 2, [hl])
    expect(qc.getQueryData<ItemDetailDTO>(queryKeys.itemDetail(2))!.highlights).toEqual([hl])
  })
})
