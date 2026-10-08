import { describe, expect, it } from 'vitest'
import { cleanCitations, selectParagraphs } from './citations'

describe('cleanCitations', () => {
  it('있는 문단 번호만 남기고 지어낸 번호는 지운다', () => {
    const r = cleanCitations('A는 새 기능이다 [¶2]. B도 있다 [¶9]. 다시 A [¶2][¶3].', 'paragraph', new Set([1, 2, 3]))
    expect(r.citations).toEqual([2, 3])
    expect(r.content).toBe('A는 새 기능이다 [¶2]. B도 있다. 다시 A [¶2][¶3].')
  })

  it('브리핑 채팅의 [#n]도 같은 방식으로 다룬다', () => {
    const r = cleanCitations('오늘은 [# 1]과 [#4]가 중요하다', 'digest', new Set([1, 2]))
    expect(r).toEqual({ content: '오늘은 [#1]과 가 중요하다', citations: [1] })
  })

  it('다른 종류의 표시는 건드리지 않는다', () => {
    expect(cleanCitations('[#1] 그리고 [¶1]', 'paragraph', new Set([1])).content).toBe('[#1] 그리고 [¶1]')
  })
})

describe('selectParagraphs', () => {
  const paras = ['도입부', '배경 설명', '세부 사항', '가격은 월 10달러', '무관한 이야기', '가격 비교 표']

  it('상한 안이면 전부, 번호는 1부터', () => {
    expect(selectParagraphs(paras, '가격', 1000).map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('넘치면 앞 3문단 + 질문과 겹치는 문단을 원래 순서로', () => {
    const r = selectParagraphs(paras, '가격이 얼마야? 가격 비교', 25)
    expect(r.map((p) => p.n)).toEqual([1, 2, 3, 6])
    expect(r[3]).toEqual({ n: 6, text: '가격 비교 표' })
  })
})
