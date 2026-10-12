// ============================================================================
// 기사 본문 규칙
//
// [역할]
// - 원문 페이지에서 본문을 뽑을 기사인지 판단
// - 원문에서 뽑지 않는 기사: 논문(초록이 본문) · 릴리스(릴리스 노트가 본문) · Hacker News와 Reddit 토론 페이지
// - 수집 때 받은 글을 본문 대신 쓸 때 문단으로 나누는 방법
// - DB를 쓰지 않는 규칙만 둠 (본문을 추출해 보관하는 일은 services/enrichment-service.ts)
// ============================================================================

/**
 * 원문 페이지에서 본문을 뽑을 수 있는 기사인지 판단
 * - 논문(초록이 본문) · 릴리스 노트 · 토론 페이지(Hacker News · Reddit)는 수집한 글을 그대로 씀
 *
 * @param {string} url - 기사 주소
 * @param {string} kind - 글 종류 (news · paper · community · release)
 * @returns {boolean} 원문에서 추출을 시도할 기사면 true
 */
export function isExtractable(url: string, kind: string): boolean {
    // 논문 · 릴리스 → 수집한 초록 · 릴리스 노트가 곧 본문
    if (kind === 'paper' || kind === 'release') return false

    try {
        // Hacker News · Reddit 토론 페이지 → 추출하지 않고 수집한 글을 그대로 씀
        const hostname = new URL(url).hostname
        return hostname !== 'news.ycombinator.com' && !hostname.endsWith('reddit.com')
    } catch {
        // 주소로 읽을 수 없는 값 → 추출하지 않음
        return false
    }
}

/**
 * 글을 빈 줄 기준으로 문단으로 나눔
 *
 * @param {string} text - 나눌 글
 * @returns {string[]} 문단 목록 (앞뒤 공백을 떼고 빈 문단은 버림)
 */
export function splitParagraphs(text: string): string[] {
    return text
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
}
