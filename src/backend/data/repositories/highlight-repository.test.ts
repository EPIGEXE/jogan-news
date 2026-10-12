// ============================================================================
// 하이라이트 저장소 테스트
//
// [역할]
// - 메모리 DB에 실제 쿼리를 돌려 하이라이트의 저장 · 조회 · 메모 수정 · 삭제 확인
// - 목록의 정렬(문단 · 시작 위치), 겹치거나 맞닿는 범위 찾기의 경계, 없을 때 null
// ============================================================================
import { describe, expect, it } from 'vitest'
import type { AppDatabase } from '@data/client'
import { items } from '@data/schema'
import { openTestDatabase } from '@data/testing'
import { createHighlightRepository, type NewHighlight } from './highlight-repository'

// 외래 키를 채울 기사 한 건 넣기 → 기사 번호
function insertItem(database: AppDatabase, urlKey: string): number {
    const itemInsertResult = database
        .insert(items)
        .values({
            urlKey,
            url: `https://${urlKey}`,
            sourceId: 'hn',
            sourceName: 'Hacker News',
            kind: 'community',
            title: 'Mistral Large 4 released',
            titleNorm: 'mistral large 4 released',
            collectedAt: '2026-10-07T00:00:00.000Z'
        })
        .run()
    return Number(itemInsertResult.lastInsertRowid)
}

// 원문 1문단의 [10, 20)에 그은 하이라이트 (바꿀 항목만 넘김)
const newHighlight = (itemId: number, override: Partial<NewHighlight> = {}): NewHighlight => ({
    itemId,
    paragraph: 1,
    variant: 'original',
    start: 10,
    end: 20,
    text: 'highlighted',
    ...override
})

