// AI 답변의 인용 표시와 질문에 넘길 본문 고르기. DB·네트워크를 쓰지 않는 순수 함수.

/** 기사 채팅은 [¶n](문단 번호), 브리핑 채팅은 [#n](브리핑 순위) */
export type CitationKind = 'paragraph' | 'digest'

const PATTERN: Record<CitationKind, RegExp> = {
  paragraph: /\[¶\s*(\d+)\]/g,
  digest: /\[#\s*(\d+)\]/g
}

/**
 * 답변에서 인용 표시를 찾아, 실제로 있는 번호만 남긴다. 없는 번호(모델이 지어낸 인용)는 본문에서 지운다.
 * 인용 목록은 처음 나온 순서대로, 중복 없이.
 */
export function cleanCitations(text: string, kind: CitationKind, valid: Set<number>): { content: string; citations: number[] } {
  const citations: number[] = []
  const content = text.replace(PATTERN[kind], (marker, n: string) => {
    const num = Number(n)
    if (!valid.has(num)) return ''
    if (!citations.includes(num)) citations.push(num)
    return kind === 'paragraph' ? `[¶${num}]` : `[#${num}]`
  })
  return { content: content.replace(/[ \t]+([.,)])/g, '$1').trim(), citations }
}

export interface NumberedParagraph {
  n: number
  text: string
}

const LEAD_PARAGRAPHS = 3

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => [...w].length >= 2)
  )
}

/**
 * 질문에 넘길 문단을 고른다. 번호는 원래 문단 번호(1부터)를 유지한다.
 * 전체가 maxChars 안이면 모두, 넘으면 앞 3문단 + 질문과 겹치는 낱말이 많은 문단 순으로 채우고 원래 순서로 돌려놓는다.
 */
export function selectParagraphs(paragraphs: string[], question: string, maxChars: number): NumberedParagraph[] {
  const numbered = paragraphs.map((text, i) => ({ n: i + 1, text }))
  const total = paragraphs.reduce((t, p) => t + p.length, 0)
  if (total <= maxChars) return numbered

  const q = words(question)
  const overlap = (p: NumberedParagraph) => [...words(p.text)].filter((w) => q.has(w)).length
  const picked = new Map<number, NumberedParagraph>()
  let used = 0
  const take = (p: NumberedParagraph) => {
    if (picked.has(p.n) || used + p.text.length > maxChars) return
    picked.set(p.n, p)
    used += p.text.length
  }
  numbered.slice(0, LEAD_PARAGRAPHS).forEach(take)
  ;[...numbered].sort((a, b) => overlap(b) - overlap(a) || a.n - b.n).forEach(take)
  return [...picked.values()].sort((a, b) => a.n - b.n)
}
