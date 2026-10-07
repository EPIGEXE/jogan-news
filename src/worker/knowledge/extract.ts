import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { USER_AGENT } from '../collectors/types'

// 기사 URL에서 본문을 추출해 문단 단위로 나눈다 (DESIGN.md 6.2절).

export { USER_AGENT }

export interface Extracted {
  title: string | null
  paragraphs: string[]
}

const MIN_PARAGRAPH_CHARS = 40

export async function fetchHtml(url: string, timeoutMs = 15_000): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow'
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('html')) throw new Error(`HTML 아님 (${type})`)
  return res.text()
}

export function extractFromHtml(html: string): Extracted | null {
  const { document } = parseHTML(html)
  const article = new Readability(document as unknown as Document).parse()
  if (!article?.content) return null
  const { document: body } = parseHTML(`<html><body>${article.content}</body></html>`)
  const BLOCKS = 'p, li, blockquote, pre, h2, h3'
  // 다른 블록을 품은 컨테이너(예: 댓글 전체를 감싼 li)는 건너뛰고 가장 안쪽 블록만 쓴다.
  const blocks = [...body.querySelectorAll(BLOCKS)].filter((el) => !el.querySelector(BLOCKS))
  const paragraphs = blocks
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length >= MIN_PARAGRAPH_CHARS)
  const unique = paragraphs.filter((t, i) => paragraphs.indexOf(t) === i)
  if (unique.length === 0) return null
  return { title: article.title ?? null, paragraphs: unique }
}

export async function extractArticle(url: string): Promise<Extracted | null> {
  return extractFromHtml(await fetchHtml(url))
}
