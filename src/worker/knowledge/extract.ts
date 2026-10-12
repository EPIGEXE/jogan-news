// ============================================================================
// 기사 본문 추출
//
// [역할]
// - 기사 주소의 페이지를 받아 기사 영역만 찾아내고 문단 단위로 나눔 (DESIGN.md 6.2절)
// - 문단 순서가 곧 화면의 ¶ 번호라서 인용 · 하이라이트 위치의 기준이 됨
// - 문단으로 치는 것: 문단 · 목록 항목 · 인용문 · 코드 블록 · 소제목 (다른 블록을 품은 바깥 블록은 제외)
// - 40자 미만인 블록과 똑같은 글이 되풀이된 블록은 버림
// - 페이지 요청은 15초 제한, 2xx가 아니거나 HTML이 아니면 오류
// - 기사 영역을 못 찾거나 남는 문단이 없으면 null (DB에 저장하지 않음, 저장은 호출한 쪽이 함)
// ============================================================================
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { USER_AGENT } from '../collectors/types'

export { USER_AGENT }

// 원문 페이지에서 뽑아낸 기사
export interface ExtractedArticle {
    title: string | null // 페이지에서 읽은 기사 제목 (못 읽으면 null)
    paragraphs: string[] // 본문 문단 (순서가 곧 ¶ 번호)
}

const MIN_PARAGRAPH_CHARS = 40 // 문단으로 치는 최소 글자 수 (이보다 짧은 블록은 버림)

/**
 * 기사 페이지의 HTML 요청
 * - 리다이렉트는 따라감
 *
 * @param {string} url - 기사 주소
 * @param {number} timeoutMs - 요청 제한 시간 (밀리초, 기본 15초)
 * @returns {Promise<string>} 페이지 HTML
 * @throws 응답이 2xx가 아니거나, HTML이 아니거나(PDF 등), 제한 시간 안에 오지 않으면 오류
 */
export async function fetchHtml(url: string, timeoutMs = 15_000): Promise<string> {
    const htmlResponse = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow'
    })
    if (!htmlResponse.ok) throw new Error(`HTTP ${htmlResponse.status}`)

    // HTML이 아닌 응답은 본문을 뽑을 수 없으므로 오류로 처리
    const contentType = htmlResponse.headers.get('content-type') ?? ''
    if (!contentType.includes('html')) throw new Error(`HTML 아님 (${contentType})`)
    return htmlResponse.text()
}

/**
 * HTML에서 기사 본문을 문단 단위로 추출
 *
 * @param {string} html - 페이지 HTML
 * @returns {ExtractedArticle | null} 제목과 본문 문단. 기사 영역을 못 찾거나 남는 문단이 없으면 null
 */
export function extractFromHtml(html: string): ExtractedArticle | null {
    // 페이지에서 기사 영역 찾기 (Readability가 고른 본문 HTML)
    const { document: pageDocument } = parseHTML(html)
    const readableArticle = new Readability(pageDocument as unknown as Document).parse()
    if (!readableArticle?.content) return null

    // 찾아낸 본문 HTML을 다시 문서로 읽어 블록 요소 모으기
    const { document: articleDocument } = parseHTML(`<html><body>${readableArticle.content}</body></html>`)
    const BLOCK_SELECTOR = 'p, li, blockquote, pre, h2, h3' // 문단으로 치는 요소
    // 다른 블록을 품은 컨테이너(예: 댓글 전체를 감싼 li)는 건너뛰고 가장 안쪽 블록만 사용
    const innermostBlocks = [...articleDocument.querySelectorAll(BLOCK_SELECTOR)].filter(
        (blockElement) => !blockElement.querySelector(BLOCK_SELECTOR)
    )

    // 블록마다 글자만 꺼내 공백을 한 칸으로 줄이고, 40자 미만인 것은 버림
    const paragraphTexts = innermostBlocks
        .map((blockElement) => (blockElement.textContent ?? '').replace(/\s+/g, ' ').trim())
        .filter((blockText) => blockText.length >= MIN_PARAGRAPH_CHARS)

    // 똑같은 글이 또 나오면 처음 것만 남김
    const uniqueParagraphs = paragraphTexts.filter(
        (paragraphText, paragraphIndex) => paragraphTexts.indexOf(paragraphText) === paragraphIndex
    )

    // 남는 문단이 없으면 추출 실패로 봄
    if (uniqueParagraphs.length === 0) return null
    return { title: readableArticle.title ?? null, paragraphs: uniqueParagraphs }
}

/**
 * 기사 주소에서 본문 추출
 *
 * @param {string} url - 기사 주소
 * @returns {Promise<ExtractedArticle | null>} 제목과 본문 문단. 본문을 찾지 못하면 null
 * @throws 페이지를 받지 못하면 오류 (fetchHtml과 같음)
 */
export async function extractArticle(url: string): Promise<ExtractedArticle | null> {
    return extractFromHtml(await fetchHtml(url))
}
