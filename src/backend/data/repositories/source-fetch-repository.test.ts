// ============================================================================
// 출처 수집 기록 저장소 테스트
//
// [역할]
// - 메모리 DB에 실제 쿼리를 돌려 수집 기록의 쓰기 · 삭제와 출처 통계 집계 확인
// - 출처별 단계 개수(기간 · 전체), 최근 수집 기록 · 최근 실린 기사의 출처별 상한과 정렬
// - 실패 횟수, 날짜별 수집 · 실린 글 수의 시작 날짜 경계
// ============================================================================
import { describe, expect, it } from 'vitest'
import type { AppDatabase } from '../client'
import { digestEntries, digests, items, saves, sourceFetches } from '../schema'
import { openTestDatabase } from '../testing'
import { createSourceFetchRepository, type SourceFetchInput } from './source-fetch-repository'

const stats = { sources: 1, collected: 1, candidates: 1, selected: 1, costUsd: 0, failedSources: [], saveMode: false }

// 기사 한 건을 직접 넣고 기사 번호를 돌려줌
function insertItem(database: AppDatabase, title: string, itemOverrides: Partial<typeof items.$inferInsert> = {}): number {
    return database
        .insert(items)
        .values({
            urlKey: `example.com/${title}`,
            url: `https://example.com/${title}`,
            sourceId: 'hn',
            sourceName: 'Hacker News',
            kind: 'community',
            title,
            titleNorm: title.toLowerCase(),
            collectedAt: '2026-10-07T00:00:00.000Z',
            ...itemOverrides
        })
        .returning({ id: items.id })
        .get().id
}

// 그 날짜의 브리핑을 만들고 기사들을 넘긴 순서대로 순위 1부터 실음
function insertDigestWithItems(database: AppDatabase, digestDate: string, itemIds: number[]): void {
    const digestId = database
        .insert(digests)
        .values({ date: digestDate, headline: 'h', overview: null, stats, createdAt: `${digestDate}T00:00:00.000Z` })
        .returning({ id: digests.id })
        .get().id
    if (itemIds.length === 0) return
    database
        .insert(digestEntries)
        .values(itemIds.map((itemId, itemIndex) => ({ digestId, itemId, rank: itemIndex + 1, section: 'top' as const })))
        .run()
}

// 수집 기록 한 건 (넘긴 값만 바꿈)
const fetchInput = (fetchOverrides: Partial<SourceFetchInput> = {}): SourceFetchInput => ({
    sourceId: 'hn',
    at: '2026-10-07T00:00:00.000Z',
    reason: 'briefing',
    ok: true,
    fetched: 30,
    newItems: 2,
    error: null,
    ...fetchOverrides
})

// 로컬 시간 기준 날짜 글자 ('YYYY-MM-DD')
const localDateKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

