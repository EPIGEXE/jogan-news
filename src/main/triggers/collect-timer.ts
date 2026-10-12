// ============================================================================
// 미리 수집 타이머
//
// [역할]
// - PC가 켜져 있는 동안 2시간마다 새 글 수집만 실행 (LLM 비용 없음, DESIGN.md 4.3절)
// - 10분마다 "마지막 수집 후 2시간이 지났는지" 확인하는 방식으로 동작 (절전 중에는 타이머가 밀리기 때문)
// - 첫 수집은 앱 시작 2시간 뒤 (시작 직후에는 시작 트리거가 브리핑을 만들 수 있음)
// - 오프라인이면 건너뛰고 다음 확인 때(10분 뒤) 다시 시도
// - 수집을 시도했으면 실패하거나 건너뛰어도 다음 시도는 2시간 뒤
// - 결과(새 글 수 · 건너뜀 · 실패)는 진단 기록에만 남김 (화면 알림 없음)
// ============================================================================
import type { LogFn } from '../services/ports'

const COLLECT_INTERVAL_MS = 2 * 3600_000 // 수집과 수집 사이의 간격 (2시간)
const CHECK_INTERVAL_MS = 10 * 60_000 // 수집할 때가 됐는지 확인하는 간격 (10분)

export interface CollectTimerDeps {
    collect(): Promise<{ collected: number; skipped: boolean }> // 수집 실행 (collected는 새 글 수, skipped는 브리핑 생성 중이라 건너뛰었는지)
    isOnline(): boolean // 지금 인터넷에 연결되어 있는지
    log: LogFn // 진단 기록
}

/**
 * 낮 동안 미리 수집하는 타이머
 */
export class CollectTimer {
    private checkTimer: NodeJS.Timeout | null = null // 10분마다 도는 확인 타이머 (꺼져 있으면 null)
    // 앱 시작 직후에는 시작 트리거가 브리핑을 만들 수 있으므로, 첫 수집은 시작 2시간 뒤
    private lastCollectAt = Date.now() // 마지막으로 수집을 시도한 시각 (ms)

    constructor(private readonly deps: CollectTimerDeps) {}

    // 10분마다 수집할 때가 됐는지 확인 시작
    start(): void {
        this.checkTimer = setInterval(() => void this.collectIfDue(), CHECK_INTERVAL_MS)
    }

    // 확인 타이머 해제 (앱 종료 때)
    stop(): void {
        if (this.checkTimer) clearInterval(this.checkTimer)
        this.checkTimer = null
    }

    // 마지막 수집 후 2시간이 지났으면 수집
    private async collectIfDue(): Promise<void> {
        // 아직 2시간이 안 지났으면 할 것 없음
        if (Date.now() - this.lastCollectAt < COLLECT_INTERVAL_MS) return
        if (!this.deps.isOnline()) return // 오프라인이면 다음 확인 때 다시

        // 수집을 부르기 전에 시도한 시각부터 기록
        // 그래서 실패하거나 건너뛰어도 다음 시도는 2시간 뒤
        this.lastCollectAt = Date.now()

        // 수집 실행 후 결과를 진단 기록에 남김 (실패해도 예외를 밖으로 던지지 않음)
        try {
            const collectResult = await this.deps.collect()
            this.deps.log('collect', collectResult.skipped ? '건너뜀 (브리핑 생성 중)' : `새 글 ${collectResult.collected}건`)
        } catch (collectError) {
            this.deps.log('collect', `실패: ${(collectError as Error).message}`)
        }
    }
}
