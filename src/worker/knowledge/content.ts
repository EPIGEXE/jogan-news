import type { Db } from '../db/db'
import * as repo from '../db/repo'
import { extractArticle } from './extract'

// 기사 본문 확보: 원문에서 추출하고, 안 되면 수집 때 받은 첫 부분(요약·초록·릴리스 노트)으로 대신한다.

/** 원문 페이지에서 본문을 뽑을 수 있는 기사인지. 논문(초록이 본문)·릴리스 노트·토론 페이지는 수집한 글을 그대로 쓴다 */
export function isExtractable(url: string, kind: string): boolean {
  if (kind === 'paper' || kind === 'release') return false
  try {
    const host = new URL(url).hostname
    return host !== 'news.ycombinator.com' && !host.endsWith('reddit.com')
  } catch {
    return false
  }
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/** 본문이 아직 없으면 추출해서 저장한다 */
export async function ensureContent(
  db: Db,
  row: Pick<repo.ItemRow, 'id' | 'url' | 'kind' | 'title' | 'snippet' | 'source_name'>,
  log: (level: 'info' | 'warn' | 'error', message: string) => void
): Promise<repo.Content> {
  const existing = repo.getContent(db, row.id)
  if (existing) return existing
  let paragraphs: string[] | null = null
  if (isExtractable(row.url, row.kind)) {
    try {
      paragraphs = (await extractArticle(row.url))?.paragraphs ?? null
    } catch (err) {
      log('info', `본문 추출 실패(${row.source_name}): ${(err as Error).message}`)
    }
  }
  if (paragraphs) repo.saveContent(db, row.id, paragraphs, true)
  else repo.saveContent(db, row.id, splitParagraphs(row.snippet || row.title), false)
  return repo.getContent(db, row.id)!
}
