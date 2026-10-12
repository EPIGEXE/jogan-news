// ============================================================================
// 브리핑 저장소 테스트
//
// [역할]
// - 메모리 DB에 실제 쿼리를 돌려 브리핑 저장소의 조회 · 쓰기 확인
// - 화면용 브리핑: 순위 순서, 읽음 · 저장 · 메모 · 태그 · 후속 소식, 요약 전 기사의 대체 값
// - 브리핑 목록의 개수, 날짜 구간 조회의 시작 · 끝, 게시에 쓰는 쓰기 조각
// ============================================================================
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DigestStats } from '@shared/types'
import type { AppDatabase } from '../client'
import { digestEntries, digests, items, itemTags, notes, reads, saves, tags } from '../schema'
import { openTestDatabase } from '../testing'
import { createDigestRepository, type DigestEntryInput } from './digest-repository'

const stats: DigestStats = { sources: 1, collected: 1, candidates: 1, selected: 1, costUsd: 0, failedSources: [], saveMode: false }

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

// 순위 1의 톱 기사 하나
const topEntry = (itemId: number, rank = 1): DigestEntryInput => ({ itemId, rank, section: 'top', whyItMatters: null })

describe('digest-repository', () => {
    it('브리핑이 없으면 조회는 모두 null · 빈 목록을 돌려준다', () => {
        const digestRepository = createDigestRepository(openTestDatabase())
        expect(digestRepository.findLatestDigest()).toBeNull()
        expect(digestRepository.findLatestDigestDate()).toBeNull()
        expect(digestRepository.findDigestByDate('2026-10-07')).toBeNull()
        expect(digestRepository.findDigestIdByDate('2026-10-07')).toBeNull()
        expect(digestRepository.listDigestSummaries()).toEqual([])
    })

    it('새 호를 만들고 실린 기사를 순위 순으로 돌려준다', () => {
        const database = openTestDatabase()
        const digestRepository = createDigestRepository(database)
        const firstItemId = insertItem(database, 'first')
        const secondItemId = insertItem(database, 'second')

        const digestId = digestRepository.insertDigest('2026-10-07', { headline: '한 줄', overview: '흐름', stats })
        digestRepository.insertEntries(digestId, [
            { itemId: secondItemId, rank: 2, section: 'tools', whyItMatters: '브리핑의 이유' },
            topEntry(firstItemId)
        ])

        const digest = digestRepository.findLatestDigest()!
        expect(digest).toMatchObject({ id: digestId, date: '2026-10-07', headline: '한 줄', overview: '흐름', stats })
        expect(digest.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        expect(digest.entries.map((entry) => [entry.itemId, entry.rank, entry.section])).toEqual([
            [firstItemId, 1, 'top'],
            [secondItemId, 2, 'tools']
        ])
        expect(digestRepository.findDigestIdByDate('2026-10-07')).toBe(digestId)
    })

    it('요약 전 기사는 분류 other · 원래 제목 · 소개 글 앞 300자로 채우고, 요약한 기사는 요약 값을 쓴다', () => {
        const database = openTestDatabase()
        const digestRepository = createDigestRepository(database)
        const rawItemId = insertItem(database, 'raw', { snippet: 'a'.repeat(400), engagementLabel: 'HN 100점' })
        const summarizedItemId = insertItem(database, 'summarized', {
            triageCategory: 'tools',
            titleKo: '요약된 제목',
            summaryKo: '요약',
            keyPoints: ['요점 하나'],
            whyKo: '기사 요약의 이유',
            otherSources: [{ sourceName: 'GeekNews', url: 'https://g.com/1', engagementLabel: null }],
            publishedAt: '2026-10-06T10:00:00.000Z'
        })
        const digestId = digestRepository.insertDigest('2026-10-07', { headline: 'h', overview: null, stats })
        digestRepository.insertEntries(digestId, [topEntry(rawItemId), topEntry(summarizedItemId, 2)])

        const [rawEntry, summarizedEntry] = digestRepository.findDigestByDate('2026-10-07')!.entries
        expect(rawEntry).toEqual({
            itemId: rawItemId,
            rank: 1,
            section: 'top',
            category: 'other',
            titleKo: 'raw',
            originalTitle: 'raw',
            summaryKo: 'a'.repeat(300),
            keyPoints: [],
            whyItMatters: null,
            url: 'https://example.com/raw',
            sourceName: 'Hacker News',
            engagementLabel: 'HN 100점',
            otherSources: [],
            publishedAt: null,
            isRead: false,
            isSaved: false,
            memo: '',
            tags: [],
            followUpOf: null
        })
        expect(summarizedEntry).toMatchObject({
            category: 'tools',
            titleKo: '요약된 제목',
            originalTitle: 'summarized',
            summaryKo: '요약',
            keyPoints: ['요점 하나'],
            whyItMatters: '기사 요약의 이유', // 브리핑에 따로 적은 것이 없으면 기사 요약의 것
            otherSources: [{ sourceName: 'GeekNews', url: 'https://g.com/1', engagementLabel: null }],
            publishedAt: '2026-10-06T10:00:00.000Z'
        })
    })

    it('브리핑에 따로 적은 "왜 중요한가"가 있으면 기사 요약의 것보다 먼저 쓴다', () => {
        const database = openTestDatabase()
        const digestRepository = createDigestRepository(database)
        const itemId = insertItem(database, 'story', { whyKo: '기사 요약의 이유' })
        const digestId = digestRepository.insertDigest('2026-10-07', { headline: 'h', overview: null, stats })
        digestRepository.insertEntries(digestId, [{ itemId, rank: 1, section: 'top', whyItMatters: '브리핑의 이유' }])
        expect(digestRepository.findLatestDigest()!.entries[0]!.whyItMatters).toBe('브리핑의 이유')
    })

    it('읽음 · 저장 · 메모 · 태그(이름순)를 실린 기사에 붙이고, 다른 기사의 것은 섞이지 않는다', () => {
        const database = openTestDatabase()
        const digestRepository = createDigestRepository(database)
        const markedItemId = insertItem(database, 'marked')
        const plainItemId = insertItem(database, 'plain')
        const unpublishedItemId = insertItem(database, 'unpublished')
        const digestId = digestRepository.insertDigest('2026-10-07', { headline: 'h', overview: null, stats })
        digestRepository.insertEntries(digestId, [topEntry(markedItemId), topEntry(plainItemId, 2)])

        database.insert(reads).values({ itemId: markedItemId, readAt: '2026-10-07T01:00:00.000Z' }).run()
        database.insert(saves).values({ itemId: markedItemId, savedAt: '2026-10-07T02:00:00.000Z' }).run()
        database.insert(notes).values({ itemId: markedItemId, body: '비용 계산해 볼 것', updatedAt: '2026-10-07T03:00:00.000Z' }).run()
        database
            .insert(tags)
            .values([
                { id: 1, name: 'mcp' },
                { id: 2, name: 'agent' },
                { id: 3, name: 'unrelated' }
            ])
            .run()
        database
            .insert(itemTags)
            .values([
                { itemId: markedItemId, tagId: 1, source: 'user' },
                { itemId: markedItemId, tagId: 2, source: 'auto' },
                { itemId: unpublishedItemId, tagId: 3, source: 'user' }
            ])
            .run()

        const [markedEntry, plainEntry] = digestRepository.findLatestDigest()!.entries
        expect(markedEntry).toMatchObject({ isRead: true, isSaved: true, memo: '비용 계산해 볼 것', tags: ['agent', 'mcp'] })
        expect(plainEntry).toMatchObject({ isRead: false, isSaved: false, memo: '', tags: [] })
    })

    it('후속 소식이면 지난 기사의 제목과 가장 최근에 실린 날짜를 붙인다 (실린 적이 없으면 날짜는 null)', () => {
        const database = openTestDatabase()
        const digestRepository = createDigestRepository(database)
        const publishedTwiceItemId = insertItem(database, 'This week news', { titleKo: '이번 주 소식' })
        const neverPublishedItemId = insertItem(database, 'Never published')
        const followUpItemId = insertItem(database, 'Follow up', { followUpOf: publishedTwiceItemId })
        const orphanFollowUpItemId = insertItem(database, 'Orphan follow up', { followUpOf: neverPublishedItemId })

        digestRepository.insertEntries(digestRepository.insertDigest('2026-10-03', { headline: 'h', overview: null, stats }), [
            topEntry(publishedTwiceItemId)
        ])
        digestRepository.insertEntries(digestRepository.insertDigest('2026-10-05', { headline: 'h', overview: null, stats }), [
            topEntry(publishedTwiceItemId)
        ])
        digestRepository.insertEntries(digestRepository.insertDigest('2026-10-08', { headline: 'h', overview: null, stats }), [
            topEntry(followUpItemId),
            topEntry(orphanFollowUpItemId, 2)
        ])

        const [followUpEntry, orphanEntry] = digestRepository.findLatestDigest()!.entries
        expect(followUpEntry!.followUpOf).toEqual({ itemId: publishedTwiceItemId, titleKo: '이번 주 소식', digestDate: '2026-10-05' })
        expect(orphanEntry!.followUpOf).toEqual({ itemId: neverPublishedItemId, titleKo: 'Never published', digestDate: null })
    })

    it('가장 최근 브리핑은 만든 순서가 아니라 날짜가 가장 늦은 호다', () => {
        const database = openTestDatabase()
        const digestRepository = createDigestRepository(database)
        digestRepository.insertDigest('2026-10-07', { headline: '오늘', overview: null, stats })
        digestRepository.insertDigest('2026-10-06', { headline: '어제', overview: null, stats })
        expect(digestRepository.findLatestDigestDate()).toBe('2026-10-07')
        expect(digestRepository.findLatestDigest()!.headline).toBe('오늘')
        expect(digestRepository.findDigestByDate('2026-10-06')!.headline).toBe('어제')
        expect(digestRepository.findLatestDigest()!.entries).toEqual([])
    })

    it('브리핑 목록은 최근 날짜부터, 실린 기사 수와 그중 저장한 기사 수를 센다', () => {
        const database = openTestDatabase()
        const digestRepository = createDigestRepository(database)
        const savedItemId = insertItem(database, 'saved')
        const otherItemId = insertItem(database, 'other')
        const yesterdayDigestId = digestRepository.insertDigest('2026-10-06', { headline: '어제', overview: null, stats })
        const todayDigestId = digestRepository.insertDigest('2026-10-07', { headline: '오늘', overview: null, stats })
        const emptyDigestId = digestRepository.insertDigest('2026-10-05', { headline: '빈 호', overview: null, stats })
        digestRepository.insertEntries(yesterdayDigestId, [topEntry(savedItemId), topEntry(otherItemId, 2)])
        digestRepository.insertEntries(todayDigestId, [topEntry(otherItemId)])
        database.insert(saves).values({ itemId: savedItemId, savedAt: '2026-10-07T02:00:00.000Z' }).run()

        expect(digestRepository.listDigestSummaries()).toEqual([
            { id: todayDigestId, date: '2026-10-07', headline: '오늘', entryCount: 1, savedCount: 0 },
            { id: yesterdayDigestId, date: '2026-10-06', headline: '어제', entryCount: 2, savedCount: 1 },
            { id: emptyDigestId, date: '2026-10-05', headline: '빈 호', entryCount: 0, savedCount: 0 }
        ])
    })

    it('날짜 구간 조회: 시작 날짜는 넣고 끝 날짜는 빼며, 최근 날짜 · 순위 순으로 돌려준다', () => {
        const database = openTestDatabase()
        const digestRepository = createDigestRepository(database)
        const oldItemId = insertItem(database, 'Old news')
        const boundaryItemId = insertItem(database, 'Boundary news')
        const weekFirstItemId = insertItem(database, 'This week news', { titleKo: '이번 주 소식' })
        const weekSecondItemId = insertItem(database, 'This week second')
        const todayItemId = insertItem(database, 'Today news')
        const publish = (digestDate: string, entries: DigestEntryInput[]) =>
            digestRepository.insertEntries(digestRepository.insertDigest(digestDate, { headline: 'h', overview: null, stats }), entries)
        publish('2026-09-30', [topEntry(oldItemId)])
        publish('2026-10-01', [topEntry(boundaryItemId)])
        publish('2026-10-05', [topEntry(weekSecondItemId, 2), topEntry(weekFirstItemId, 1)])
        publish('2026-10-08', [topEntry(todayItemId)])

        expect(digestRepository.listPublishedItemsBetween('2026-10-01', '2026-10-08')).toEqual([
            { itemId: weekFirstItemId, digestDate: '2026-10-05', title: '이번 주 소식' },
            { itemId: weekSecondItemId, digestDate: '2026-10-05', title: 'This week second' },
            { itemId: boundaryItemId, digestDate: '2026-10-01', title: 'Boundary news' }
        ])
        expect(digestRepository.listPublishedItemsBetween('2026-10-09', '2026-10-10')).toEqual([])
    })

    it('같은 날짜를 다시 게시하는 조각: 실린 기사를 지우고 내용을 바꾸면 번호는 그대로, 만든 시각은 새로 바뀐다', () => {
        const database = openTestDatabase()
        const digestRepository = createDigestRepository(database)
        const firstItemId = insertItem(database, 'first')
        const secondItemId = insertItem(database, 'second')
        const digestId = digestRepository.insertDigest('2026-10-07', { headline: '1차', overview: '흐름', stats })
        digestRepository.insertEntries(digestId, [topEntry(firstItemId)])
        database.update(digests).set({ createdAt: '2020-01-01T00:00:00.000Z' }).where(eq(digests.id, digestId)).run()

        expect(digestRepository.deleteEntriesByDigestId(digestId)).toBe(1)
        digestRepository.updateDigestContent(digestId, { headline: '2차', overview: null, stats: { ...stats, selected: 2 } })
        digestRepository.insertEntries(digestId, [topEntry(secondItemId)])

        const digest = digestRepository.findLatestDigest()!
        expect(digest).toMatchObject({ id: digestId, headline: '2차', overview: null, stats: { selected: 2 } })
        expect(digest.createdAt > '2020-01-01T00:00:00.000Z').toBe(true)
        expect(digest.entries.map((entry) => entry.itemId)).toEqual([secondItemId])
        expect(digestRepository.deleteEntriesByDigestId(digestId + 100)).toBe(0)
    })

    it('호를 지우면 실린 기사도 함께 지워지고, 빈 목록을 넣어도 오류가 나지 않는다', () => {
        const database = openTestDatabase()
        const digestRepository = createDigestRepository(database)
        const itemId = insertItem(database, 'story')
        const digestId = digestRepository.insertDigest('2026-10-07', { headline: 'h', overview: null, stats })
        digestRepository.insertEntries(digestId, [])
        digestRepository.insertEntries(digestId, [topEntry(itemId)])

        digestRepository.deleteDigestById(digestId)
        expect(digestRepository.findDigestByDate('2026-10-07')).toBeNull()
        expect(database.select().from(digestEntries).all()).toEqual([])
    })
})
