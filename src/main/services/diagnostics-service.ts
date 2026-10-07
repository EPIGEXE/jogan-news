import { dateKey, DEFAULT_SCHEDULE } from '@shared/schedule'
import type { DiagEvent, NetCheckResult, TriggerState } from '@shared/ipc'
import type { ContentService } from './content-service'

// 진단 화면: 기록, 알림 테스트, 네트워크 점검, 트리거 상태

export interface DiagnosticsDeps {
  listEvents(): DiagEvent[]
  testNotification(): void
  runNetworkChecks(): Promise<NetCheckResult[]>
  nextTimerAt(): Date | null
  isPackaged: boolean
  content: ContentService
}

export class DiagnosticsService {
  constructor(private readonly d: DiagnosticsDeps) {}

  events(): DiagEvent[] {
    return this.d.listEvents()
  }

  testNotification(): void {
    this.d.testNotification()
  }

  runNetworkChecks(): Promise<NetCheckResult[]> {
    return this.d.runNetworkChecks()
  }

  async triggerState(): Promise<TriggerState> {
    const next = this.d.nextTimerAt()
    return {
      today: dateKey(new Date()),
      lastDigestDate: await this.d.content.getLastDigestDate(),
      nextTimerAt: next ? next.toISOString() : null,
      morningHour: DEFAULT_SCHEDULE.morningHour,
      dayStartHour: DEFAULT_SCHEDULE.dayStartHour,
      isPackaged: this.d.isPackaged
    }
  }
}
