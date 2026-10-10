import type { HighlightDTO, HighlightRange, HighlightVariant } from '@shared/types'

// 하이라이트 위치 계산. 본문 문단 <p>에는 data-para(¶ 번호)와 data-variant(ko | original)를 붙여 두고,
// 선택 영역을 그 문단 글자 안의 [start, end)로 바꾼다.

export interface Segment {
  text: string
  /** 하이라이트 구간이면 그 하이라이트 id */
  highlightId: number | null
}

/**
 * 하이라이트가 지금 문단 글자의 어디에 있는지 찾는다. 저장한 위치의 글자가 그대로면 그 위치,
 * 본문이 바뀌었으면(다시 추출·다시 번역) 그은 글자를 찾아서 옮긴다. 못 찾으면 null(목록에만 남는다).
 */
export function locate(text: string, h: Pick<HighlightDTO, 'start' | 'end' | 'text'>): [number, number] | null {
  if (text.slice(h.start, h.end).trim() === h.text) return [h.start, h.end]
  const i = text.indexOf(h.text)
  return i >= 0 ? [i, i + h.text.length] : null
}

/** 문단 글자를 하이라이트 구간과 나머지로 나눈다. 겹치는 구간은 앞의 것이 이긴다 */
export function segments(text: string, highlights: Pick<HighlightDTO, 'id' | 'start' | 'end' | 'text'>[]): Segment[] {
  const spans = highlights
    .map((h) => {
      const at = locate(text, h)
      return at ? { id: h.id, start: at[0], end: at[1] } : null
    })
    .filter((s): s is { id: number; start: number; end: number } => s !== null)
    .sort((a, b) => a.start - b.start)
  const out: Segment[] = []
  let pos = 0
  for (const s of spans) {
    if (s.end <= pos) continue
    const start = Math.max(s.start, pos)
    if (start > pos) out.push({ text: text.slice(pos, start), highlightId: null })
    out.push({ text: text.slice(start, s.end), highlightId: s.id })
    pos = s.end
  }
  if (pos < text.length) out.push({ text: text.slice(pos), highlightId: null })
  return out
}

/** 요소 시작부터 (node, offset)까지의 글자 수 */
function offsetWithin(el: Element, node: Node, offset: number): number {
  const r = document.createRange()
  r.setStart(el, 0)
  r.setEnd(node, offset)
  return r.toString().length
}

/**
 * 현재 선택 영역을 문단별 하이라이트 위치로 바꾼다. container 밖이나 문단 밖 선택은 무시한다.
 * 여러 문단에 걸치면 문단마다 하나씩 만든다.
 */
export function rangesFromSelection(container: HTMLElement): HighlightRange[] {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return []
  const range = sel.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return []
  const out: HighlightRange[] = []
  for (const p of container.querySelectorAll<HTMLElement>('p[data-para]')) {
    if (!range.intersectsNode(p)) continue
    const len = (p.textContent ?? '').length
    const start = p.contains(range.startContainer) ? offsetWithin(p, range.startContainer, range.startOffset) : 0
    const end = p.contains(range.endContainer) ? offsetWithin(p, range.endContainer, range.endOffset) : len
    if (end - start < 1 || (p.textContent ?? '').slice(start, end).trim() === '') continue
    out.push({ paragraph: Number(p.dataset['para']), variant: p.dataset['variant'] as HighlightVariant, start, end })
  }
  return out
}

/** 선택한 글자 (질문에 인용할 때) */
export function selectedText(): string {
  return window.getSelection()?.toString().replace(/\s+/g, ' ').trim() ?? ''
}

/** 하이라이트·선택 글자를 인용한 질문 초안 */
export function quoteQuestion(text: string): string {
  const short = text.length > 300 ? `${text.slice(0, 300)}…` : text
  return `“${short}” — 이 부분을 설명해줘. `
}
