import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { DigestDTO, DigestEntryDTO, ItemDetailDTO, LibraryItemDTO } from '@shared/types'
import { qk } from '@/common/lib/queryKeys'
import { patchArticle, setHighlights } from '@/domains/article/cache'

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
    qc.setQueryData(qk.latestDigest, digest('2026-10-08', [1, 2]))
    qc.setQueryData(qk.digestByDate('2026-10-07'), digest('2026-10-07', [1]))
    const lib: LibraryItemDTO = { itemId: 1, titleKo: '', originalTitle: '', summaryKo: '', category: 'tools', sourceName: 'A', url: '', isSaved: false, savedAt: null, digestDate: null, memo: '', tags: [] }
    qc.setQueryData(qk.search({ scope: 'saved' }), [lib])
    qc.setQueryData(qk.item(1), { ...entry(1), savedAt: null, digestDate: null, paragraphs: [], fullText: true, paragraphsKo: null, translation: 'missing', highlights: [] } satisfies ItemDetailDTO)

    patchArticle(qc, 1, { isSaved: true, tags: ['mcp'], isRead: true })

    expect(qc.getQueryData<DigestDTO>(qk.latestDigest)!.entries.map((e) => [e.itemId, e.isSaved, e.tags])).toEqual([
      [1, true, ['mcp']],
      [2, false, []]
    ])
    expect(qc.getQueryData<DigestDTO>(qk.digestByDate('2026-10-07'))!.entries[0]!.isSaved).toBe(true)
    // 검색 결과 한 줄에는 그 줄에 있는 필드만 들어간다 (isRead는 없음)
    expect(qc.getQueryData<LibraryItemDTO[]>(qk.search({ scope: 'saved' }))![0]).toEqual({ ...lib, isSaved: true, tags: ['mcp'] })
    expect(qc.getQueryData<ItemDetailDTO>(qk.item(1))).toMatchObject({ isSaved: true, tags: ['mcp'], isRead: true })
  })

  it('캐시에 없는 기사는 건드리지 않고, 하이라이트는 상세 캐시에 넣는다', () => {
    const qc = new QueryClient()
    const d = digest('2026-10-08', [2])
    qc.setQueryData(qk.latestDigest, d)
    patchArticle(qc, 9, { isSaved: true })
    expect(qc.getQueryData(qk.latestDigest)).toBe(d)
    expect(qc.getQueryData(qk.item(9))).toBeUndefined()

    qc.setQueryData(qk.item(2), { ...entry(2), savedAt: null, digestDate: null, paragraphs: [], fullText: true, paragraphsKo: null, translation: 'missing', highlights: [] } satisfies ItemDetailDTO)
    const hl = { id: 5, paragraph: 1, variant: 'ko' as const, start: 0, end: 3, text: 'abc', note: '', createdAt: '' }
    setHighlights(qc, 2, [hl])
    expect(qc.getQueryData<ItemDetailDTO>(qk.item(2))!.highlights).toEqual([hl])
  })
})