describe('source-fetch-repository', () => {
    it('기록이 없으면 집계는 모두 빈 목록이다', () => {
        const sourceFetchRepository = createSourceFetchRepository(openTestDatabase())
        expect(sourceFetchRepository.listRecentFetchesPerSource(10)).toEqual([])
        expect(sourceFetchRepository.countFailuresBySource(null)).toEqual([])
        expect(sourceFetchRepository.listFunnelCountsBySource(null)).toEqual([])
        expect(sourceFetchRepository.listRecentPublishedPerSource(5)).toEqual([])
        expect(sourceFetchRepository.listCollectedCountsByDay('2026-10-01')).toEqual([])
        expect(sourceFetchRepository.listPublishedCountsByDay('2026-10-01')).toEqual([])
    })

    it('수집 기록을 저장하고 화면용 모양으로 돌려준다 (성공 여부는 불리언)', () => {
        const database = openTestDatabase()
        const sourceFetchRepository = createSourceFetchRepository(database)
        sourceFetchRepository.insertSourceFetch(fetchInput())
        sourceFetchRepository.insertSourceFetch(
            fetchInput({ sourceId: 'gn', reason: 'collect', ok: false, fetched: 0, newItems: 0, error: 'HTTP 403' })
        )

        expect(sourceFetchRepository.listRecentFetchesPerSource(10)).toEqual([
            {
                sourceId: 'gn',
                fetchedAt: '2026-10-07T00:00:00.000Z',
                reason: 'collect',
                ok: false,
                fetchedCount: 0,
                newItems: 0,
                error: 'HTTP 403'
            },
            {
                sourceId: 'hn',
                fetchedAt: '2026-10-07T00:00:00.000Z',
                reason: 'briefing',
                ok: true,
                fetchedCount: 30,
                newItems: 2,
                error: null
            }
        ])
    })

    it('최근 수집 기록: 출처마다 상한까지만, 출처 ID순 · 같은 출처는 최근 것부터', () => {
        const database = openTestDatabase()
        const sourceFetchRepository = createSourceFetchRepository(database)
        for (const day of ['01', '03', '02', '04'])
            sourceFetchRepository.insertSourceFetch(fetchInput({ at: `2026-10-${day}T00:00:00.000Z` }))
        sourceFetchRepository.insertSourceFetch(fetchInput({ sourceId: 'gn', at: '2026-10-05T00:00:00.000Z' }))

        expect(
            sourceFetchRepository.listRecentFetchesPerSource(3).map((fetchRecord) => [fetchRecord.sourceId, fetchRecord.fetchedAt])
        ).toEqual([
            ['gn', '2026-10-05T00:00:00.000Z'],
            ['hn', '2026-10-04T00:00:00.000Z'],
            ['hn', '2026-10-03T00:00:00.000Z'],
            ['hn', '2026-10-02T00:00:00.000Z']
        ])
    })

    it('오래된 수집 기록 삭제: 기준 시각보다 이른 것만 지우고 지운 개수를 돌려준다', () => {
        const database = openTestDatabase()
        const sourceFetchRepository = createSourceFetchRepository(database)
        sourceFetchRepository.insertSourceFetch(fetchInput({ at: '2020-01-01T00:00:00.000Z' }))
        sourceFetchRepository.insertSourceFetch(fetchInput({ at: '2026-10-01T00:00:00.000Z' }))
        sourceFetchRepository.insertSourceFetch(fetchInput({ at: '2026-10-02T00:00:00.000Z' }))

        // 기준 시각과 같은 기록은 남음
        expect(sourceFetchRepository.deleteSourceFetchesBefore('2026-10-01T00:00:00.000Z')).toBe(1)
        expect(
            database
                .select()
                .from(sourceFetches)
                .all()
                .map((fetchRow) => fetchRow.at)
        ).toEqual(['2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z'])
        expect(sourceFetchRepository.deleteSourceFetchesBefore('2026-10-01T00:00:00.000Z')).toBe(0)
    })

    it('실패 횟수: 실패한 수집만 출처별로 세고, 기간을 주면 그 시각 이후만 센다', () => {
        const database = openTestDatabase()
        const sourceFetchRepository = createSourceFetchRepository(database)
        sourceFetchRepository.insertSourceFetch(
            fetchInput({ sourceId: 'gn', at: '2026-09-01T00:00:00.000Z', ok: false, error: 'HTTP 500' })
        )
        sourceFetchRepository.insertSourceFetch(
            fetchInput({ sourceId: 'gn', at: '2026-10-01T00:00:00.000Z', ok: false, error: 'HTTP 403' })
        )
        sourceFetchRepository.insertSourceFetch(fetchInput({ sourceId: 'gn', at: '2026-10-02T00:00:00.000Z' }))
        sourceFetchRepository.insertSourceFetch(fetchInput({ sourceId: 'hn', at: '2026-10-02T00:00:00.000Z' }))

        expect(sourceFetchRepository.countFailuresBySource(null)).toEqual([{ sourceId: 'gn', failureCount: 2 }])
        expect(sourceFetchRepository.countFailuresBySource('2026-10-01T00:00:00.000Z')).toEqual([{ sourceId: 'gn', failureCount: 1 }])
        expect(sourceFetchRepository.countFailuresBySource('2026-10-01T00:00:00.001Z')).toEqual([])
    })

    it('출처별 단계 개수: 수집 · 합쳐짐 · 선별 · 실림 · 저장을 세고, 기간을 주면 그 뒤에 수집한 글만 센다', () => {
        const database = openTestDatabase()
        const sourceFetchRepository = createSourceFetchRepository(database)
        const publishedItemId = insertItem(database, 'A one', { triagedAt: '2026-10-07T01:00:00.000Z' })
        insertItem(database, 'A two')
        insertItem(database, 'A old', { collectedAt: '2026-09-01T00:00:00.000Z', triagedAt: '2026-09-01T01:00:00.000Z' })
        insertItem(database, 'G one', { sourceId: 'gn', sourceName: 'GeekNews', mergedInto: publishedItemId })
        // 두 번 실린 기사도 한 번으로 셈
        insertDigestWithItems(database, '2026-10-07', [publishedItemId])
        insertDigestWithItems(database, '2026-10-08', [publishedItemId])
        database.insert(saves).values({ itemId: publishedItemId, savedAt: '2026-10-08T00:00:00.000Z' }).run()

        const bySourceId = (funnelRows: { sourceId: string }[]) =>
            Object.fromEntries(funnelRows.map((funnelRow) => [funnelRow.sourceId, funnelRow]))
        const periodCounts = bySourceId(sourceFetchRepository.listFunnelCountsBySource('2026-10-07T00:00:00.000Z'))
        expect(periodCounts['hn']).toEqual({ sourceId: 'hn', collected: 2, merged: 0, triaged: 1, published: 1, saved: 1 })
        expect(periodCounts['gn']).toEqual({ sourceId: 'gn', collected: 1, merged: 1, triaged: 0, published: 0, saved: 0 })

        const totalCounts = bySourceId(sourceFetchRepository.listFunnelCountsBySource(null))
        expect(totalCounts['hn']).toEqual({ sourceId: 'hn', collected: 3, merged: 0, triaged: 2, published: 1, saved: 1 })
        expect(sourceFetchRepository.listFunnelCountsBySource('2026-11-01T00:00:00.000Z')).toEqual([])
    })

    it('최근 실린 기사: 출처마다 상한까지만, 최근 날짜 · 순위 순, 한국어 제목이 없으면 원래 제목', () => {
        const database = openTestDatabase()
        const sourceFetchRepository = createSourceFetchRepository(database)
        const oldItemId = insertItem(database, 'A old')
        const firstItemId = insertItem(database, 'A first', { titleKo: '첫째' })
        const secondItemId = insertItem(database, 'A second')
        const otherSourceItemId = insertItem(database, 'G one', { sourceId: 'gn', sourceName: 'GeekNews' })
        insertItem(database, 'A unpublished')
        insertDigestWithItems(database, '2026-10-06', [oldItemId])
        insertDigestWithItems(database, '2026-10-08', [firstItemId, otherSourceItemId, secondItemId])

        expect(sourceFetchRepository.listRecentPublishedPerSource(2)).toEqual([
            { sourceId: 'gn', itemId: otherSourceItemId, titleKo: 'G one', digestDate: '2026-10-08' },
            { sourceId: 'hn', itemId: firstItemId, titleKo: '첫째', digestDate: '2026-10-08' },
            { sourceId: 'hn', itemId: secondItemId, titleKo: 'A second', digestDate: '2026-10-08' }
        ])
        expect(sourceFetchRepository.listRecentPublishedPerSource(5).map((publishedItem) => publishedItem.itemId)).toEqual([
            otherSourceItemId,
            firstItemId,
            secondItemId,
            oldItemId
        ])
    })

    it('날짜별 수집한 글 수: 수집 시각을 로컬 날짜로 바꿔 세고, 시작 날짜보다 이른 날은 뺀다', () => {
        const database = openTestDatabase()
        const sourceFetchRepository = createSourceFetchRepository(database)
        // 로컬 시간의 정오로 수집 시각을 만들어 시간대와 무관하게 그 로컬 날짜에 들어가게 함
        const todayNoon = new Date()
        todayNoon.setHours(12, 0, 0, 0)
        const yesterdayNoon = new Date(todayNoon)
        yesterdayNoon.setDate(todayNoon.getDate() - 1)
        insertItem(database, 'today one', { collectedAt: todayNoon.toISOString() })
        insertItem(database, 'today two', { collectedAt: todayNoon.toISOString() })
        insertItem(database, 'yesterday one', { collectedAt: yesterdayNoon.toISOString() })

        const byDate = (dayCounts: { date: string; count: number }[]) =>
            Object.fromEntries(dayCounts.map((dayCount) => [dayCount.date, dayCount.count]))
        expect(byDate(sourceFetchRepository.listCollectedCountsByDay(localDateKey(yesterdayNoon)))).toEqual({
            [localDateKey(todayNoon)]: 2,
            [localDateKey(yesterdayNoon)]: 1
        })
        expect(byDate(sourceFetchRepository.listCollectedCountsByDay(localDateKey(todayNoon)))).toEqual({ [localDateKey(todayNoon)]: 2 })
    })

    it('날짜별 실린 글 수: 브리핑 날짜별로 세고, 시작 날짜는 넣는다', () => {
        const database = openTestDatabase()
        const sourceFetchRepository = createSourceFetchRepository(database)
        const firstItemId = insertItem(database, 'first')
        const secondItemId = insertItem(database, 'second')
        insertDigestWithItems(database, '2026-10-06', [firstItemId])
        insertDigestWithItems(database, '2026-10-07', [firstItemId, secondItemId])
        insertDigestWithItems(database, '2026-10-08', [])

        const sortedByDate = (dayCounts: { date: string; count: number }[]) =>
            [...dayCounts].sort((leftDay, rightDay) => leftDay.date.localeCompare(rightDay.date))
        expect(sortedByDate(sourceFetchRepository.listPublishedCountsByDay('2026-10-06'))).toEqual([
            { date: '2026-10-06', count: 1 },
            { date: '2026-10-07', count: 2 }
        ])
        expect(sourceFetchRepository.listPublishedCountsByDay('2026-10-07')).toEqual([{ date: '2026-10-07', count: 2 }])
    })
})
