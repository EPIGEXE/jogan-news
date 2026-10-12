// ============================================================================
// 검색 저장소 테스트
//
// [역할]
// - 메모리 DB에 기사 · 본문 · 메모 · 하이라이트 · 태그 · 브리핑을 직접 넣고 색인과 검색 결과 확인
// - 색인 행의 열별 내용, 검색어 규칙(3글자 이상 FTS · 2글자 LIKE · 한국어 · AND), 범위 · 메모 · 태그 조건, 정렬 · 최대 건수
// - 메모 · 하이라이트를 바꾼 뒤 색인을 다시 써야 검색에 반영되는지
// ============================================================================
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { AppDatabase } from '../client'
import { contents, digestEntries, digests, highlights, items, itemTags, notes, saves, tags } from '../schema'
import { openTestDatabase } from '../testing'
import { createSearchRepository } from './search-repository'

const DIGEST_STATS = { sources: 1, collected: 1, candidates: 1, selected: 1, costUsd: 0, failedSources: [], saveMode: false }

let itemSequence = 0 // 기사마다 다른 주소를 만들기 위한 순번

// 기사 한 건 넣기 → 기사 번호
function insertItem(database: AppDatabase, itemValues: Partial<typeof items.$inferInsert> = {}): number {
    itemSequence += 1
    const title = itemValues.title ?? `Untitled story ${itemSequence}`
    return database
        .insert(items)
        .values({
            urlKey: `example.com/${itemSequence}`,
            url: `https://example.com/${itemSequence}`,
            sourceId: 'hn',
            sourceName: 'Hacker News',
            kind: 'community',
            title,
            titleNorm: title.toLowerCase(),
            collectedAt: '2026-10-07T00:00:00.000Z',
            ...itemValues
        })
        .returning({ itemId: items.id })
        .get().itemId
}

// 기사를 저장한 것으로 표시
function insertSave(database: AppDatabase, itemId: number, savedAt = '2026-10-07T09:00:00.000Z'): void {
    database.insert(saves).values({ itemId, savedAt }).run()
}

// 메모 넣기 (있으면 내용 바꿈)
function upsertNote(database: AppDatabase, itemId: number, body: string): void {
    database
        .insert(notes)
        .values({ itemId, body, updatedAt: '2026-10-07T09:00:00.000Z' })
        .onConflictDoUpdate({ target: notes.itemId, set: { body } })
        .run()
}

// 하이라이트 넣기 → 하이라이트 번호
function insertHighlight(database: AppDatabase, itemId: number, text: string, note = ''): number {
    return database
        .insert(highlights)
        .values({
            itemId,
            paragraph: 1,
            variant: 'original',
            startOffset: 0,
            endOffset: text.length,
            text,
            note,
            createdAt: '2026-10-07T09:00:00.000Z'
        })
        .returning({ highlightId: highlights.id })
        .get().highlightId
}

// 기사에 태그 붙이기
function insertTag(database: AppDatabase, itemId: number, tagName: string): void {
    const { tagId } = database.insert(tags).values({ name: tagName }).returning({ tagId: tags.id }).get()
    database.insert(itemTags).values({ itemId, tagId, source: 'user' }).run()
}

// 브리핑 한 호를 만들고 기사를 실음
function insertDigest(database: AppDatabase, digestDate: string, itemIds: number[]): void {
    const { digestId } = database
        .insert(digests)
        .values({ date: digestDate, headline: 'h', overview: null, stats: DIGEST_STATS, createdAt: `${digestDate}T00:00:00.000Z` })
        .returning({ digestId: digests.id })
        .get()
    database
        .insert(digestEntries)
        .values(itemIds.map((itemId, entryIndex) => ({ digestId, itemId, rank: entryIndex + 1, section: 'top' as const, whyItMatters: null })))
        .run()
}

