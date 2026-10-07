import { describe, expect, it } from 'vitest'
import { dateKey, msUntilNextMorning, shouldGenerate } from './schedule'

const at = (h: number, m = 0) => new Date(2026, 9, 7, h, m)

describe('shouldGenerate', () => {
  it('오늘 브리핑이 이미 있으면 어떤 이벤트에도 생성하지 않는다', () => {
    for (const r of ['startup', 'unlock', 'resume', 'timer', 'manual'] as const) {
      expect(shouldGenerate(r, at(9), '2026-10-07')).toBe(false)
    }
  })

  it('8시 전 로그인·잠금 해제는 일찍 출근한 것으로 보고 생성한다', () => {
    expect(shouldGenerate('startup', at(7, 30), '2026-10-06')).toBe(true)
    expect(shouldGenerate('unlock', at(6), '2026-10-06')).toBe(true)
  })

  it('새벽(5시 전) 잠금 해제는 생성하지 않는다', () => {
    expect(shouldGenerate('unlock', at(1), '2026-10-06')).toBe(false)
    expect(shouldGenerate('resume', at(4, 59), null)).toBe(false)
  })

  it('타이머는 8시 이후에만 생성한다', () => {
    expect(shouldGenerate('timer', at(7, 59), '2026-10-06')).toBe(false)
    expect(shouldGenerate('timer', at(8), '2026-10-06')).toBe(true)
  })

  it('수동 새로고침은 시각과 관계없이 생성한다', () => {
    expect(shouldGenerate('manual', at(2), '2026-10-06')).toBe(true)
  })
})

describe('msUntilNextMorning', () => {
  it('8시 전이면 오늘 8시까지', () => {
    expect(msUntilNextMorning(at(7))).toBe(60 * 60 * 1000)
  })
  it('8시 이후면 내일 8시까지', () => {
    expect(msUntilNextMorning(at(9))).toBe(23 * 60 * 60 * 1000)
  })
})

describe('dateKey', () => {
  it('로컬 날짜를 YYYY-MM-DD로 만든다', () => {
    expect(dateKey(at(0, 5))).toBe('2026-10-07')
  })
})
