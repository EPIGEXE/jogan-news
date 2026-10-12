// ============================================================================
// 기사 저장소 테스트
//
// [역할]
// - 메모리 DB를 열어 기사 저장소의 쿼리를 실제로 돌려 확인
// - 글 찾기 · 넣기 · 고치기, 브리핑 후보의 제외 조건과 구간 경계, 본문 · 번역 저장
// - 화면용 기사 조회: 읽음 · 저장 · 메모 · 태그 · 실린 날짜 · 후속 소식 · 하이라이트가 붙는지
// - 다른 테이블의 행은 테스트 안에서 직접 넣음 (다른 저장소를 쓰지 않음)
// ============================================================================
import { describe, expect, it } from 'vitest'
import type { AppDatabase } from '../client'
import { digestEntries, digests, highlights, itemTags, notes, reads, saves, tags } from '../schema'
import { openTestDatabase } from '../testing'
import { createItemRepository, type NewItem } from './item-repository'

const digestStats = { sources: 1, collected: 1, candidates: 1, selected: 1, costUsd: 0, failedSources: [], saveMode: false }

// 넣을 글 만들기 (주소 · 제목은 테스트마다 다르게 넘김)
const newItem = (overrides: Partial<NewItem> = {}): NewItem => ({
    urlKey: 'mistral.ai/news/large-4',
    url: 'https://mistral.ai/news/large-4',
    sourceId: 'hn',
    sourceName: 'Hacker News',
    kind: 'community',
    title: 'Mistral Large 4 released',
    titleNorm: 'mistral large 4 released',
    snippet: '',
    lang: 'en',
    publishedAt: '2026-10-07T00:00:00.000Z',
    engagement: 100,
    engagementLabel: 'HN 100점',
    ...overrides
})

// 브리핑 한 호를 만들고 기사를 순서대로 실음
function publishTestDigest(database: AppDatabase, digestDate: string, itemIds: number[]): void {
    const insertedDigest = database
        .insert(digests)
        .values({
            date: digestDate,
            headline: '오늘의 한 줄',
            overview: null,
            stats: digestStats,
            createdAt: `${digestDate}T00:00:00.000Z`
        })
        .returning({ digestId: digests.id })
        .get()
    for (const [entryIndex, itemId] of itemIds.entries()) {
        database
            .insert(digestEntries)
            .values({ digestId: insertedDigest.digestId, itemId, rank: entryIndex + 1, section: 'top', whyItMatters: null })
            .run()
    }
}