describe('highlight-repository', () => {
    it('저장: 넘긴 값을 화면용 모양으로 돌려주고, 메모 · 시각을 안 넘기면 빈 글자 · 지금 시각으로 채운다', () => {
        const database = openTestDatabase()
        const highlightRepository = createHighlightRepository(database)
        const itemId = insertItem(database, 'a.com/1')

        const explicitHighlightId = highlightRepository.insertHighlight(
            newHighlight(itemId, { text: 'Agents', note: '도구 호출', createdAt: '2026-10-07T01:00:00.000Z' })
        )
        const beforeIso = new Date().toISOString()
        const defaultHighlightId = highlightRepository.insertHighlight(newHighlight(itemId, { paragraph: 2, variant: 'ko' }))

        const [explicitHighlight, defaultHighlight] = highlightRepository.listHighlightsByItemId(itemId)
        expect(explicitHighlight).toEqual({
            id: explicitHighlightId,
            paragraph: 1,
            variant: 'original',
            start: 10,
            end: 20,
            text: 'Agents',
            note: '도구 호출',
            createdAt: '2026-10-07T01:00:00.000Z'
        })
        expect(defaultHighlight).toMatchObject({ id: defaultHighlightId, paragraph: 2, variant: 'ko', note: '' })
        expect(defaultHighlight!.createdAt >= beforeIso).toBe(true)
    })

    it('목록: 문단 · 시작 위치 순으로 돌려주고, 다른 기사의 하이라이트는 섞이지 않는다', () => {
        const database = openTestDatabase()
        const highlightRepository = createHighlightRepository(database)
        const firstItemId = insertItem(database, 'a.com/1')
        const secondItemId = insertItem(database, 'a.com/2')
        expect(highlightRepository.listHighlightsByItemId(firstItemId)).toEqual([])

        highlightRepository.insertHighlight(newHighlight(firstItemId, { paragraph: 2, start: 0, end: 5 }))
        highlightRepository.insertHighlight(newHighlight(firstItemId, { paragraph: 1, start: 30, end: 40 }))
        highlightRepository.insertHighlight(newHighlight(firstItemId, { paragraph: 1, start: 3, end: 8 }))
        highlightRepository.insertHighlight(newHighlight(secondItemId))

        expect(highlightRepository.listHighlightsByItemId(firstItemId).map((highlight) => [highlight.paragraph, highlight.start])).toEqual([
            [1, 3],
            [1, 30],
            [2, 0]
        ])
        expect(highlightRepository.listHighlightsByItemId(secondItemId)).toHaveLength(1)
    })

    it('한 건 조회: 어느 기사의 것인지 함께 돌려주고, 없으면 null', () => {
        const database = openTestDatabase()
        const highlightRepository = createHighlightRepository(database)
        const itemId = insertItem(database, 'a.com/1')
        const highlightId = highlightRepository.insertHighlight(newHighlight(itemId))

        expect(highlightRepository.findHighlightById(highlightId)).toMatchObject({
            id: highlightId,
            itemId,
            startOffset: 10,
            endOffset: 20
        })
        expect(highlightRepository.findHighlightById(highlightId + 1)).toBeNull()
    })

    it('겹치거나 맞닿는 범위 찾기: 끝과 시작이 딱 붙은 것까지 찾고, 한 글자라도 떨어지면 찾지 않는다', () => {
        const database = openTestDatabase()
        const highlightRepository = createHighlightRepository(database)
        const itemId = insertItem(database, 'a.com/1')
        const highlightId = highlightRepository.insertHighlight(newHighlight(itemId)) // [10, 20)
        const span = { itemId, paragraph: 1, variant: 'original' as const }
        const touchingIds = (start: number, end: number) =>
            highlightRepository.listHighlightsTouchingSpan({ ...span, start, end }).map((highlight) => highlight.id)

        expect(touchingIds(15, 17)).toEqual([highlightId]) // 안에 들어감
        expect(touchingIds(0, 50)).toEqual([highlightId]) // 통째로 덮음
        expect(touchingIds(5, 12)).toEqual([highlightId]) // 앞에서 겹침
        expect(touchingIds(18, 30)).toEqual([highlightId]) // 뒤에서 겹침
        expect(touchingIds(0, 10)).toEqual([highlightId]) // 앞에서 맞닿음
        expect(touchingIds(20, 30)).toEqual([highlightId]) // 뒤에서 맞닿음
        expect(touchingIds(0, 9)).toEqual([]) // 앞으로 한 글자 떨어짐
        expect(touchingIds(21, 30)).toEqual([]) // 뒤로 한 글자 떨어짐
    })

    it('겹치거나 맞닿는 범위 찾기: 같은 기사 · 문단 · 판 안에서만 찾는다', () => {
        const database = openTestDatabase()
        const highlightRepository = createHighlightRepository(database)
        const itemId = insertItem(database, 'a.com/1')
        const otherItemId = insertItem(database, 'a.com/2')
        const firstHighlightId = highlightRepository.insertHighlight(newHighlight(itemId, { start: 0, end: 6, note: '첫째' }))
        const secondHighlightId = highlightRepository.insertHighlight(newHighlight(itemId, { start: 15, end: 25 }))
        highlightRepository.insertHighlight(newHighlight(itemId, { variant: 'ko' }))
        highlightRepository.insertHighlight(newHighlight(itemId, { paragraph: 2 }))
        highlightRepository.insertHighlight(newHighlight(otherItemId))

        const touchingHighlights = highlightRepository.listHighlightsTouchingSpan({
            itemId,
            paragraph: 1,
            variant: 'original',
            start: 4,
            end: 21
        })
        expect(touchingHighlights.map((highlight) => highlight.id).sort()).toEqual([firstHighlightId, secondHighlightId].sort())
        // 합칠 때 필요한 값(범위 · 메모 · 그은 시각)이 들어 있음
        expect(touchingHighlights.find((highlight) => highlight.id === firstHighlightId)).toMatchObject({ start: 0, end: 6, note: '첫째' })
    })

    it('메모 수정: 그 하이라이트의 메모만 바꾸고, 없는 번호면 아무 일도 없다', () => {
        const database = openTestDatabase()
        const highlightRepository = createHighlightRepository(database)
        const itemId = insertItem(database, 'a.com/1')
        const firstHighlightId = highlightRepository.insertHighlight(newHighlight(itemId, { start: 0, end: 5 }))
        highlightRepository.insertHighlight(newHighlight(itemId, { start: 30, end: 40, note: '그대로' }))

        highlightRepository.updateHighlightNote(firstHighlightId, '도구 호출 안정성')
        highlightRepository.updateHighlightNote(9999, '없는 하이라이트')
        expect(highlightRepository.listHighlightsByItemId(itemId).map((highlight) => highlight.note)).toEqual([
            '도구 호출 안정성',
            '그대로'
        ])
    })

    it('삭제: 넘긴 번호만 지우고 지운 개수를 돌려준다 (빈 목록 · 없는 번호는 0)', () => {
        const database = openTestDatabase()
        const highlightRepository = createHighlightRepository(database)
        const itemId = insertItem(database, 'a.com/1')
        const firstHighlightId = highlightRepository.insertHighlight(newHighlight(itemId, { start: 0, end: 5 }))
        const secondHighlightId = highlightRepository.insertHighlight(newHighlight(itemId, { start: 10, end: 15 }))
        const thirdHighlightId = highlightRepository.insertHighlight(newHighlight(itemId, { start: 20, end: 25 }))

        expect(highlightRepository.deleteHighlightsByIds([])).toBe(0)
        expect(highlightRepository.deleteHighlightsByIds([9999])).toBe(0)
        expect(highlightRepository.deleteHighlightsByIds([firstHighlightId, thirdHighlightId, 9999])).toBe(2)
        expect(highlightRepository.listHighlightsByItemId(itemId).map((highlight) => highlight.id)).toEqual([secondHighlightId])
    })
})
