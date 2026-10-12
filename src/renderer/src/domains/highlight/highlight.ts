// ============================================================================
// 하이라이트 위치 계산
//
// [역할]
// - 마우스로 선택한 영역을 문단 글자 안의 위치 [start, end)로 변환
// - 저장한 하이라이트가 지금 문단 글자의 어디에 있는지 찾아 문단을 구간으로 나눔
// - 본문 문단 <p>에 붙여 둔 data-para(¶ 번호) · data-variant(ko | original)를 기준으로 계산
// - 선택 · 하이라이트 글자를 인용한 질문 초안 생성
// ============================================================================
import type { HighlightDTO, HighlightRange, HighlightVariant } from '@shared/types'

// 문단 글자를 나눈 조각 하나
export interface ParagraphSegment {
    text: string
    highlightId: number | null // 하이라이트 구간이면 그 하이라이트 id (아니면 null)
}

/**
 * 하이라이트가 지금 문단 글자의 어디에 있는지 찾기
 *
 * - 저장한 위치의 글자가 그대로면 그 위치
 * - 본문이 바뀌었으면(다시 추출 · 다시 번역) 그은 글자를 찾아서 옮긴 위치
 *
 * @param {string} paragraphText - 문단 글자
 * @param {Pick<HighlightDTO, 'start' | 'end' | 'text'>} highlight - 저장한 하이라이트의 위치와 그은 글자
 * @returns {[number, number] | null} 문단 안의 [시작, 끝) 위치 (못 찾으면 null, 그 하이라이트는 목록에만 남음)
 */
export function locateHighlight(paragraphText: string, highlight: Pick<HighlightDTO, 'start' | 'end' | 'text'>): [number, number] | null {
    if (paragraphText.slice(highlight.start, highlight.end).trim() === highlight.text) return [highlight.start, highlight.end]
    const foundIndex = paragraphText.indexOf(highlight.text)
    return foundIndex >= 0 ? [foundIndex, foundIndex + highlight.text.length] : null
}

/**
 * 문단 글자를 하이라이트 구간과 나머지로 나누기
 *
 * - 겹치는 구간은 앞의 것이 우선
 *
 * @param {string} paragraphText - 문단 글자
 * @param {Pick<HighlightDTO, 'id' | 'start' | 'end' | 'text'>[]} highlights - 이 문단의 하이라이트들
 * @returns {ParagraphSegment[]} 앞에서부터 차례로 나눈 조각들
 */
export function splitIntoSegments(
    paragraphText: string,
    highlights: Pick<HighlightDTO, 'id' | 'start' | 'end' | 'text'>[]
): ParagraphSegment[] {
    const highlightSpans = highlights
        .map((highlight) => {
            const locatedPosition = locateHighlight(paragraphText, highlight)
            return locatedPosition ? { id: highlight.id, start: locatedPosition[0], end: locatedPosition[1] } : null
        })
        .filter((highlightSpan): highlightSpan is { id: number; start: number; end: number } => highlightSpan !== null)
        .sort((leftSpan, rightSpan) => leftSpan.start - rightSpan.start)
    const paragraphSegments: ParagraphSegment[] = []
    let consumedEnd = 0
    for (const highlightSpan of highlightSpans) {
        if (highlightSpan.end <= consumedEnd) continue
        const segmentStart = Math.max(highlightSpan.start, consumedEnd)
        if (segmentStart > consumedEnd) paragraphSegments.push({ text: paragraphText.slice(consumedEnd, segmentStart), highlightId: null })
        paragraphSegments.push({ text: paragraphText.slice(segmentStart, highlightSpan.end), highlightId: highlightSpan.id })
        consumedEnd = highlightSpan.end
    }
    if (consumedEnd < paragraphText.length) paragraphSegments.push({ text: paragraphText.slice(consumedEnd), highlightId: null })
    return paragraphSegments
}

// 요소 시작부터 (boundaryNode, boundaryOffset)까지의 글자 수
function offsetWithin(paragraphElement: Element, boundaryNode: Node, boundaryOffset: number): number {
    const measuringRange = document.createRange()
    measuringRange.setStart(paragraphElement, 0)
    measuringRange.setEnd(boundaryNode, boundaryOffset)
    return measuringRange.toString().length
}

/**
 * 현재 선택 영역을 문단별 하이라이트 위치로 변환
 *
 * - container 밖이나 문단 밖 선택은 무시
 * - 여러 문단에 걸치면 문단마다 하나씩 생성
 *
 * @param {HTMLElement} container - 본문을 감싼 요소
 * @returns {HighlightRange[]} 문단별 하이라이트 위치 (선택이 없거나 본문 밖이면 빈 배열)
 */
export function rangesFromSelection(container: HTMLElement): HighlightRange[] {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return []
    const selectionRange = selection.getRangeAt(0)
    if (!container.contains(selectionRange.commonAncestorContainer)) return []
    const highlightRanges: HighlightRange[] = []
    for (const paragraphElement of container.querySelectorAll<HTMLElement>('p[data-para]')) {
        if (!selectionRange.intersectsNode(paragraphElement)) continue
        const paragraphLength = (paragraphElement.textContent ?? '').length
        const rangeStart = paragraphElement.contains(selectionRange.startContainer)
            ? offsetWithin(paragraphElement, selectionRange.startContainer, selectionRange.startOffset)
            : 0
        const rangeEnd = paragraphElement.contains(selectionRange.endContainer)
            ? offsetWithin(paragraphElement, selectionRange.endContainer, selectionRange.endOffset)
            : paragraphLength
        if (rangeEnd - rangeStart < 1 || (paragraphElement.textContent ?? '').slice(rangeStart, rangeEnd).trim() === '') continue
        highlightRanges.push({
            paragraph: Number(paragraphElement.dataset['para']),
            variant: paragraphElement.dataset['variant'] as HighlightVariant,
            start: rangeStart,
            end: rangeEnd
        })
    }
    return highlightRanges
}

/**
 * 선택한 글자 읽기 (질문에 인용할 때)
 *
 * @returns {string} 선택한 글자 (공백을 한 칸으로 줄인 것, 선택이 없으면 빈 문자열)
 */
export function selectedText(): string {
    return window.getSelection()?.toString().replace(/\s+/g, ' ').trim() ?? ''
}

/**
 * 하이라이트 · 선택 글자를 인용한 질문 초안 생성
 *
 * @param {string} quotedText - 인용할 글자 (300자를 넘으면 잘라서 인용)
 * @returns {string} 입력란에 채울 질문 초안
 */
export function buildQuoteQuestion(quotedText: string): string {
    const truncatedQuote = quotedText.length > 300 ? `${quotedText.slice(0, 300)}…` : quotedText
    return `“${truncatedQuote}” — 이 부분을 설명해줘. `
}
