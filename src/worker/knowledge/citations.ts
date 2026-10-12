// ============================================================================
// 인용 정리와 근거 문단 고르기
//
// [역할]
// - AI 답변의 인용 표시 정리: 근거에 실제로 있는 번호만 남기고, 모델이 지어낸 번호는 답변에서 지움
// - 기사 채팅은 [¶n](문단 번호), 브리핑 채팅은 [#n](브리핑 순위)을 인용 표시로 씀
// - 질문에 근거로 넘길 본문 문단 고르기: 전체가 글자 수 상한 안이면 전부
// - 상한을 넘으면 앞 3문단을 먼저, 이어서 질문과 겹치는 낱말이 많은 문단부터 상한까지 채움
// - 고른 문단의 번호는 원래 문단 번호(1부터)를 유지 (화면의 ¶ 번호와 같아야 인용이 맞음)
// - DB · 네트워크를 쓰지 않는 순수 함수
// ============================================================================

// 인용 표시의 종류: 기사 채팅은 [¶n](문단 번호), 브리핑 채팅은 [#n](브리핑 순위)
export type CitationKind = 'paragraph' | 'digest'

// 종류별 인용 표시 모양 (괄호와 숫자 사이의 공백은 허용)
const CITATION_PATTERN: Record<CitationKind, RegExp> = {
    paragraph: /\[¶\s*(\d+)\]/g,
    digest: /\[#\s*(\d+)\]/g
}

/**
 * 답변의 인용 표시 정리
 * - 근거에 실제로 있는 번호만 남기고, 없는 번호(모델이 지어낸 인용)는 답변에서 지움
 * - 남긴 표시는 공백 없는 모양([¶3] · [#3])으로 통일
 * - 다른 종류의 표시는 건드리지 않음
 *
 * @param {string} answerText - 모델이 쓴 답변
 * @param {CitationKind} citationKind - 이 대화가 쓰는 인용 표시의 종류
 * @param {Set<number>} validNumbers - 근거로 넘긴 번호 (문단 번호 또는 브리핑 순위)
 * @returns {{ content: string; citations: number[] }} 정리한 답변과 인용 번호 목록 (처음 나온 순서, 중복 없음)
 */
export function cleanCitations(
    answerText: string,
    citationKind: CitationKind,
    validNumbers: Set<number>
): { content: string; citations: number[] } {
    const citations: number[] = [] // 남긴 인용 번호 (처음 나온 순서)

    // 답변 안의 인용 표시를 하나씩 확인
    const content = answerText.replace(CITATION_PATTERN[citationKind], (marker, numberText: string) => {
        const citedNumber = Number(numberText)

        // 근거에 없는 번호 → 표시를 지움
        if (!validNumbers.has(citedNumber)) return ''

        // 처음 나온 번호만 목록에 추가
        if (!citations.includes(citedNumber)) citations.push(citedNumber)
        return citationKind === 'paragraph' ? `[¶${citedNumber}]` : `[#${citedNumber}]`
    })

    // 표시를 지운 자리에 남는 문장 부호 앞 공백 정리 ("있다 ." → "있다.")
    return { content: content.replace(/[ \t]+([.,)])/g, '$1').trim(), citations }
}

// 번호가 붙은 본문 문단
export interface NumberedParagraph {
    n: number // 원래 문단 번호 (1부터, 화면의 ¶ 번호)
    text: string // 문단 글
}

const LEAD_PARAGRAPHS = 3 // 본문이 길어 골라야 할 때 항상 먼저 넣는 앞 문단 수

// 글에 나온 낱말 모음 (소문자로 바꾸고 글자 · 숫자가 아닌 것으로 나눔, 한 글자 낱말은 버림)
function extractWords(sourceText: string): Set<string> {
    return new Set(
        sourceText
            .toLowerCase()
            .split(/[^\p{L}\p{N}]+/u)
            .filter((word) => [...word].length >= 2)
    )
}

/**
 * 질문에 근거로 넘길 문단 고르기
 * - 전체 글자 수가 상한 안이면 모든 문단
 * - 넘으면 앞 3문단 + 질문과 겹치는 낱말이 많은 문단 순으로 상한까지 채움
 * - 결과는 원래 문단 순서이고, 번호도 원래 문단 번호(1부터)를 유지
 *
 * @param {string[]} paragraphs - 본문 문단 전체
 * @param {string} question - 사용자 질문
 * @param {number} maxChars - 넘길 본문의 글자 수 상한
 * @returns {NumberedParagraph[]} 번호가 붙은 문단 목록
 */
export function selectParagraphs(paragraphs: string[], question: string, maxChars: number): NumberedParagraph[] {
    // 모든 문단에 원래 번호 붙이기
    const numberedParagraphs = paragraphs.map((paragraphText, paragraphIndex) => ({ n: paragraphIndex + 1, text: paragraphText }))

    // 전체가 상한 안 → 고를 것 없이 전부
    const totalChars = paragraphs.reduce((charCount, paragraph) => charCount + paragraph.length, 0)
    if (totalChars <= maxChars) return numberedParagraphs

    // 문단이 질문과 얼마나 관련 있는지: 질문에 나온 낱말 중 그 문단에도 나오는 낱말 수
    const questionWords = extractWords(question)
    const overlapCount = (numberedParagraph: NumberedParagraph) =>
        [...extractWords(numberedParagraph.text)].filter((word) => questionWords.has(word)).length

    const pickedByNumber = new Map<number, NumberedParagraph>() // 고른 문단 (문단 번호별)
    let usedChars = 0 // 지금까지 고른 문단의 글자 수

    // 이미 골랐거나 넣으면 상한을 넘는 문단은 건너뛰고, 들어가면 담음
    const pickIfFits = (paragraphToPick: NumberedParagraph) => {
        if (pickedByNumber.has(paragraphToPick.n) || usedChars + paragraphToPick.text.length > maxChars) return
        pickedByNumber.set(paragraphToPick.n, paragraphToPick)
        usedChars += paragraphToPick.text.length
    }

    // 앞 3문단 먼저
    numberedParagraphs.slice(0, LEAD_PARAGRAPHS).forEach(pickIfFits)

    // 나머지는 질문과 겹치는 낱말이 많은 순으로 (같으면 앞 문단부터)
    ;[...numberedParagraphs]
        .sort(
            (leftParagraph, rightParagraph) =>
                overlapCount(rightParagraph) - overlapCount(leftParagraph) || leftParagraph.n - rightParagraph.n
        )
        .forEach(pickIfFits)

    // 고른 문단을 원래 순서로 되돌림
    return [...pickedByNumber.values()].sort((leftParagraph, rightParagraph) => leftParagraph.n - rightParagraph.n)
}
