// ============================================================================
// 번역 규칙 테스트
//
// [역할]
// - 문단이 순서대로 묶음 크기 안에서 나뉘는지 확인
// - 기사 상한을 넘는 뒤쪽 문단이 빠지는지, 묶음보다 긴 문단이 혼자 한 묶음이 되는지 확인
// - 한국어 기사(소스 언어 ko · 한글 비율 30% 이상)를 번역 대상에서 빼는지 확인
// ============================================================================
import { describe, expect, it } from 'vitest'
import { needsTranslation } from '@domain/translation'
import { planChunks } from './translate'

const para = (n: number) => 'x'.repeat(n)

describe('planChunks', () => {
  it('문단을 순서대로 묶음 크기 안에서 나눈다', () => {
    expect(planChunks([para(3000), para(1500), para(1000), para(200)], 40_000, 5000)).toEqual([[0, 1], [2, 3]])
  })

  it('상한을 넘는 뒤쪽 문단은 번역하지 않는다', () => {
    const chunks = planChunks(Array.from({ length: 10 }, () => para(1000)), 4500, 2000)
    expect(chunks.flat()).toEqual([0, 1, 2, 3])
  })

  it('묶음보다 긴 문단 하나는 혼자 한 묶음이 된다', () => {
    expect(planChunks([para(100), para(8000), para(100)], 40_000, 5000)).toEqual([[0], [1], [2]])
  })

  it('빈 본문은 빈 계획', () => {
    expect(planChunks([])).toEqual([])
  })
})

describe('needsTranslation', () => {
  it('소스 언어가 ko이면 번역하지 않는다', () => {
    expect(needsTranslation({ lang: 'ko', title: 'Claude 4 출시', snippet: '' })).toBe(false)
  })

  it('소스 언어를 몰라도 한글이 30% 이상이면 한국어 기사로 본다', () => {
    expect(needsTranslation({ lang: null, title: '앤트로픽이 새 모델을 공개했다', snippet: '오늘 발표된 Claude는…' })).toBe(false)
  })

  it('영어 기사와 글자가 없는 기사는 번역 대상이다', () => {
    expect(needsTranslation({ lang: 'en', title: 'Claude 4 released', snippet: 'Anthropic today…' })).toBe(true)
    expect(needsTranslation({ lang: null, title: '', snippet: '' })).toBe(true)
  })
})
