// 브리핑 생성 시점 규칙 (DESIGN.md 4.2절). Main 프로세스와 테스트에서 함께 쓰는 순수 함수.

export type TriggerReason = 'startup' | 'unlock' | 'resume' | 'timer' | 'manual'

export interface ScheduleConfig {
  /** 켜둔 채로 있을 때 자동 생성하는 시각 (기본 8시) */
  morningHour: number
  /** 이 시각 이전의 잠금 해제·로그인은 전날 밤 작업으로 보고 생성하지 않음 (기본 5시) */
  dayStartHour: number
}

export const DEFAULT_SCHEDULE: ScheduleConfig = { morningHour: 8, dayStartHour: 5 }

/** 로컬 시간 기준 YYYY-MM-DD */
export function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function shouldGenerate(
  reason: TriggerReason,
  now: Date,
  lastDigestDate: string | null,
  config: ScheduleConfig = DEFAULT_SCHEDULE
): boolean {
  if (lastDigestDate === dateKey(now)) return false
  if (reason === 'manual') return true
  const hour = now.getHours()
  if (reason === 'timer') return hour >= config.morningHour
  // 로그인·잠금 해제·절전 복귀: 8시 전이라도 일찍 출근한 것으로 보고 생성. 단, 새벽에는 생성하지 않음.
  return hour >= config.dayStartHour
}

/** 다음 morningHour 정각까지 남은 밀리초 */
export function msUntilNextMorning(now: Date, config: ScheduleConfig = DEFAULT_SCHEDULE): number {
  const next = new Date(now)
  next.setHours(config.morningHour, 0, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}
