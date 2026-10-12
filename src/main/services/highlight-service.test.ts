// ============================================================================
// 하이라이트 서비스 테스트
//
// [역할]
// - 그은 글자를 보관된 본문에서 잘라 저장하는지, 범위를 문단 안으로 정리하는지 확인
// - 겹치거나 맞닿는 하이라이트 합치기(가장 이른 시각 유지 · 메모 잇기), 판(원문 · 번역문)별 구분 확인
// - 그으면 기사 자동 저장과 보강 시작, 긋기 · 메모 수정 · 지우기 뒤의 검색 색인 갱신 확인
// ============================================================================
import { describe, expect, it, vi } from 'vitest'
import { HighlightService } from './highlight-service'
import { createTestRepositories, insertTestItem } from './test-support'

function setup() {
    const repositories = createTestRepositories()
    const enrichLater = vi.fn()
    const highlightService = new HighlightService({ ...repositories, saveFollowUp: { enrichLater } })

    // 원문 두 문단과 첫 문단의 번역만 있는 기사
    const itemId = insertTestItem(repositories.itemRepository)
    repositories.itemRepository.upsertContent(itemId, ['Agents need reliable tool calls.', 'Second paragraph here.'], true)
    repositories.itemRepository.updateContentTranslation(itemId, ['에이전트에는 믿을 만한 도구 호출이 필요하다.', null], 'test-model')
    return { ...repositories, highlightService, enrichLater, itemId }
}

describe('HighlightService', () => {
    it('글자는 본문에서 잘라 저장하고, 처음 그으면 기사를 저장하고 보강을 시작한다', () => {
        const { highlightService, libraryRepository, enrichLater, itemId } = setup()

        const highlights = highlightService.addHighlights(itemId, [{ paragraph: 1, variant: 'original', start: 0, end: 6 }])
        expect(highlights).toMatchObject([{ paragraph: 1, variant: 'original', start: 0, end: 6, text: 'Agents', note: '' }])
        expect(libraryRepository.findSaveByItemId(itemId)).not.toBeNull()
        expect(enrichLater).toHaveBeenCalledWith(itemId)

        // 이미 저장된 기사에 또 그으면 보강을 다시 시작하지 않음
        highlightService.addHighlights(itemId, [{ paragraph: 2, variant: 'original', start: 0, end: 6 }])
        expect(enrichLater).toHaveBeenCalledOnce()
    })

    it('겹치는 범위는 하나로 합치고, 다른 판(번역문)은 따로 두며, 없는 문단은 건너뛴다', () => {
        const { highlightService, itemId } = setup()
        highlightService.addHighlights(itemId, [{ paragraph: 1, variant: 'original', start: 0, end: 6 }])

        const highlights = highlightService.addHighlights(itemId, [
            { paragraph: 1, variant: 'original', start: 4, end: 21 },
            { paragraph: 1, variant: 'ko', start: 0, end: 5 },
            { paragraph: 2, variant: 'ko', start: 0, end: 3 }, // 번역이 없는 문단
            { paragraph: 9, variant: 'original', start: 0, end: 3 } // 없는 문단
        ])
        expect(highlights.map((highlight) => [highlight.variant, highlight.text]).sort()).toEqual([
            ['ko', '에이전트에'],
            ['original', 'Agents need reliable']
        ])
    })

    it('맞닿기만 한 범위도 합치고, 가장 먼저 그은 시각을 지키며, 메모는 앞에서부터 줄바꿈으로 잇는다', () => {
        const { highlightService, highlightRepository, itemId } = setup()
        highlightRepository.insertHighlight({
            itemId,
            paragraph: 1,
            variant: 'original',
            start: 12,
            end: 20,
            text: 'reliable',
            note: ' 둘째 메모 ',
            createdAt: '2026-10-02T00:00:00.000Z'
        })
        highlightRepository.insertHighlight({
            itemId,
            paragraph: 1,
            variant: 'original',
            start: 0,
            end: 6,
            text: 'Agents',
            note: '첫째 메모',
            createdAt: '2026-10-01T00:00:00.000Z'
        })

        // 6~12(" need ")는 앞의 것(끝 6)과 뒤의 것(시작 12)에 맞닿기만 함
        const highlights = highlightService.addHighlights(itemId, [{ paragraph: 1, variant: 'original', start: 6, end: 12 }])
        expect(highlights).toHaveLength(1)
        expect(highlights[0]).toMatchObject({
            start: 0,
            end: 20,
            text: 'Agents need reliable',
            note: '첫째 메모\n둘째 메모',
            createdAt: '2026-10-01T00:00:00.000Z'
        })
    })

    it('범위 정리: 시작 · 끝이 뒤바뀌어도 바로잡고, 문단 길이 안으로 자르며, 공백뿐인 범위는 건너뛴다', () => {
        const { highlightService, itemId } = setup()

        const highlights = highlightService.addHighlights(itemId, [
            { paragraph: 1, variant: 'original', start: 999, end: 21 }, // 뒤바뀌고 문단보다 긺
            { paragraph: 2, variant: 'original', start: 6, end: 7 } // 공백 한 칸
        ])
        expect(highlights).toMatchObject([{ paragraph: 1, start: 21, end: 32, text: 'tool calls.' }])
    })

    it('보관된 본문이 없는 기사는 긋지 못하지만 기사는 저장된다', () => {
        const { highlightService, itemRepository, libraryRepository } = setup()
        const itemIdWithoutContent = insertTestItem(itemRepository, { snippet: '소개 글만 있음' })

        expect(highlightService.addHighlights(itemIdWithoutContent, [{ paragraph: 1, variant: 'original', start: 0, end: 3 }])).toEqual([])
        expect(libraryRepository.findSaveByItemId(itemIdWithoutContent)).not.toBeNull()
    })

    it('하이라이트 글자와 메모로 검색되고, 메모를 고치거나 지우면 검색에도 반영된다', () => {
        const { highlightService, searchRepository, itemId } = setup()
        const foundItemIds = (query: string) =>
            searchRepository.searchItems({ scope: 'saved', query }).map((libraryItem) => libraryItem.itemId)
        const [highlight] = highlightService.addHighlights(itemId, [{ paragraph: 1, variant: 'ko', start: 0, end: 5 }])

        expect(highlightService.updateHighlightNote(highlight!.id, '도구 호출 안정성')).toMatchObject([{ note: '도구 호출 안정성' }])
        expect(foundItemIds('안정성')).toEqual([itemId])

        expect(highlightService.removeHighlight(highlight!.id)).toEqual([])
        expect(foundItemIds('안정성')).toEqual([])
    })

    it('없는 하이라이트의 메모 수정 · 지우기는 빈 목록을 돌려준다', () => {
        const { highlightService } = setup()
        expect(highlightService.updateHighlightNote(999, '메모')).toEqual([])
        expect(highlightService.removeHighlight(999)).toEqual([])
    })
})
