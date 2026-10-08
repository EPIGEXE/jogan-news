import { describe, expect, it } from 'vitest'
import { locate, segments } from './highlight'

const hl = (id: number, start: number, end: number, text: string) => ({ id, start, end, text })

describe('locate', () => {
  it('저장한 위치의 글자가 그대로면 그 위치를 쓴다', () => {
    expect(locate('Agents need tools.', hl(1, 0, 6, 'Agents'))).toEqual([0, 6])
  })

  it('본문이 바뀌었으면 그은 글자를 찾아 옮기고, 없으면 null', () => {
    expect(locate('New intro. Agents need tools.', hl(1, 0, 6, 'Agents'))).toEqual([11, 17])
    expect(locate('Completely different.', hl(1, 0, 6, 'Agents'))).toBeNull()
  })
})

describe('segments', () => {
  it('하이라이트 구간과 나머지로 나눈다', () => {
    expect(segments('abcdefgh', [hl(1, 2, 4, 'cd'), hl(2, 6, 8, 'gh')])).toEqual([
      { text: 'ab', highlightId: null },
      { text: 'cd', highlightId: 1 },
      { text: 'ef', highlightId: null },
      { text: 'gh', highlightId: 2 }
    ])
  })

  it('겹치면 앞 구간이 이기고, 찾지 못한 하이라이트는 건너뛴다', () => {
    expect(segments('abcdef', [hl(1, 0, 3, 'abc'), hl(2, 2, 5, 'cde'), hl(3, 0, 2, 'zz')])).toEqual([
      { text: 'abc', highlightId: 1 },
      { text: 'de', highlightId: 2 },
      { text: 'f', highlightId: null }
    ])
  })
})
