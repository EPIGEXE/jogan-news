// ============================================================================
// 브리핑 생성 트리거
//
// [역할]
// - 브리핑을 만들 시점 감지 (앱 시작 · 잠금 해제 · 절전 복귀 · 오전 타이머 · 수동 요청) (DESIGN.md 4.2절)
// - 시점이 오면 생성 조건을 확인하고, 맞으면 생성 시작
// - 모든 시점에서 같은 확인: 오늘 브리핑이 이미 있으면 만들지 않음 (하루에 한 번만 생성)
// - 앱 시작: 1분 뒤에 확인
// - 잠금 해제 · 절전 복귀: 바로 확인 (오전 생성 시각 전이라도 생성, 새벽은 제외)
// - 오전 타이머: 다음 오전 생성 시각에 한 번 울리고 다음 날 것을 다시 예약 (절전 복귀 때도 다시 계산)
// - 화면 잠금 · 절전 진입은 진단 기록만 남김
// - 조건 판단은 shared/schedule.ts의 순수 함수가, 실제 생성은 주입받은 generate가 담당
// ============================================================================
import { powerMonitor } from 'electron'
import { dateKey, DEFAULT_SCHEDULE, msUntilNextMorning, shouldGenerate, type TriggerReason } from '@shared/schedule'
import type { LogFn } from '../services/ports'

const STARTUP_DELAY_MS = 60_000 // 앱 시작 후 첫 확인까지 기다리는 시간 (1분)

export interface BriefingTriggersDeps {
    getLastDigestDate(): Promise<string | null> // 마지막으로 브리핑을 만든 날짜 (없으면 null)
    generate(reason: TriggerReason): Promise<void> // 브리핑 생성
    log: LogFn // 진단 기록
}

/**
 * 브리핑 생성 시점 감지
 */
export class BriefingTriggers {
    private morningTimer: NodeJS.Timeout | null = null // 다음 오전 생성 시각에 울릴 타이머
    private nextMorningAt: Date | null = null // 그 타이머가 울릴 시각
    private startupTimer: NodeJS.Timeout | null = null // 앱 시작 직후의 확인을 미뤄 둔 타이머
    private isStopped = false // true면 더는 생성을 시작하지 않음 (앱 종료 중)

    constructor(private readonly deps: BriefingTriggersDeps) {}

    // 다음 오전 타이머가 울릴 시각 (start 전에는 null)
    get nextMorningTimerAt(): Date | null {
        return this.nextMorningAt
    }

    // 시작 트리거를 예약하고 잠금 · 절전 이벤트와 오전 타이머 연결
    start(): void {
        // 앱 시작 트리거: 1분 뒤에 확인 (아침에 PC를 켜고 로그인한 경우)
        this.deps.log('app-start', `${STARTUP_DELAY_MS / 1000}초 뒤 시작 트리거 확인`)
        this.startupTimer = setTimeout(() => void this.checkAndGenerate('startup'), STARTUP_DELAY_MS)

        // 잠금 · 절전 이벤트 연결 (PC를 끄지 않고 잠금 · 절전 상태로 둔 경우)
        powerMonitor.on('lock-screen', this.onLockScreen)
        powerMonitor.on('suspend', this.onSuspend)
        powerMonitor.on('unlock-screen', this.onUnlockScreen)
        powerMonitor.on('resume', this.onResume)

        // 오전 타이머 예약 (PC를 잠그지 않고 켜 둔 채 아침이 된 경우)
        this.scheduleMorning()
    }

    // 타이머와 전원 이벤트 연결을 모두 해제 (앱 종료 때, 이후로는 생성을 시작하지 않음)
    stop(): void {
        // 이후에 들어오는 확인(fire)과 타이머 예약이 아무것도 하지 않게 먼저 표시
        this.isStopped = true

        // 예약해 둔 시작 확인과 오전 타이머 취소
        if (this.startupTimer) clearTimeout(this.startupTimer)
        if (this.morningTimer) clearTimeout(this.morningTimer)
        this.startupTimer = null
        this.morningTimer = null

        // 전원 이벤트 연결 해제 (start에서 건 것과 같은 함수로)
        powerMonitor.off('lock-screen', this.onLockScreen)
        powerMonitor.off('suspend', this.onSuspend)
        powerMonitor.off('unlock-screen', this.onUnlockScreen)
        powerMonitor.off('resume', this.onResume)
    }

