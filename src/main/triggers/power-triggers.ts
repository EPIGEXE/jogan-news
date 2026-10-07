import { powerMonitor } from 'electron'
import {
  dateKey,
  DEFAULT_SCHEDULE,
  msUntilNextMorning,
  shouldGenerate,
  type TriggerReason
} from '@shared/schedule'
import type { LogFn } from '../services/ports'

// 브리핑 생성 시점 감지 (DESIGN.md 4.2절): 앱 시작, 잠금 해제, 절전 복귀, 오전 타이머, 수동.
// "만들어야 하나?"의 판단은 shared/schedule.ts의 순수 함수, 실제 생성은 주입받은 generate가 한다.

const STARTUP_DELAY_MS = 60_000

export interface TriggerDeps {
  getLastDigestDate(): Promise<string | null>
  generate(reason: TriggerReason): Promise<void>
  log: LogFn
}

export class PowerTriggers {
  private timer: NodeJS.Timeout | null = null
  private next: Date | null = null

  constructor(private readonly d: TriggerDeps) {}

  get nextTimerAt(): Date | null {
    return this.next
  }

  start(): void {
    this.d.log('app-start', `${STARTUP_DELAY_MS / 1000}초 뒤 시작 트리거 확인`)
    setTimeout(() => void this.fire('startup'), STARTUP_DELAY_MS)

    powerMonitor.on('lock-screen', () => this.d.log('lock-screen'))
    powerMonitor.on('suspend', () => this.d.log('suspend'))
    powerMonitor.on('unlock-screen', () => void this.fire('unlock'))
    powerMonitor.on('resume', () => {
      // 절전 중에는 setTimeout이 밀리거나 놓칠 수 있으므로 복귀할 때 타이머를 다시 계산한다.
      this.scheduleMorning()
      void this.fire('resume')
    })

    this.scheduleMorning()
  }

  async fire(reason: TriggerReason): Promise<void> {
    const now = new Date()
    let last: string | null
    try {
      last = await this.d.getLastDigestDate()
    } catch (err) {
      this.d.log(`trigger:${reason}`, `건너뜀 (마지막 생성일 확인 실패: ${(err as Error).message})`)
      return
    }
    const ok = shouldGenerate(reason, now, last, DEFAULT_SCHEDULE)
    this.d.log(`trigger:${reason}`, ok ? '생성 조건 충족' : `건너뜀 (오늘=${dateKey(now)}, 마지막 생성=${last ?? '없음'})`)
    if (ok) await this.d.generate(reason)
  }

  private scheduleMorning(): void {
    if (this.timer) clearTimeout(this.timer)
    const delay = msUntilNextMorning(new Date(), DEFAULT_SCHEDULE)
    this.next = new Date(Date.now() + delay)
    this.timer = setTimeout(() => {
      void this.fire('timer')
      this.scheduleMorning()
    }, delay)
  }
}
