// ============================================================================
// 번역 묶음 나누기 테스트
//
// [역할]
// - 문단이 순서대로 묶음 크기 안에서 나뉘는지 확인
// - 기사 상한을 넘는 뒤쪽 문단이 빠지는지, 묶음보다 긴 문단이 혼자 한 묶음이 되는지 확인
// ============================================================================
import { describe, expect, it } from 'vitest'
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