describe('item-repository: 글 찾기 · 넣기 · 고치기', () => {
    it('넣은 글을 번호와 정규화한 주소로 찾고, 없으면 null을 준다', () => {
        const itemRepository = createItemRepository(openTestDatabase())
        const itemId = itemRepository.insertItem(newItem({ collectedAt: '2026-10-07T01:00:00.000Z' }))

        const itemRow = itemRepository.findItemById(itemId)
        expect(itemRow).toMatchObject({
            id: itemId,
            urlKey: 'mistral.ai/news/large-4',
            collectedAt: '2026-10-07T01:00:00.000Z',
            otherSources: [],
            engagement: 100,
            triageCategory: null,
            keyPoints: null,
            mergedInto: null,
            followUpOf: null
        })
        expect(itemRepository.findItemByUrlKey('mistral.ai/news/large-4')?.id).toBe(itemId)
        expect(itemRepository.findItemById(itemId + 1)).toBeNull()
        expect(itemRepository.findItemByUrlKey('없는-주소')).toBeNull()
    })

    it('수집한 시각을 넘기지 않으면 지금 시각으로 채운다', () => {
        const itemRepository = createItemRepository(openTestDatabase())
        const beforeInsertIso = new Date().toISOString()
        const itemId = itemRepository.insertItem(newItem())
        expect(itemRepository.findItemById(itemId)!.collectedAt >= beforeInsertIso).toBe(true)
    })

    it('같은 정규화한 주소는 두 번 넣을 수 없다', () => {
        const itemRepository = createItemRepository(openTestDatabase())
        itemRepository.insertItem(newItem())
        expect(() => itemRepository.insertItem(newItem())).toThrow()
    })

    it('제목이 같은 글은 구간 시작 시각 이후(그 시각 포함)에 수집한 것만 찾는다', () => {
        const itemRepository = createItemRepository(openTestDatabase())
        const itemId = itemRepository.insertItem(newItem({ collectedAt: '2026-10-05T00:00:00.000Z' }))

        expect(itemRepository.findRecentItemByNormalizedTitle('mistral large 4 released', '2026-10-05T00:00:00.000Z')?.id).toBe(itemId)
        expect(itemRepository.findRecentItemByNormalizedTitle('mistral large 4 released', '2026-10-05T00:00:00.001Z')).toBeNull()
        expect(itemRepository.findRecentItemByNormalizedTitle('다른 제목', '2026-10-01T00:00:00.000Z')).toBeNull()
    })

    it('번호 여러 개로 행을 한 번에 읽고, 없는 번호는 빠진다', () => {
        const itemRepository = createItemRepository(openTestDatabase())
        const firstItemId = itemRepository.insertItem(newItem())
        const secondItemId = itemRepository.insertItem(newItem({ urlKey: 'a.com/2', url: 'https://a.com/2' }))

        const foundItemIds = itemRepository.listItemsByIds([secondItemId, firstItemId, 9999]).map((itemRow) => itemRow.id)
        expect(foundItemIds.sort()).toEqual([firstItemId, secondItemId])
        expect(itemRepository.listItemsByIds([])).toEqual([])
    })

    it('참여도 · 소개 글 · 합친 출처를 고친다', () => {
        const itemRepository = createItemRepository(openTestDatabase())
        const itemId = itemRepository.insertItem(newItem())

        itemRepository.updateItemEngagement(itemId, 250, 'HN 250점')
        itemRepository.updateItemSnippet(itemId, '소개 글')
        expect(itemRepository.findItemById(itemId)).toMatchObject({ engagement: 250, engagementLabel: 'HN 250점', snippet: '소개 글' })

        // 소개 글을 넘기지 않으면 지금 값을 그대로 둠
        const geekNewsSource = { sourceName: 'GeekNews', url: 'https://news.hada.io/1', engagementLabel: null }
        itemRepository.updateItemMergedSources(itemId, { otherSources: [geekNewsSource], engagement: 300, engagementLabel: null })
        expect(itemRepository.findItemById(itemId)).toMatchObject({
            otherSources: [geekNewsSource],
            engagement: 300,
            engagementLabel: null,
            snippet: '소개 글'
        })

        // 소개 글을 넘기면 함께 교체
        itemRepository.updateItemMergedSources(itemId, {
            otherSources: [],
            engagement: 300,
            engagementLabel: null,
            snippet: '더 긴 소개 글'
        })
        expect(itemRepository.findItemById(itemId)).toMatchObject({ otherSources: [], snippet: '더 긴 소개 글' })
    })

    it('후속 소식 표시 · 선별 결과 · 요약 결과를 저장한다', () => {
        const itemRepository = createItemRepository(openTestDatabase())
        const previousItemId = itemRepository.insertItem(newItem())
        const itemId = itemRepository.insertItem(newItem({ urlKey: 'a.com/2', url: 'https://a.com/2' }))

        itemRepository.updateItemFollowUpOf(itemId, previousItemId)
        itemRepository.updateItemTriage(itemId, { category: 'tools', relevance: 0.9, importance: 4 }, '2026-10-07T02:00:00.000Z')
        itemRepository.updateItemSummary(
            itemId,
            { titleKo: '미스트랄 라지 4 공개', summaryKo: '요약', keyPoints: ['첫째', '둘째'], whyKo: '중요한 이유' },
            'summary-model',
            '2026-10-07T03:00:00.000Z'
        )

        expect(itemRepository.findItemById(itemId)).toMatchObject({
            followUpOf: previousItemId,
            triageCategory: 'tools',
            triageRelevance: 0.9,
            triageImportance: 4,
            triagedAt: '2026-10-07T02:00:00.000Z',
            titleKo: '미스트랄 라지 4 공개',
            summaryKo: '요약',
            keyPoints: ['첫째', '둘째'],
            whyKo: '중요한 이유',
            summaryModel: 'summary-model',
            summarizedAt: '2026-10-07T03:00:00.000Z'
        })
        // 다른 글은 바뀌지 않음
        expect(itemRepository.findItemById(previousItemId)).toMatchObject({ followUpOf: null, triageCategory: null, titleKo: null })
    })

    it('선별 · 요약 시각을 넘기지 않으면 지금 시각으로 채운다', () => {
        const itemRepository = createItemRepository(openTestDatabase())
        const itemId = itemRepository.insertItem(newItem())
        itemRepository.updateItemTriage(itemId, { category: 'other', relevance: 0.1, importance: 1 })
        itemRepository.updateItemSummary(itemId, { titleKo: '제목', summaryKo: '요약', keyPoints: [], whyKo: '' }, 'summary-model')
        const itemRow = itemRepository.findItemById(itemId)!
        expect(itemRow.triagedAt).not.toBeNull()
        expect(itemRow.summarizedAt).not.toBeNull()
    })
})

