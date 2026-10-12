// ============================================================================
// 수집 항목 정규화
//
// [역할]
// - 수집한 글의 URL · 제목 · 본문 글을 같은 기준으로 맞춤 (같은 글 판정의 기준)
// - URL: 추적용 쿼리 · 해시 · www · 끝의 / 를 버리고, arXiv와 HF Papers 주소는 논문 번호 하나로 통일
// - 제목: 대소문자 · 공백 · 기호 차이를 무시하고 비교할 수 있는 값으로 변환
// - DB나 네트워크를 쓰지 않는 순수 함수
// ============================================================================

const TRACKING_PARAM_NAME = /^(utm_|ref$|ref_src$|fbclid$|gclid$|mc_cid$|mc_eid$|igshid$|s$|source$)/i // 같은 글 판정에서 버리는 추적용 쿼리 이름 (utm_ 으로 시작하는 것과 ref · fbclid · gclid 등)
const ARXIV_ID = /(\d{4}\.\d{4,5})(v\d+)?/ // arXiv 논문 번호 (2610.01234 모양, 뒤의 버전 v2는 번호에 넣지 않음)

/**
 * 같은 글이면 같은 값이 나오도록 URL 정규화
 * - arXiv abs/pdf, HF Papers 페이지는 모두 `arxiv:<id>`로 묶음
 * - 추적용 쿼리, 해시, www, 끝의 /는 버림
 * - 프로토콜(http · https)은 구분하지 않고, 남는 쿼리는 이름 순으로 정렬
 *
 * @param {string} rawUrl - 수집한 글의 주소
 * @returns {string} 같은 글 판정에 쓰는 키 (주소로 읽을 수 없으면 앞뒤 공백을 떼고 소문자로 바꾼 원래 값)
 */
export function urlKey(rawUrl: string): string {
    // 주소로 읽을 수 없는 값 → 앞뒤 공백만 떼고 소문자로
    let parsedUrl: URL
    try {
        parsedUrl = new URL(rawUrl.trim())
    } catch {
        return rawUrl.trim().toLowerCase()
    }
    const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, '')

    // arXiv(하위 도메인 포함) · HF Papers 주소 → 논문 번호로 통일 (번호를 찾지 못하면 일반 주소처럼 처리)
    if (host.endsWith('arxiv.org') || (host === 'huggingface.co' && parsedUrl.pathname.startsWith('/papers/'))) {
        const arxivIdMatch = ARXIV_ID.exec(parsedUrl.pathname)
        if (arxivIdMatch) return `arxiv:${arxivIdMatch[1]}`
    }

    // 추적용 쿼리를 버리고, 남는 쿼리는 이름 순으로 정렬 (순서만 다른 주소도 같은 키가 되게)
    const keptParams = [...parsedUrl.searchParams.entries()]
        .filter(([paramName]) => !TRACKING_PARAM_NAME.test(paramName))
        .sort(([leftParamName], [rightParamName]) => leftParamName.localeCompare(rightParamName))
    const query = keptParams.length ? '?' + new URLSearchParams(keptParams).toString() : ''

    // 경로 끝의 / 를 버리고 호스트 · 경로 · 쿼리만 이어 붙임 (프로토콜 · 해시는 버림)
    const path = parsedUrl.pathname.replace(/\/+$/, '') || ''
    return `${host}${path}${query}`
}

/**
 * 제목 비교용 값으로 변환
 * - 소문자로 바꾸고 공백 · 문장부호 · 기호를 모두 제거, 200자까지
 *
 * @param {string} title - 원래 제목
 * @returns {string} 비교용 제목
 */
export function normalizeTitle(title: string): string {
    return title
        .toLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, '')
        .slice(0, 200)
}

/**
 * 글을 한 줄로 정리
 * - 줄바꿈을 포함한 연속 공백을 한 칸으로 줄이고 앞뒤 공백 제거
 *
 * @param text - 정리할 글 (없으면 빈 문자열 반환)
 * @param {number} maxChars - 남길 최대 글자 수 (기본 2000자)
 * @returns {string} 정리한 글
 */
export function cleanText(text: string | undefined | null, maxChars = 2000): string {
    if (!text) return ''
    return text.replace(/\s+/g, ' ').trim().slice(0, maxChars)
}

/**
 * 줄 구분을 살려서 글 정리 (릴리스 노트처럼 목록이 많은 글)
 * - 줄마다 연속 공백을 한 칸으로 줄이고, 빈 줄은 버림
 * - 줄 사이를 빈 줄로 나눠 줄 하나가 문단 하나가 되게 함
 *
 * @param text - 정리할 글 (없으면 빈 문자열 반환)
 * @param {number} maxChars - 남길 최대 글자 수 (기본 4000자)
 * @returns {string} 정리한 글
 */
export function cleanLines(text: string | undefined | null, maxChars = 4000): string {
    if (!text) return ''
    return text
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n\n')
        .slice(0, maxChars)
}
