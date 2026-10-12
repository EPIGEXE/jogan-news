// ============================================================================
// 하이라이트 서비스
//
// [역할]
// - 기사 본문에 하이라이트 긋기 · 하이라이트 메모 수정 · 지우기 (모두 바뀐 뒤 그 기사의 하이라이트 목록을 돌려줌)
// - 그은 글자는 보관된 본문(번역문 또는 원문)에서 잘라 저장 (보관된 본문이 없거나 없는 문단이면 건너뜀)
// - 범위 정리: 시작 · 끝이 뒤바뀌어 와도 바로잡고 문단 길이 안으로 자름, 공백뿐인 범위는 건너뜀
// - 같은 문단 · 같은 판에서 겹치거나 맞닿는 하이라이트는 하나로 합침 (가장 먼저 그은 시각 유지, 메모는 줄바꿈으로 이음)
// - 하이라이트를 그은 기사는 메모처럼 자동으로 저장 (이번에 새로 저장됐으면 뒤에서 보강 시작)
// - 긋기 · 메모 수정 · 지우기 뒤에는 검색 색인 갱신 (하이라이트 글자와 메모도 검색 대상)
// ============================================================================
import type { HighlightDTO, HighlightRange } from '@shared/types'
import { nowIso, runInTransaction, type AppDatabase } from '@data/client'
import type { HighlightRepository } from '@data/repositories/highlight-repository'
import type { ItemRepository } from '@data/repositories/item-repository'
import type { LibraryRepository } from '@data/repositories/library-repository'
import type { SearchRepository } from '@data/repositories/search-repository'
import type { ArticleService } from './article-service'

export interface HighlightServiceDeps {
    database: AppDatabase // 여러 쓰기를 한 묶음으로 실행할 때만 사용
    highlightRepository: HighlightRepository // 하이라이트 저장소
    itemRepository: ItemRepository // 그은 글자를 잘라 올 보관된 본문 (읽기만)
    libraryRepository: LibraryRepository // 그은 기사 자동 저장
    searchRepository: SearchRepository // 검색 색인 갱신
    saveFollowUp: Pick<ArticleService, 'enrichLater'> // 새로 저장된 기사의 보강 시작
}

/**
 * 하이라이트 긋기 · 메모 수정 · 지우기
 */
export class HighlightService {
    constructor(private readonly deps: HighlightServiceDeps) {}

