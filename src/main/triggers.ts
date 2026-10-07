import { powerMonitor } from 'electron'
import {
  dateKey,
  DEFAULT_SCHEDULE,
  msUntilNextMorning,
  shouldGenerate,
  type TriggerReason
} from '@shared/schedule'
import { logEvent } from './diag-log'

// 브리핑 생성 시점 감지 (DESIGN.md 4.2절). 판단 규칙은 shared/schedule.ts의 순수 함수에 있다.

const STARTUP_DELAY_MS = 60_000

let timer: NodeJS.Timeout | null = null
let nextTimerAt: Date | null = null

export interface TriggerDeps {
  getLastDigestDate(): Promise<string | null>
  generate(reason: TriggerReason): Promise<void>
}

export function getNextTimerAt(): Date | null {
  return nextTimerAt
}

export async function fire(reason: TriggerReason, deps: TriggerDeps): Promise<void> {
  const now = new Date()
  let last: string | null
  try {
    last = await deps.getLastDigestDate()
  } catch (err) {
    logEvent(`trigger:${reason}`, `건너뜀 (마지막 생성일 확인 실패: ${(err as Error).message})`)
    return
  }
  const ok = shouldGenerate(reason, now, last, DEFAULT_SCHEDULE)
  logEvent(`trigger:${reason}`, ok ? '생성 조건 충족' : `건너뜀 (오늘=${dateKey(now)}, 마지막 생성=${last ?? '없음'})`)
  if (ok) await deps.generate(reason)
}

function scheduleMorningTimer(deps: TriggerDeps): void {
  if (timer) clearTimeout(timer)
  const delay = msUntilNextMorning(new Date(), DEFAULT_SCHEDULE)
  nextTimerAt = new Date(Date.now() + delay)
  timer = setTimeout(() => {
    void fire('timer', deps)
    scheduleMorningTimer(deps)
  }, delay)
}

export function startTriggers(deps: TriggerDeps): void {
  logEvent('app-start', `${STARTUP_DELAY_MS / 1000}초 뒤 시작 트리거 확인`)
  setTimeout(() => void fire('startup', deps), STARTUP_DELAY_MS)

  powerMonitor.on('lock-screen', () => logEvent('lock-screen'))
  powerMonitor.on('suspend', () => logEvent('suspend'))
  powerMonitor.on('unlock-screen', () => void fire('unlock', deps))
  powerMonitor.on('resume', () => {
    // 절전 중에는 setTimeout이 밀리거나 놓칠 수 있으므로 복귀할 때 타이머를 다시 계산한다.
    scheduleMorningTimer(deps)
    void fire('resume', deps)
  })

  scheduleMorningTimer(deps)
}