// 기사 한 건의 색인 행 읽기 (없으면 undefined)
function readIndexRow(database: AppDatabase, itemId: number): { title: string; body: string; memo: string } | undefined {
    return database.get(sql`SELECT title, body, memo FROM search_fts WHERE rowid = ${itemId}`)
}

describe('search-repository', () => {
    it('색인: 제목 · 본문 · 메모 열에 옛 구현과 같은 내용을 이어 붙인다', () => {
        const database = openTestDatabase()
        const searchRepository = createSearchRepository(database)
        const itemId = insertItem(database, {
            title: 'Agent memory benchmark',
            titleKo: '에이전트 메모리 벤치마크',
            summaryKo: '새 모델 평가',
            keyPoints: ['첫째 포인트', '둘째 포인트'],
            snippet: 'short intro'
        })
        database
            .insert(contents)
            .values({
                itemId,
                paragraphs: ['First paragraph.', 'Second paragraph.'],
                fullText: true,
                extractedAt: '2026-10-07T00:00:00.000Z',
                paragraphsKo: ['첫째 문단 번역', null]
            })
            .run()
        upsertNote(database, itemId, '비용 계산해 볼 것')
        insertHighlight(database, itemId, 'First', '도구 호출 안정성')
        insertHighlight(database, itemId, 'Second')

        searchRepository.reindexItem(itemId)

        expect(readIndexRow(database, itemId)).toEqual({
            title: 'Agent memory benchmark 에이전트 메모리 벤치마크',
            body: '새 모델 평가 ["첫째 포인트","둘째 포인트"] short intro First paragraph. Second paragraph. 첫째 문단 번역',
            memo: '비용 계산해 볼 것 First 도구 호출 안정성 Second '
        })
    })

    it('색인: 요약 · 본문 · 메모가 없는 기사는 빈 자리를 공백으로만 채운다', () => {
        const database = openTestDatabase()
        const searchRepository = createSearchRepository(database)
        const itemId = insertItem(database, { title: 'Bare title' })

        searchRepository.reindexItem(itemId)

        expect(readIndexRow(database, itemId)).toEqual({ title: 'Bare title ', body: '    ', memo: ' ' })
    })

    it('색인: 다시 써도 행은 하나이고, 없는 기사 번호는 색인 행을 만들지 않는다', () => {
        const database = openTestDatabase()
        const searchRepository = createSearchRepository(database)
        const itemId = insertItem(database, { title: 'Reindexed twice' })

        searchRepository.reindexItem(itemId)
        searchRepository.reindexItem(itemId)
        searchRepository.reindexItem(itemId + 100)

        expect(database.get<{ rowCount: number }>(sql`SELECT count(*) AS rowCount FROM search_fts`)).toEqual({ rowCount: 1 })
    })

    it('검색: 3글자 이상은 전문 검색, 2글자는 LIKE로 찾고, 메모 내용도 찾는다', () => {
        const database = openTestDatabase()
        const searchRepository = createSearchRepository(database)
        const agentItemId = insertItem(database, {
            title: 'Agent memory benchmark',
            titleKo: '에이전트 메모리 벤치마크',
            summaryKo: '새 모델 평가'
        })
        const pricingItemId = insertItem(database, { title: 'Pricing update for API' })
        insertSave(database, agentItemId)
        insertSave(database, pricingItemId)
        upsertNote(database, pricingItemId, '사내 분류기 비용 비교')
        searchRepository.reindexItem(agentItemId)
        searchRepository.reindexItem(pricingItemId)

        const searchIds = (query: string) =>
            searchRepository.searchItems({ scope: 'saved', query }).map((libraryItem) => libraryItem.itemId)
        expect(searchIds('에이전트')).toEqual([agentItemId]) // 한국어 3글자 이상
        expect(searchIds('이전트')).toEqual([agentItemId]) // 낱말 가운데 3글자 (부분 일치)
        expect(searchIds('benchmark')).toEqual([agentItemId]) // 영어
        expect(searchIds('BENCHMARK')).toEqual([agentItemId]) // 영어는 대소문자를 가리지 않음
        expect(searchIds('모델')).toEqual([agentItemId]) // 2글자
        expect(searchIds('AP')).toEqual([pricingItemId]) // 영어 2글자
        expect(searchIds('분류기')).toEqual([pricingItemId]) // 메모
        expect(searchIds('비용')).toEqual([pricingItemId]) // 메모 2글자
        expect(searchIds('benchmark 에이전트')).toEqual([agentItemId]) // 긴 낱말끼리 AND
        expect(searchIds('benchmark 모델')).toEqual([agentItemId]) // 긴 낱말과 짧은 낱말 AND
        expect(searchIds('benchmark 비용')).toEqual([]) // 한 기사에 둘 다 있어야 함
        expect(searchIds('없는말')).toEqual([])
        expect(searchIds('50%_')).toEqual([]) // LIKE 특수문자가 들어간 긴 낱말
        expect(searchIds('%')).toEqual([]) // LIKE 특수문자만 있는 짧은 낱말 (모든 기사에 걸리지 않음)
        expect(searchIds('"a" OR')).toEqual([]) // FTS 문법 글자는 글자 그대로 찾음
    })

    it('검색: 검색어가 공백뿐이면 조건 없이 범위 전체를 돌려준다', () => {
        const database = openTestDatabase()
        const searchRepository = createSearchRepository(database)
        const itemId = insertItem(database)
        insertSave(database, itemId)
        searchRepository.reindexItem(itemId)

        expect(searchRepository.searchItems({ scope: 'saved', query: '   ' }).map((libraryItem) => libraryItem.itemId)).toEqual([itemId])
    })

    it('라이브러리: 저장한 기사만 최근에 저장한 순으로, 메모 · 태그 조건을 지원한다', () => {
        const database = openTestDatabase()
        const searchRepository = createSearchRepository(database)
        const taggedItemId = insertItem(database, { title: 'Tagged story' })
        const memoItemId = insertItem(database, { title: 'Memo story' })
        insertItem(database, { title: 'Not saved item' })
        insertSave(database, taggedItemId, '2026-10-06T09:00:00.000Z')
        insertSave(database, memoItemId, '2026-10-07T09:00:00.000Z')
        upsertNote(database, memoItemId, '메모')
        insertTag(database, taggedItemId, 'coding-agent')
        insertTag(database, taggedItemId, 'benchmark')

        const searchIds = (searchParams: { tag?: string; memoOnly?: boolean }) =>
            searchRepository.searchItems({ scope: 'saved', ...searchParams }).map((libraryItem) => libraryItem.itemId)
        expect(searchIds({})).toEqual([memoItemId, taggedItemId])
        expect(searchIds({ memoOnly: true })).toEqual([memoItemId])
        expect(searchIds({ tag: 'coding-agent' })).toEqual([taggedItemId])
        expect(searchIds({ tag: 'CODING-AGENT' })).toEqual([taggedItemId]) // 태그 이름은 대소문자를 가리지 않음
        expect(searchIds({ tag: 'coding' })).toEqual([]) // 태그 이름 전체가 같아야 함
        expect(searchIds({ tag: 'coding-agent', memoOnly: true })).toEqual([])

        // 태그는 이름순, 메모 · 저장 시각이 함께 옴
        const [memoItem, taggedItem] = searchRepository.searchItems({ scope: 'saved' })
        expect(taggedItem).toMatchObject({
            tags: ['benchmark', 'coding-agent'],
            memo: '',
            isSaved: true,
            savedAt: '2026-10-06T09:00:00.000Z'
        })
        expect(memoItem).toMatchObject({ tags: [], memo: '메모', digestDate: null })
    })

    it('아카이브: 브리핑에 실린 기사만 최근 브리핑 순으로, 여러 번 실렸으면 가장 최근 날짜를 돌려준다', () => {
        const database = openTestDatabase()
        const searchRepository = createSearchRepository(database)
        const firstDayItemId = insertItem(database, { title: 'First day story' })
        const secondDayItemId = insertItem(database, { title: 'Second day story' })
        const secondDayOtherItemId = insertItem(database, { title: 'Second day other story' })
        const unpublishedItemId = insertItem(database, { title: 'Second story never published' })
        insertDigest(database, '2026-10-05', [firstDayItemId, secondDayItemId])
        insertDigest(database, '2026-10-06', [firstDayItemId])
        insertDigest(database, '2026-10-07', [secondDayItemId, secondDayOtherItemId])
        insertSave(database, firstDayItemId)
        insertSave(database, unpublishedItemId)
        for (const itemId of [firstDayItemId, secondDayItemId, secondDayOtherItemId, unpublishedItemId])
            searchRepository.reindexItem(itemId)

        // 같은 날은 기사 번호가 큰 순
        expect(
            searchRepository.searchItems({ scope: 'published' }).map((libraryItem) => [libraryItem.itemId, libraryItem.digestDate])
        ).toEqual([
            [secondDayOtherItemId, '2026-10-07'],
            [secondDayItemId, '2026-10-07'],
            [firstDayItemId, '2026-10-06']
        ])
        // 실리지 않은 기사는 검색어가 맞아도 빠짐
        expect(searchRepository.searchItems({ scope: 'published', query: 'Second' }).map((libraryItem) => libraryItem.itemId)).toEqual([
            secondDayOtherItemId,
            secondDayItemId
        ])
        // 저장하지 않은 기사도 나오고 저장 여부가 함께 옴
        expect(searchRepository.searchItems({ scope: 'published', query: 'First' })).toMatchObject([
            { itemId: firstDayItemId, isSaved: true }
        ])
        expect(searchRepository.searchItems({ scope: 'published', query: 'other' })).toMatchObject([
            { itemId: secondDayOtherItemId, isSaved: false, savedAt: null }
        ])
        // 저장한 기사 범위에서는 실린 날짜가 없는 기사도 나옴
        expect(searchRepository.searchItems({ scope: 'saved', query: 'never' })).toMatchObject([
            { itemId: unpublishedItemId, digestDate: null }
        ])
    })

    it('검색 결과: 선별 · 요약 전인 기사는 분류 other, 원래 제목, 소개 글 앞 300자로 채운다', () => {
        const database = openTestDatabase()
        const searchRepository = createSearchRepository(database)
        const rawItemId = insertItem(database, {
            title: 'Raw story',
            snippet: 'x'.repeat(400),
            sourceName: 'GeekNews',
            url: 'https://example.com/raw'
        })
        const summarizedItemId = insertItem(database, {
            title: 'Summarized story',
            titleKo: '요약한 기사',
            summaryKo: '요약 글',
            triageCategory: 'tools',
            snippet: 'intro'
        })
        insertSave(database, rawItemId, '2026-10-07T09:00:00.000Z')
        insertSave(database, summarizedItemId, '2026-10-06T09:00:00.000Z')

        expect(searchRepository.searchItems({ scope: 'saved' })).toEqual([
            {
                itemId: rawItemId,
                titleKo: 'Raw story',
                originalTitle: 'Raw story',
                summaryKo: 'x'.repeat(300),
                category: 'other',
                sourceName: 'GeekNews',
                url: 'https://example.com/raw',
                isSaved: true,
                savedAt: '2026-10-07T09:00:00.000Z',
                digestDate: null,
                memo: '',
                tags: []
            },
            expect.objectContaining({
                itemId: summarizedItemId,
                titleKo: '요약한 기사',
                originalTitle: 'Summarized story',
                summaryKo: '요약 글',
                category: 'tools'
            })
        ])
    })

    it('검색 결과는 최대 200건이다', () => {
        const database = openTestDatabase()
        const searchRepository = createSearchRepository(database)
        for (let itemIndex = 0; itemIndex < 201; itemIndex += 1) {
            const savedAt = new Date(Date.UTC(2026, 9, 1, 0, itemIndex)).toISOString()
            insertSave(database, insertItem(database), savedAt)
        }

        const libraryItems = searchRepository.searchItems({ scope: 'saved' })
        expect(libraryItems).toHaveLength(200)
        // 가장 먼저 저장한 한 건이 잘림
        expect(libraryItems.at(-1)!.savedAt).toBe(new Date(Date.UTC(2026, 9, 1, 0, 1)).toISOString())
    })

    it('메모 · 하이라이트를 바꾼 뒤 색인을 다시 써야 새 글자로 찾을 수 있다', () => {
        const database = openTestDatabase()
        const searchRepository = createSearchRepository(database)
        const itemId = insertItem(database, { title: 'Agents need reliable tool calls' })
        insertSave(database, itemId)
        searchRepository.reindexItem(itemId)
        const searchIds = (query: string) =>
            searchRepository.searchItems({ scope: 'saved', query }).map((libraryItem) => libraryItem.itemId)

        // 메모: 색인을 다시 쓰기 전에는 찾지 못함
        upsertNote(database, itemId, '사내 분류기 비용 비교')
        expect(searchIds('분류기')).toEqual([])
        searchRepository.reindexItem(itemId)
        expect(searchIds('분류기')).toEqual([itemId])

        // 메모를 바꾸면 옛 글자로는 찾지 못함
        upsertNote(database, itemId, '다음 주에 다시 읽기')
        searchRepository.reindexItem(itemId)
        expect(searchIds('분류기')).toEqual([])
        expect(searchIds('다시')).toEqual([itemId])

        // 하이라이트 글자와 하이라이트 메모
        const highlightId = insertHighlight(database, itemId, '에이전트에는 믿을 만한 도구')
        searchRepository.reindexItem(itemId)
        expect(searchIds('믿을')).toEqual([itemId])
        database.update(highlights).set({ note: '도구 호출 안정성' }).where(eq(highlights.id, highlightId)).run()
        expect(searchIds('안정성')).toEqual([])
        searchRepository.reindexItem(itemId)
        expect(searchIds('안정성')).toEqual([itemId])

        // 하이라이트 · 메모를 지우면 찾지 못함
        database.delete(highlights).where(eq(highlights.id, highlightId)).run()
        database.delete(notes).where(eq(notes.itemId, itemId)).run()
        searchRepository.reindexItem(itemId)
        expect(searchIds('안정성')).toEqual([])
        expect(searchIds('다시')).toEqual([])
        expect(searchIds('reliable')).toEqual([itemId])
    })

    it('번역 문단도 검색에 걸리고, 색인하지 않은 기사는 검색어로 찾지 못한다', () => {
        const database = openTestDatabase()
        const searchRepository = createSearchRepository(database)
        const itemId = insertItem(database, { title: 'Translated story' })
        insertSave(database, itemId)
        database
            .insert(contents)
            .values({
                itemId,
                paragraphs: ['First paragraph.', 'Second paragraph.'],
                fullText: true,
                extractedAt: '2026-10-07T00:00:00.000Z',
                paragraphsKo: ['첫째 문단 번역', null]
            })
            .run()
        const searchIds = (query: string) =>
            searchRepository.searchItems({ scope: 'saved', query }).map((libraryItem) => libraryItem.itemId)

        // 색인 행이 없으면 검색어 없는 목록에만 나옴
        expect(searchIds('Translated')).toEqual([])
        expect(searchRepository.searchItems({ scope: 'saved' })).toHaveLength(1)

        searchRepository.reindexItem(itemId)
        expect(searchIds('문단 번역')).toEqual([itemId])
        expect(searchIds('Second paragraph')).toEqual([itemId])
    })
})