describe('item-repository: 브리핑 후보', () => {
    it('합쳐진 글은 후보에서 빠진다', () => {
        const itemRepository = createItemRepository(openTestDatabase())
        const representativeItemId = itemRepository.insertItem(newItem())
        const memberItemId = itemRepository.insertItem(newItem({ urlKey: 'techcrunch.com/mistral', url: 'https://techcrunch.com/mistral' }))

        expect(itemRepository.updateItemsMergedInto([memberItemId], representativeItemId)).toBe(1)
        expect(itemRepository.updateItemsMergedInto([], representativeItemId)).toBe(0)

        expect(itemRepository.findItemById(memberItemId)!.mergedInto).toBe(representativeItemId)
        const candidateItemIds = itemRepository.listBriefingCandidates(new Date(0).toISOString(), '2026-10-07').map((itemRow) => itemRow.id)
        expect(candidateItemIds).toEqual([representativeItemId])
    })

    it('수집 구간 시작 시각 이후(그 시각 포함)에 수집한 글만 후보다', () => {
        const itemRepository = createItemRepository(openTestDatabase())
        itemRepository.insertItem(newItem({ urlKey: 'a.com/old', collectedAt: '2026-10-06T23:59:59.999Z' }))
        const boundaryItemId = itemRepository.insertItem(newItem({ urlKey: 'a.com/boundary', collectedAt: '2026-10-07T00:00:00.000Z' }))
        const laterItemId = itemRepository.insertItem(newItem({ urlKey: 'a.com/later', collectedAt: '2026-10-07T05:00:00.000Z' }))

        const candidateItemIds = itemRepository
            .listBriefingCandidates('2026-10-07T00:00:00.000Z', '2026-10-07')
            .map((itemRow) => itemRow.id)
        expect(candidateItemIds.sort()).toEqual([boundaryItemId, laterItemId])
    })

    it('다른 날 브리핑에 실린 글은 빠지고, 오늘 브리핑에만 실린 글은 남는다', () => {
        const database = openTestDatabase()
        const itemRepository = createItemRepository(database)
        const yesterdayItemId = itemRepository.insertItem(newItem({ urlKey: 'a.com/1' }))
        const todayItemId = itemRepository.insertItem(newItem({ urlKey: 'a.com/2' }))
        const bothDaysItemId = itemRepository.insertItem(newItem({ urlKey: 'a.com/3' }))
        const unpublishedItemId = itemRepository.insertItem(newItem({ urlKey: 'a.com/4' }))
        publishTestDigest(database, '2026-10-06', [yesterdayItemId, bothDaysItemId])
        publishTestDigest(database, '2026-10-07', [todayItemId, bothDaysItemId])

        const candidateItemIds = itemRepository.listBriefingCandidates(new Date(0).toISOString(), '2026-10-07').map((itemRow) => itemRow.id)
        expect(candidateItemIds.sort()).toEqual([todayItemId, unpublishedItemId])
    })
})

