import type { LogFn } from '../services/ports'

// 낮 동안 미리 수집 (DESIGN.md 4.3절): PC가 켜져 있는 동안 2시간마다 수집만 한다. LLM 비용은 들지 않는다.
// 절전 중에는 타이머가 밀리므로, 10분마다 "마지막 수집 후 2시간이 지났나"를 확인하는 방식으로 돈다.

const INTERVAL_MS = 2 * 3600_000
const CHECK_EVERY_MS = 10 * 60_000

export interface CollectTimerDeps {
  collect(): Promise<{ collected: number; skipped: boolean }>
  isOnline(): boolean
  log: LogFn
}

export class CollectTimer {
  private timer: NodeJS.Timeout | null = null
  /** 앱 시작 직후에는 시작 트리거가 브리핑을 만들 수 있으므로, 첫 수집은 시작 2시간 뒤 */
  private last = Date.now()

  constructor(private readonly d: CollectTimerDeps) {}

  start(): void {
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async check(): Promise<void> {
    if (Date.now() - this.last < INTERVAL_MS) return
    if (!this.d.isOnline()) return // 오프라인이면 다음 확인 때 다시
    this.last = Date.now()
    try {
      const r = await this.d.collect()
      this.d.log('collect', r.skipped ? '건너뜀 (브리핑 생성 중)' : `새 글 ${r.collected}건`)
    } catch (err) {
      this.d.log('collect', `실패: ${(err as Error).message}`)
    }
  }
}
