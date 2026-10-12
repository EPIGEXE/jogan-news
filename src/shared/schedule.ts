// ============================================================================
// 브리핑 생성 시점 규칙
//
// [역할]
// - 지금 브리핑을 만들어야 하는지 판단 (DESIGN.md 4.2절)
// - 오늘 브리핑이 이미 있음: 계기와 상관없이 만들지 않음
// - 직접 누름: 시각과 상관없이 생성
// - 아침 타이머: 아침 생성 시각(기본 8시) 이후에만 생성
// - 앱 시작 · 잠금 해제 · 절전 복귀: 하루 시작 시각(기본 5시) 이후면 생성 (새벽은 전날 밤 작업으로 봄)
// - 다음 아침 자동 생성 시각까지 남은 시간 계산
// - 날짜를 저장 · 비교에 쓰는 형식(YYYY-MM-DD)으로 변환
// - Electron에 기대지 않는 순수 함수 (Main 프로세스와 테스트에서 함께 사용)
// ============================================================================

// 생성을 시도하게 된 계기 (앱 시작 · 잠금 해제 · 절전 복귀 · 아침 타이머 · 직접 누름)
export type TriggerReason = 'startup' | 'unlock' | 'resume' | 'timer' | 'manual'

// 생성 시점을 정하는 시각 (둘 다 0~23시, 로컬 시간)
export interface ScheduleConfig {
    morningHour: number // 켜둔 채로 있을 때 자동 생성하는 시각 (기본 8시)
    dayStartHour: number // 이 시각 이전의 잠금 해제 · 로그인은 전날 밤 작업으로 보고 생성하지 않음 (기본 5시)
}

export const DEFAULT_SCHEDULE: ScheduleConfig = { morningHour: 8, dayStartHour: 5 } // 기본 생성 시각

/**
 * 날짜를 YYYY-MM-DD로 변환 (로컬 시간 기준)
 *
 * @param {Date} date - 변환할 날짜
 * @returns {string} 'YYYY-MM-DD' 모양의 글자
 */
export function dateKey(date: Date): string {
    // 월 · 일은 두 자리로 맞춤 (글자끼리 비교해도 날짜 순서가 되도록)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const dayOfMonth = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${dayOfMonth}`
}

/**
 * 지금 브리핑을 만들어야 하는지 판단
 *
 * - 오늘 브리핑이 이미 있으면 만들지 않음
 * - 직접 누른 경우는 시각과 상관없이 생성
 * - 타이머는 아침 생성 시각 이후에만 생성
 * - 로그인 · 잠금 해제 · 절전 복귀는 하루 시작 시각 이후면 생성 (8시 전이라도 일찍 출근한 것으로 봄, 새벽은 제외)
 *
 * @param {TriggerReason} reason - 생성을 시도하게 된 계기
 * @param {Date} now - 지금 시각
 * @param {string | null} lastDigestDate - 마지막 브리핑 날짜 'YYYY-MM-DD' (없으면 null)
 * @param {ScheduleConfig} config - 아침 생성 시각과 하루 시작 시각
 * @returns {boolean} 만들어야 하면 true
 */
export function shouldGenerate(
    reason: TriggerReason,
    now: Date,
    lastDigestDate: string | null,
    config: ScheduleConfig = DEFAULT_SCHEDULE
): boolean {
    // 오늘 브리핑이 이미 있음 → 어떤 계기든 만들지 않음 (직접 누른 경우 포함)
    if (lastDigestDate === dateKey(now)) return false

    // 직접 누름 → 시각과 상관없이 생성
    if (reason === 'manual') return true

    // 아침 타이머 → 아침 생성 시각이 된 뒤에만 생성
    const currentHour = now.getHours() // 지금 몇 시인지 (0~23, 로컬 시간)
    if (reason === 'timer') return currentHour >= config.morningHour

    // 로그인 · 잠금 해제 · 절전 복귀: 8시 전이라도 일찍 출근한 것으로 보고 생성 (단, 새벽에는 생성하지 않음)
    return currentHour >= config.dayStartHour
}

/**
 * 다음 아침 생성 시각(morningHour 정각)까지 남은 시간 계산
 *
 * @param {Date} now - 지금 시각
 * @param {ScheduleConfig} config - 아침 생성 시각
 * @returns {number} 남은 밀리초 (오늘 그 시각이 지났으면 내일 기준)
 */
export function msUntilNextMorning(now: Date, config: ScheduleConfig = DEFAULT_SCHEDULE): number {
    // 오늘의 아침 생성 시각 (정각)
    const nextMorning = new Date(now)
    nextMorning.setHours(config.morningHour, 0, 0, 0)

    // 이미 지났으면(지금이 정각인 경우 포함) 내일 같은 시각으로
    if (nextMorning.getTime() <= now.getTime()) nextMorning.setDate(nextMorning.getDate() + 1)
    return nextMorning.getTime() - now.getTime()
}