describe('item-repository: 본문 · 번역', () => {
    it('보관된 본문이 없으면 null을 준다', () => {
        const itemRepository = createItemRepository(openTestDatabase())
        const itemId = itemRepository.insertItem(newItem())
        expect(itemRepository.findContentByItemId(itemId)).toBeNull()
    })

    it('본문과 번역을 저장하고, 본문을 다시 저장하면 번역이 지워진다', () => {
        const itemRepository = createItemRepository(openTestDatabase())
        const itemId = itemRepository.insertItem(newItem())

        itemRepository.upsertContent(itemId, ['First paragraph.', 'Second paragraph.'], true, '2026-10-07T01:00:00.000Z')
        expect(itemRepository.findContentByItemId(itemId)).toEqual({
            itemId,
            paragraphs: ['First paragraph.', 'Second paragraph.'],
            fullText: true,
            extractedAt: '2026-10-07T01:00:00.000Z',
            paragraphsKo: null,
            translatedAt: null,
            translateModel: null
        })

        expect(
            itemRepository.updateContentTranslation(itemId, ['첫째 문단 번역', null], 'translate-model', '2026-10-07T02:00:00.000Z')
        ).toBe(1)
        expect(itemRepository.findContentByItemId(itemId)).toMatchObject({
            paragraphsKo: ['첫째 문단 번역', null],
            translatedAt: '2026-10-07T02:00:00.000Z',
            translateModel: 'translate-model'
        })

        // 본문을 다시 추출하면 번역 · 번역 시각 · 번역 모델이 비워짐
        itemRepository.upsertContent(itemId, ['New body.'], false, '2026-10-07T03:00:00.000Z')
        expect(itemRepository.findContentByItemId(itemId)).toEqual({
            itemId,
            paragraphs: ['New body.'],
            fullText: false,
            extractedAt: '2026-10-07T03:00:00.000Z',
            paragraphsKo: null,
            translatedAt: null,
            translateModel: null
        })
    })

    it('보관된 본문이 없는 기사에 번역을 저장하면 아무것도 바뀌지 않는다', () => {
        const itemRepository = createItemRepository(openTestDatabase())
        const itemId = itemRepository.insertItem(newItem())
        expect(itemRepository.updateContentTranslation(itemId, ['번역'], 'translate-model')).toBe(0)
        expect(itemRepository.findContentByItemId(itemId)).toBeNull()
    })
})