    // 전원 이벤트 처리 (stop에서 같은 함수로 해제할 수 있게 필드로 둠)
    private readonly onLockScreen = (): void => this.deps.log('lock-screen') // 화면 잠금 → 기록만
    private readonly onSuspend = (): void => this.deps.log('suspend') // 절전 진입 → 기록만
    private readonly onUnlockScreen = (): void => void this.checkAndGenerate('unlock') // 잠금 해제 → 생성 조건 확인
    private readonly onResume = (): void => {
        // 절전 중에는 setTimeout이 밀리거나 놓칠 수 있으므로 복귀할 때 타이머를 다시 계산
        this.scheduleMorning()
        // 절전 복귀 → 생성 조건 확인 (절전 때문에 오전 타이머를 놓친 날도 여기서 만들어짐)
        void this.checkAndGenerate('resume')
    }

    /**
     * 생성 조건을 확인하고 맞으면 생성 시작 (끝날 때까지 기다리지 않음)
     * - 오늘 브리핑이 이미 있으면 수동 요청도 건너뜀 (같은 날 다시 만들어도 후보가 거의 같아 결과가 비슷함)
     * - 마지막 생성일을 확인하지 못하면 건너뜀
     *
     * @param {TriggerReason} reason - 확인하게 된 계기
     * @returns {Promise<boolean>} 생성을 시작했으면 true
     */
    async checkAndGenerate(reason: TriggerReason): Promise<boolean> {
        // 앱 종료 중이면 확인하지 않음
        if (this.isStopped) return false

        // 마지막으로 브리핑을 만든 날짜 조회
        // 조회에 실패하면(Worker 종료 등) 오늘 것이 있는지 알 수 없으므로 건너뜀
        const now = new Date() // 판단 기준 시각 (조회를 기다리기 전의 시각)
        let lastDigestDate: string | null // 마지막 생성일 'YYYY-MM-DD' (없으면 null)
        try {
            lastDigestDate = await this.deps.getLastDigestDate()
        } catch (lookupError) {
            this.deps.log(`trigger:${reason}`, `건너뜀 (마지막 생성일 확인 실패: ${(lookupError as Error).message})`)
            return false
        }

        // 생성 조건 판단 (오늘 것이 있으면 생성 안 함, 수동은 시각 무관, 타이머는 오전 생성 시각 이후, 그 밖에는 하루 시작 시각 이후)
        const shouldStart = shouldGenerate(reason, now, lastDigestDate, DEFAULT_SCHEDULE)
        this.deps.log(
            `trigger:${reason}`,
            shouldStart ? '생성 조건 충족' : `건너뜀 (오늘=${dateKey(now)}, 마지막 생성=${lastDigestDate ?? '없음'})`
        )

        // 조건이 맞으면 생성 시작 (끝날 때까지 기다리지 않고 시작 여부만 반환)
        if (shouldStart) void this.deps.generate(reason)
        return shouldStart
    }

    // 다음 오전 생성 시각에 타이머 예약 (울리면 다음 날 것을 다시 예약)
    private scheduleMorning(): void {
        // 앱 종료 중이면 새로 예약하지 않음
        if (this.isStopped) return

        // 이미 예약한 타이머가 있으면 취소하고 지금 시각 기준으로 다시 계산 (절전 복귀 때 다시 불림)
        if (this.morningTimer) clearTimeout(this.morningTimer)
        const delayMs = msUntilNextMorning(new Date(), DEFAULT_SCHEDULE) // 다음 오전 생성 시각까지 남은 시간 (오늘 그 시각이 지났으면 내일 기준)
        this.nextMorningAt = new Date(Date.now() + delayMs)

        // 그 시각에 생성 조건을 확인하고 다음 날 타이머 예약
        this.morningTimer = setTimeout(() => {
            void this.checkAndGenerate('timer')
            this.scheduleMorning()
        }, delayMs)
    }
}