    /**
     * 하이라이트 긋기
     *
     * - 겹치거나 맞닿는 기존 하이라이트는 새 범위에 합침
     * - 그은 기사는 자동으로 저장
     *
     * @param {number} itemId - 기사 번호
     * @param {HighlightRange[]} highlightRanges - 그을 범위들
     * @returns {HighlightDTO[]} 그 기사의 하이라이트 목록 (문단 · 시작 위치 순)
     */
    addHighlights(itemId: number, highlightRanges: HighlightRange[]): HighlightDTO[] {
        const { database, highlightRepository, itemRepository, libraryRepository, searchRepository, saveFollowUp } = this.deps

        // 그은 글자를 잘라 올 보관된 본문
        const contentRow = itemRepository.findContentByItemId(itemId)

        const isNewlySaved = runInTransaction(database, () => {
            for (const highlightRange of highlightRanges) {
                // 그은 판의 그 문단 글자 (번역문 또는 원문, ¶ 번호는 1부터)
                const paragraphText =
                    highlightRange.variant === 'ko'
                        ? contentRow?.paragraphsKo?.[highlightRange.paragraph - 1]
                        : contentRow?.paragraphs[highlightRange.paragraph - 1]
                // 보관된 본문이 없거나 없는 문단이면 건너뜀
                if (!paragraphText) continue

                // 범위 정리: 시작 · 끝이 뒤바뀌어 와도 작은 쪽을 시작으로, 문단 길이 안으로 자름
                let startOffset = Math.max(0, Math.min(highlightRange.start, highlightRange.end))
                let endOffset = Math.min(paragraphText.length, Math.max(highlightRange.start, highlightRange.end))
                // 글자가 없는(공백뿐인) 범위는 건너뜀
                if (paragraphText.slice(startOffset, endOffset).trim() === '') continue

                // 같은 문단 · 같은 판에서 이 범위와 겹치거나 맞닿는 기존 하이라이트 (메모를 읽는 순서대로 잇도록 앞에서부터)
                const touchingHighlights = highlightRepository
                    .listHighlightsTouchingSpan({
                        itemId,
                        paragraph: highlightRange.paragraph,
                        variant: highlightRange.variant,
                        start: startOffset,
                        end: endOffset
                    })
                    .sort((leftHighlight, rightHighlight) => leftHighlight.start - rightHighlight.start)

                // 기존 하이라이트 흡수: 범위를 넓히고, 가장 먼저 그은 시각과 메모를 물려받음
                let earliestCreatedAt = nowIso() // 합친 하이라이트의 그은 시각 (겹친 것 중 가장 이른 시각)
                const mergedNotes: string[] = [] // 겹친 하이라이트들의 메모 (빈 메모는 뺌)
                for (const touchingHighlight of touchingHighlights) {
                    startOffset = Math.min(startOffset, touchingHighlight.start)
                    endOffset = Math.max(endOffset, touchingHighlight.end)
                    if (touchingHighlight.createdAt < earliestCreatedAt) earliestCreatedAt = touchingHighlight.createdAt
                    if (touchingHighlight.note.trim()) mergedNotes.push(touchingHighlight.note.trim())
                }

                // 흡수한 기존 하이라이트는 지우고 합친 범위 하나로 저장 (글자는 앞뒤 공백을 뺀 것, 메모는 줄바꿈으로 이음)
                highlightRepository.deleteHighlightsByIds(touchingHighlights.map((touchingHighlight) => touchingHighlight.id))
                highlightRepository.insertHighlight({
                    itemId,
                    paragraph: highlightRange.paragraph,
                    variant: highlightRange.variant,
                    start: startOffset,
                    end: endOffset,
                    text: paragraphText.slice(startOffset, endOffset).trim(),
                    note: mergedNotes.join('\n'),
                    createdAt: earliestCreatedAt
                })
            }

            // 기사 자동 저장 (이미 저장한 기사면 그대로), 하이라이트 글자와 메모로 검색 색인 갱신
            const wasSaveInserted = libraryRepository.insertSaveIfAbsent(itemId)
            searchRepository.reindexItem(itemId)
            return wasSaveInserted
        })

        // 그어서 기사가 새로 저장됐으면 뒤에서 보강
        if (isNewlySaved) saveFollowUp.enrichLater(itemId)
        return highlightRepository.listHighlightsByItemId(itemId)
    }

    /**
     * 하이라이트 메모 수정
     *
     * @param {number} highlightId - 하이라이트 번호
     * @param {string} note - 새 메모
     * @returns {HighlightDTO[]} 그 기사의 하이라이트 목록 (없는 하이라이트면 빈 배열)
     */
    updateHighlightNote(highlightId: number, note: string): HighlightDTO[] {
        const { database, highlightRepository, searchRepository } = this.deps

        // 어느 기사의 하이라이트인지 확인 (없는 하이라이트면 아무것도 하지 않음)
        const highlightRow = highlightRepository.findHighlightById(highlightId)
        if (!highlightRow) return []

        // 메모 수정 후 검색 색인 갱신
        runInTransaction(database, () => {
            highlightRepository.updateHighlightNote(highlightId, note)
            searchRepository.reindexItem(highlightRow.itemId)
        })
        return highlightRepository.listHighlightsByItemId(highlightRow.itemId)
    }

    /**
     * 하이라이트 지우기
     *
     * - 그어서 저장된 기사라도 저장은 그대로 둠
     *
     * @param {number} highlightId - 하이라이트 번호
     * @returns {HighlightDTO[]} 그 기사에 남은 하이라이트 목록 (없는 하이라이트면 빈 배열)
     */
    removeHighlight(highlightId: number): HighlightDTO[] {
        const { database, highlightRepository, searchRepository } = this.deps

        // 어느 기사의 하이라이트인지 확인 (없는 하이라이트면 아무것도 하지 않음)
        const highlightRow = highlightRepository.findHighlightById(highlightId)
        if (!highlightRow) return []

        // 삭제 후 검색 색인 갱신
        runInTransaction(database, () => {
            highlightRepository.deleteHighlightsByIds([highlightId])
            searchRepository.reindexItem(highlightRow.itemId)
        })
        return highlightRepository.listHighlightsByItemId(highlightRow.itemId)
    }
}
