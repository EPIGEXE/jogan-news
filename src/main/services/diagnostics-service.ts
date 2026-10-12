// ============================================================================
// 진단 서비스
//
// [역할]
// - 진단 화면에 필요한 것 제공 (진단 기록, 알림 테스트, 네트워크 점검)
// - 브리핑 생성 트리거의 지금 상태(오늘 날짜, 마지막 생성일, 다음 타이머 시각)를 모아 전달
// - 기록 · 알림 · 점검은 주입받은 함수를 그대로 호출 (직접 하지 않음)
// - 생성 시각 규칙(오전 생성 시각 · 하루 시작 시각)은 shared/schedule.ts의 기본값을 그대로 전달
// ============================================================================
import { dateKey, DEFAULT_SCHEDULE } from '@shared/schedule'
import type { DiagEvent, NetCheckResult, TriggerState } from '@shared/ipc'

export interface DiagnosticsDeps {
    listEvents(): DiagEvent[] // 지금까지 쌓인 진단 기록
    testNotification(): void // 테스트 알림 띄우기
    runNetworkChecks(): Promise<NetCheckResult[]> // 네트워크 점검 실행
    nextTimerAt(): Date | null // 다음 오전 타이머가 울릴 시각 (아직 없으면 null)
    isPackaged: boolean // 설치판으로 실행 중인지
    getLastDigestDate(): string | null // 마지막으로 브리핑을 만든 날짜 (없으면 null)
}

/**
 * 진단 화면용 기능
 */
export class DiagnosticsService {
    constructor(private readonly deps: DiagnosticsDeps) {}

    // 지금까지 쌓인 진단 기록
    listEvents(): DiagEvent[] {
        return this.deps.listEvents()
    }

    // 테스트 알림 띄우기 (클릭하면 창이 열리는지 확인하는 용도)
    testNotification(): void {
        this.deps.testNotification()
    }

    // 앱이 쓰는 외부 주소에 닿는지 점검 (주소마다 Node fetch와 Electron net.fetch로 각각 호출한 결과)
    runNetworkChecks(): Promise<NetCheckResult[]> {
        return this.deps.runNetworkChecks()
    }

    // 브리핑 생성 트리거의 지금 상태 조회 ("왜 오늘 브리핑이 안 만들어졌는지" 확인용 값 모음)
    triggerState(): TriggerState {
        // 다음 오전 타이머 시각 (트리거를 시작하기 전이면 null)
        const nextTimerDate = this.deps.nextTimerAt()

        // 오늘 날짜와 마지막 생성일 (둘이 같으면 오늘은 더 만들지 않음), 타이머 시각, 생성 시각 규칙
        return {
            today: dateKey(new Date()),
            lastDigestDate: this.deps.getLastDigestDate(),
            nextTimerAt: nextTimerDate ? nextTimerDate.toISOString() : null,
            morningHour: DEFAULT_SCHEDULE.morningHour,
            dayStartHour: DEFAULT_SCHEDULE.dayStartHour,
            isPackaged: this.deps.isPackaged
        }
    }
}
