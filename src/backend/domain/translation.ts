// ============================================================================
// 번역 대상 판정
//
// [역할]
// - 기사가 번역이 필요한지 판단 (한국어 기사는 번역하지 않음)
// - Main(읽기 화면의 번역 상태 표시)과 Worker(번역 실행 여부)가 같은 규칙을 쓰도록 한 곳에 둠
// ============================================================================

const HANGUL_PATTERN = /[가-힣]/g // 한글 글자
const KOREAN_SAMPLE_CHARS = 300 // 한국어 기사인지 볼 때 소개 글에서 읽는 글자 수 (앞에서부터)
const KOREAN_HANGUL_RATIO = 0.3 // 한글이 이 비율 이상이면 한국어 기사로 봄

/**
 * 번역이 필요한 기사인지 판단
 * - 한국어 기사는 번역하지 않음
 * - 소스 언어가 ko이거나 제목 · 소개 글 첫 부분의 한글이 30% 이상이면 한국어로 봄
 *
 * @param article - 기사의 소스 언어(lang) · 원제(title) · 수집 때 받은 소개 글(snippet)
 * @returns {boolean} 번역이 필요하면 true
 */
export function needsTranslation(article: { lang: string | null; title: string; snippet: string }): boolean {
    // 소스 언어가 한국어면 번역하지 않음
    if (article.lang === 'ko') return false

    // 제목과 소개 글 앞 300자에서 공백을 뺀 글자 중 한글이 몇 자인지 셈
    const sampleText = `${article.title} ${article.snippet.slice(0, KOREAN_SAMPLE_CHARS)}`.replace(/\s/g, '')
    const hangulCount = sampleText.match(HANGUL_PATTERN)?.length ?? 0

    // 글자가 없거나 한글이 30% 미만이면 번역 필요
    return sampleText.length === 0 || hangulCount / sampleText.length < KOREAN_HANGUL_RATIO
}
