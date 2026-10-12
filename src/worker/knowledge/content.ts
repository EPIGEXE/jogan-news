// ============================================================================
// 기사 본문 확보
//
// [역할]
// - 기사의 본문이 DB에 없으면 원문 페이지에서 추출해 문단 단위로 저장
// - 원문에서 뽑지 않는 기사: 논문(초록이 본문) · 릴리스(릴리스 노트가 본문) · Hacker News와 Reddit 토론 페이지
// - 추출하지 않거나 실패한 기사는 수집 때 받은 글(요약 · 초록 · 릴리스 노트)을 본문 대신 저장 (그것도 없으면 제목)
// - 원문에서 뽑은 본문인지 대신 넣은 글인지 함께 기록 (fullText)
// - 이미 본문이 있으면 다시 추출하지 않음
// ============================================================================
import type { Db } from '../db/db'
import * as repo from '../db/repo'
import { extractArticle } from './extract'

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

/**
 * 기사 본문 확보 (없으면 추출해서 저장)
 * - 이미 저장된 본문이 있으면 그대로 돌려줌
 * - 추출에 실패해도 예외를 던지지 않고 수집한 글로 대신함
 *
 * @param {Db} db - DB 연결
 * @param itemRow - 기사 행 (주소 · 종류 · 제목 · 수집한 글 · 소스 이름)
 * @param log - 진단 기록 함수
 * @returns {Promise<repo.ItemContent>} 저장된 본문
 */
export async function ensureContent(
    db: Db,
    itemRow: Pick<repo.ItemRow, 'id' | 'url' | 'kind' | 'title' | 'snippet' | 'source_name'>,
    log: (level: 'info' | 'warn' | 'error', message: string) => void
): Promise<repo.ItemContent> {
    // 이미 본문이 있으면 그대로 사용
    const existingContent = repo.getContent(db, itemRow.id)
    if (existingContent) return existingContent

    // 원문에서 뽑을 수 있는 기사면 추출 시도
    // 실패(접속 오류 · 403 · HTML 아님 등)는 기록만 남기고 아래에서 수집한 글로 대신함
    let extractedParagraphs: string[] | null = null // 원문에서 뽑은 문단 (추출하지 않았거나 실패하면 null)
    if (isExtractable(itemRow.url, itemRow.kind)) {
        try {
            extractedParagraphs = (await extractArticle(itemRow.url))?.paragraphs ?? null
        } catch (extractError) {
            log('info', `본문 추출 실패(${itemRow.source_name}): ${(extractError as Error).message}`)
        }
    }

    // 추출 성공 → 원문 본문으로 저장
    if (extractedParagraphs) repo.saveContent(db, itemRow.id, extractedParagraphs, true)
    // 추출하지 않았거나 실패 → 수집한 글(없으면 제목)을 문단으로 나눠 저장하고 원문 본문이 아님을 표시
    else repo.saveContent(db, itemRow.id, splitParagraphs(itemRow.snippet || itemRow.title), false)

    return repo.getContent(db, itemRow.id)!
}