describe('item-repository: 화면용 기사 조회', () => {
    it('없는 기사의 상세는 null이다', () => {
        const itemRepository = createItemRepository(openTestDatabase())
        expect(itemRepository.findItemDetail(1)).toBeNull()
    })

    it('선별 · 요약 전인 기사는 분류 other, 원래 제목, 소개 글 앞 300자로 채운다', () => {
        const itemRepository = createItemRepository(openTestDatabase())
        const longSnippet = '가'.repeat(400)
        const itemId = itemRepository.insertItem(newItem({ snippet: longSnippet }))

        const itemDetailRecord = itemRepository.findItemDetail(itemId)!
        expect(itemDetailRecord.itemRow.id).toBe(itemId)
        expect(itemDetailRecord.itemDetail).toEqual({
            itemId,
            category: 'other',
            titleKo: 'Mistral Large 4 released',
            originalTitle: 'Mistral Large 4 released',
            summaryKo: '가'.repeat(300),
            keyPoints: [],
            url: 'https://mistral.ai/news/large-4',
            sourceName: 'Hacker News',
            engagementLabel: 'HN 100점',
            otherSources: [],
            publishedAt: '2026-10-07T00:00:00.000Z',
            isRead: false,
            isSaved: false,
            memo: '',
            tags: [],
            followUpOf: null,
            whyItMatters: null,
            savedAt: null,
            digestDate: null,
            paragraphs: [longSnippet],
            hasFullText: false,
            paragraphsKo: null,
            highlights: []
        })
    })

    it('본문이 없으면 소개 글을 문단 하나로, 소개 글도 없으면 빈 배열로, 본문이 있으면 그 문단을 준다', () => {
        const itemRepository = createItemRepository(openTestDatabase())
        const itemId = itemRepository.insertItem(newItem({ snippet: '요약만 있음' }))
        const emptyItemId = itemRepository.insertItem(newItem({ urlKey: 'a.com/2', snippet: '' }))

        expect(itemRepository.findItemDetail(itemId)!.itemDetail).toMatchObject({ paragraphs: ['요약만 있음'], hasFullText: false })
        expect(itemRepository.findItemDetail(emptyItemId)!.itemDetail.paragraphs).toEqual([])

        itemRepository.upsertContent(itemId, ['첫 문단', '둘째 문단'], true)
        itemRepository.updateContentTranslation(itemId, ['번역 문단', null], 'translate-model')
        expect(itemRepository.findItemDetail(itemId)!.itemDetail).toMatchObject({
            paragraphs: ['첫 문단', '둘째 문단'],
            hasFullText: true,
            paragraphsKo: ['번역 문단', null]
        })
    })

    it('요약 · 읽음 · 저장 · 메모 · 태그(이름순) · 하이라이트(문단 · 시작 위치 순)를 붙인다', () => {
        const database = openTestDatabase()
        const itemRepository = createItemRepository(database)
        const itemId = itemRepository.insertItem(newItem())
        const otherItemId = itemRepository.insertItem(newItem({ urlKey: 'a.com/2' }))
        itemRepository.updateItemTriage(itemId, { category: 'model_release', relevance: 0.9, importance: 5 })
        itemRepository.updateItemSummary(
            itemId,
            { titleKo: '한국어 제목', summaryKo: '한국어 요약', keyPoints: ['요점'], whyKo: '왜 중요한가' },
            'm'
        )

        database.insert(reads).values({ itemId, readAt: '2026-10-07T04:00:00.000Z' }).run()
        database.insert(saves).values({ itemId, savedAt: '2026-10-07T05:00:00.000Z' }).run()
        database.insert(notes).values({ itemId, body: '비용 계산해 볼 것', updatedAt: '2026-10-07T05:00:00.000Z' }).run()
        const insertedTags = database
            .insert(tags)
            .values([{ name: 'open-weight' }, { name: 'agent' }, { name: 'mcp' }])
            .returning({ tagId: tags.id })
            .all()
        database
            .insert(itemTags)
            .values([
                { itemId, tagId: insertedTags[0]!.tagId, source: 'user' },
                { itemId, tagId: insertedTags[1]!.tagId, source: 'auto' },
                { itemId: otherItemId, tagId: insertedTags[2]!.tagId, source: 'user' }
            ])
            .run()
        const highlightBase = { itemId, variant: 'original' as const, text: '그은 글자', note: '', createdAt: '2026-10-07T06:00:00.000Z' }
        database
            .insert(highlights)
            .values([
                { ...highlightBase, paragraph: 2, startOffset: 0, endOffset: 4 },
                { ...highlightBase, paragraph: 1, startOffset: 10, endOffset: 14, note: '하이라이트 메모' },
                { ...highlightBase, paragraph: 1, startOffset: 2, endOffset: 6, variant: 'ko' },
                { ...highlightBase, itemId: otherItemId, paragraph: 1, startOffset: 0, endOffset: 3 }
            ])
            .run()

        const { itemDetail } = itemRepository.findItemDetail(itemId)!
        expect(itemDetail).toMatchObject({
            category: 'model_release',
            titleKo: '한국어 제목',
            originalTitle: 'Mistral Large 4 released',
            summaryKo: '한국어 요약',
            keyPoints: ['요점'],
            whyItMatters: '왜 중요한가',
            isRead: true,
            isSaved: true,
            savedAt: '2026-10-07T05:00:00.000Z',
            memo: '비용 계산해 볼 것',
            tags: ['agent', 'open-weight']
        })
        expect(itemDetail.highlights.map((highlight) => [highlight.paragraph, highlight.start, highlight.end, highlight.variant])).toEqual([
            [1, 2, 6, 'ko'],
            [1, 10, 14, 'original'],
            [2, 0, 4, 'original']
        ])
        expect(itemDetail.highlights[1]).toMatchObject({
            text: '그은 글자',
            note: '하이라이트 메모',
            createdAt: '2026-10-07T06:00:00.000Z'
        })

        // 다른 기사의 읽음 · 태그 · 하이라이트가 섞이지 않음
        expect(itemRepository.findItemDetail(otherItemId)!.itemDetail).toMatchObject({
            isRead: false,
            isSaved: false,
            memo: '',
            tags: ['mcp']
        })
        expect(itemRepository.findItemDetail(otherItemId)!.itemDetail.highlights).toHaveLength(1)
    })

    it('실린 브리핑 날짜는 가장 최근 것이고, 후속 소식이면 지난 기사의 제목과 실린 날짜를 붙인다', () => {
        const database = openTestDatabase()
        const itemRepository = createItemRepository(database)
        const previousItemId = itemRepository.insertItem(newItem({ urlKey: 'a.com/1', title: 'This week news' }))
        const unpublishedPreviousItemId = itemRepository.insertItem(newItem({ urlKey: 'a.com/2', title: 'Never published' }))
        const followUpItemId = itemRepository.insertItem(newItem({ urlKey: 'a.com/3', title: 'Today news' }))
        const secondFollowUpItemId = itemRepository.insertItem(newItem({ urlKey: 'a.com/4', title: 'Another follow-up' }))
        itemRepository.updateItemSummary(previousItemId, { titleKo: '이번 주 소식', summaryKo: '', keyPoints: [], whyKo: '' }, 'm')
        itemRepository.updateItemFollowUpOf(followUpItemId, previousItemId)
        itemRepository.updateItemFollowUpOf(secondFollowUpItemId, unpublishedPreviousItemId)
        publishTestDigest(database, '2026-10-03', [previousItemId])
        publishTestDigest(database, '2026-10-05', [previousItemId])
        publishTestDigest(database, '2026-10-07', [followUpItemId])

        expect(itemRepository.findItemDetail(previousItemId)!.itemDetail).toMatchObject({ digestDate: '2026-10-05', followUpOf: null })
        expect(itemRepository.findItemDetail(followUpItemId)!.itemDetail).toMatchObject({
            digestDate: '2026-10-07',
            followUpOf: { itemId: previousItemId, titleKo: '이번 주 소식', digestDate: '2026-10-05' }
        })
        // 지난 기사에 한국어 제목이 없으면 원래 제목, 실린 적이 없으면 날짜는 null
        expect(itemRepository.findItemDetail(secondFollowUpItemId)!.itemDetail).toMatchObject({
            digestDate: null,
            followUpOf: { itemId: unpublishedPreviousItemId, titleKo: 'Never published', digestDate: null }
        })
    })

    it('여러 기사를 넘긴 번호 순서대로 주고, 없는 번호는 빠진다', () => {
        const database = openTestDatabase()
        const itemRepository = createItemRepository(database)
        const firstItemId = itemRepository.insertItem(newItem({ urlKey: 'a.com/1', title: 'First' }))
        const secondItemId = itemRepository.insertItem(newItem({ urlKey: 'a.com/2', title: 'Second' }))
        const thirdItemId = itemRepository.insertItem(newItem({ urlKey: 'a.com/3', title: 'Third' }))
        database.insert(saves).values({ itemId: secondItemId, savedAt: '2026-10-07T05:00:00.000Z' }).run()
        publishTestDigest(database, '2026-10-07', [thirdItemId, firstItemId])

        const itemViews = itemRepository.listItemViews([thirdItemId, 9999, firstItemId, secondItemId])
        expect(itemViews.map((itemView) => itemView.entryBase.itemId)).toEqual([thirdItemId, firstItemId, secondItemId])
        expect(itemViews.map((itemView) => itemView.itemRow.title)).toEqual(['Third', 'First', 'Second'])
        expect(itemViews.map((itemView) => itemView.savedAt)).toEqual([null, null, '2026-10-07T05:00:00.000Z'])
        expect(itemViews.map((itemView) => itemView.entryBase.isSaved)).toEqual([false, false, true])
        expect(itemViews.map((itemView) => itemView.digestDate)).toEqual(['2026-10-07', '2026-10-07', null])

        expect(itemRepository.listItemViews([])).toEqual([])
        expect(itemRepository.listItemViews([9999])).toEqual([])
    })
})
