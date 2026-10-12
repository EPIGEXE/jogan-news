// ============================================================================
// 수집 공통 형식과 요청 도구
//
// [역할]
// - 모든 수집기가 돌려주는 글 한 건의 공통 형식(RawItem) 정의
// - 바깥 사이트에 보내는 요청의 공통 규칙: 같은 User-Agent, 요청 한 번에 15초 제한, 2xx가 아니면 오류
// - 글이 기준 시각 이후에 나왔는지 판단 (날짜가 없거나 읽을 수 없으면 받는 쪽으로)
// ============================================================================
import type { ItemKind } from '@config/index'

// 수집기가 돌려주는 글 한 건
export interface RawItem {
    sourceId: string // 소스 ID (config/sources.yaml의 id)
    sourceName: string // 화면에 보여 줄 소스 이름
    kind: ItemKind // 글 종류 (news · paper · community · release). 브리핑 분류의 참고값
    title: string // 원제
    url: string // 원문 주소
    publishedAt: string | null // 나온 시각 (소스가 주지 않으면 null)
    snippet: string // 수집 때 받은 글의 첫 부분 (RSS 요약 · 논문 초록 · 릴리스 노트, 없으면 빈 글자)
    engagement: number // 화제성 수치 (HF 추천 수 · HN 점수, 없는 소스는 0)
    engagementLabel: string | null // 화면에 보여 줄 화제성 문구 (예: "HN 1,234점")
    lang: string | null // 글의 언어 (모르면 null)
}

// 요청에 붙이는 User-Agent
// 괄호 안에 URL · 설명을 붙이면 일부 사이트(GeekNews 등)가 봇으로 보고 403을 줌
export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AINews/0.1'
export const FETCH_TIMEOUT_MS = 15_000 // 요청 한 번의 제한 시간 (15초). 넘으면 요청을 끊고 실패로 처리

/**
 * JSON 응답 요청
 *
 * @param {string} url - 요청 주소
 * @returns {Promise<unknown>} 응답 JSON (모양 검증은 호출한 쪽이 함)
 * @throws 응답이 2xx가 아니거나 15초 안에 오지 않으면 오류
 */
export async function fetchJson(url: string): Promise<unknown> {
    const jsonResponse = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!jsonResponse.ok) throw new Error(`HTTP ${jsonResponse.status}`)
    return jsonResponse.json()
}

/**
 * 글자 응답 요청 (피드 XML 등)
 *
 * @param {string} url - 요청 주소
 * @param {string} accept - Accept 헤더 값 (기본은 모든 형식)
 * @returns {Promise<string>} 응답 본문
 * @throws 응답이 2xx가 아니거나 15초 안에 오지 않으면 오류
 */
export async function fetchText(url: string, accept = '*/*'): Promise<string> {
    const textResponse = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: accept },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!textResponse.ok) throw new Error(`HTTP ${textResponse.status}`)
    return textResponse.text()
}

/**
 * 글이 기준 시각 이후에 나왔는지 판단
 *
 * @param {string | null | undefined} publishedIso - 글이 나온 시각
 * @param {Date} since - 기준 시각
 * @returns {boolean} 기준 시각과 같거나 뒤면 true. 날짜가 없거나 읽을 수 없어도 true
 */
export function isPublishedSince(publishedIso: string | null | undefined, since: Date): boolean {
    if (!publishedIso) return true // 날짜가 없으면 일단 받고, 중복은 DB에서 거름
    const publishedMs = Date.parse(publishedIso) // 읽을 수 없는 날짜면 NaN
    return Number.isNaN(publishedMs) || publishedMs >= since.getTime()
}
