// ============================================================================
// 브리핑 조회 · 검색 서비스 테스트
//
// [역할]
// - 최신 브리핑 · 날짜별 브리핑 · 브리핑 목록 · 마지막 브리핑 날짜 조회 확인
// - 브리핑에 실린 기사에 읽음 · 저장 · 메모가 반영되는지 확인
// - 라이브러리(저장한 기사) · 아카이브(실린 기사) 검색의 범위와 메모 · 태그 조건 확인
// ============================================================================
import { describe, expect, it, vi } from 'vitest'
import { ArticleService } from './article-service'
import { DigestService } from './digest-service'
import { SearchService } from './search-service'
import { TagService } from './tag-service'
import { createFakeEvents, createFakeWorker, createTestRepositories, insertTestItem } from './test-support'

const DIGEST_STATS = { sources: 1, collected: 1, candidates: 1, selected: 1, costUsd: 0, failedSources: [], saveMode: false }

function setup() {
    const repositories = createTestRepositories()
    const tagService = new TagService({ database: repositories.database, tagRepository: repositories.tagRepository })
    const articleService = new ArticleService({
        ...repositories,
        tags: tagService,
        worker: createFakeWorker({ enrichItem: () => ({ contentUpdated: false, suggestedTags: [] }), translateItem: () => false }).worker,
        events: createFakeEvents(),
        log: vi.fn()
    })
    const digestService = new DigestService(repositories)
    const searchService = new SearchService(repositories)

    // 그 날짜의 브리핑에 기사 한 건을 1위로 실음
    const publishDigest = (digestDate: string, headline: string, itemId: number): void => {
        const digestId = repositories.digestRepository.insertDigest(digestDate, { headline, overview: null, stats: DIGEST_STATS })
        repositories.digestRepository.insertEntries(digestId, [{ itemId, rank: 1, section: 'top', whyItMatters: null }])
    }
    return { ...repositories, tagService, articleService, digestService, searchService, publishDigest }
}

describe('DigestService', () => {
    it('브리핑이 하나도 없으면 최신 브리핑과 마지막 날짜는 null', () => {
        const { digestService } = setup()
        expect(digestService.getLatestDigest()).toBeNull()
        expect(digestService.getLastDigestDate()).toBeNull()
        expect(digestService.listDigests()).toEqual([])
    })

    it('날짜별 브리핑 목록과 특정 날짜 브리핑, 마지막 브리핑 날짜를 돌려준다', () => {
        const { digestService, articleService, itemRepository, publishDigest } = setup()
        const yesterdayItemId = insertTestItem(itemRepository)
        const todayItemId = insertTestItem(itemRepository, { title: 'Second day story' })
        publishDigest('2026-10-06', '어제', yesterdayItemId)
        publishDigest('2026-10-07', '오늘', todayItemId)
        articleService.setSaved(yesterdayItemId, true)

        expect(
            digestService.listDigests().map((digestSummary) => [digestSummary.date, digestSummary.entryCount, digestSummary.savedCount])
        ).toEqual([
            ['2026-10-07', 1, 0],
            ['2026-10-06', 1, 1]
        ])
        expect(digestService.getDigestByDate('2026-10-06')!.headline).toBe('어제')
        expect(digestService.getDigestByDate('2026-10-05')).toBeNull()
        expect(digestService.getLatestDigest()!.headline).toBe('오늘')
        expect(digestService.getLastDigestDate()).toBe('2026-10-07')
    })

    it('메모 · 읽음 · 저장 해제가 브리핑에 실린 기사에 반영된다', () => {
        const { digestService, articleService, itemRepository, publishDigest } = setup()
        const itemId = insertTestItem(itemRepository)
        publishDigest('2026-10-07', '오늘', itemId)

        articleService.saveMemo(itemId, '비용 계산해 볼 것')
        articleService.markRead(itemId)
        expect(digestService.getLatestDigest()!.entries[0]).toMatchObject({ memo: '비용 계산해 볼 것', isSaved: true, isRead: true })

        articleService.saveMemo(itemId, '  ')
        articleService.setSaved(itemId, false)
        expect(digestService.getLatestDigest()!.entries[0]).toMatchObject({ memo: '', isSaved: false })
    })
})

describe('SearchService', () => {
    it('라이브러리는 저장한 기사만 찾고, 메모가 있는 기사만 · 태그 조건을 지원한다', () => {
        const { searchService, articleService, tagService, itemRepository } = setup()
        const savedItemId = insertTestItem(itemRepository)
        const memoItemId = insertTestItem(itemRepository, { title: 'Other title here' })
        insertTestItem(itemRepository, { title: 'Not saved item' })
        articleService.setSaved(savedItemId, true)
        articleService.saveMemo(memoItemId, '메모')
        tagService.addTag(savedItemId, ' #Coding Agent ')

        const foundItemIds = (searchParams: Parameters<SearchService['search']>[0]) =>
            searchService.search(searchParams).map((libraryItem) => libraryItem.itemId)
        expect(foundItemIds({ scope: 'saved' }).sort()).toEqual([savedItemId, memoItemId].sort())
        expect(foundItemIds({ scope: 'saved', memoOnly: true })).toEqual([memoItemId])
        expect(foundItemIds({ scope: 'saved', tag: 'coding-agent' })).toEqual([savedItemId])
        expect(tagService.listTagCounts()).toEqual([{ name: 'coding-agent', count: 1 }])
    })

    it('아카이브는 브리핑에 실린 기사를 찾고 실린 날짜를 붙인다', () => {
        const { searchService, searchRepository, itemRepository, publishDigest } = setup()
        const firstItemId = insertTestItem(itemRepository)
        const secondItemId = insertTestItem(itemRepository, { title: 'Second day story' })
        // 기사 제목을 검색 색인에 올림 (실제로는 수집한 Worker가 함)
        searchRepository.reindexItem(firstItemId)
        searchRepository.reindexItem(secondItemId)
        publishDigest('2026-10-06', '어제', firstItemId)
        publishDigest('2026-10-07', '오늘', secondItemId)

        expect(
            searchService.search({ scope: 'published', query: 'Second' }).map((libraryItem) => [libraryItem.itemId, libraryItem.digestDate])
        ).toEqual([[secondItemId, '2026-10-07']])
        expect(searchService.search({ scope: 'published' }).map((libraryItem) => libraryItem.itemId)).toEqual([secondItemId, firstItemId])
    })
})
