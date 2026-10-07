import type { TriggerReason } from '@shared/schedule'
import type { BriefingNotifier, LogFn, NetworkPort, RendererEvents, StatusPort, WorkerRpc } from './ports'

// 브리핑 생성 흐름 (DESIGN.md 4.2절): 네트워크 확인 → 상태 "생성 중" → Worker 실행 → 결과 알림.

export interface BriefingDeps {
  network: NetworkPort
  status: StatusPort
  notifier: BriefingNotifier
  worker: WorkerRpc
  events: RendererEvents
  log: LogFn
}

export class BriefingService {
  private running = false

  constructor(private readonly d: BriefingDeps) {}

  isRunning(): boolean {
    return this.running
  }

  async generate(reason: TriggerReason): Promise<void> {
    const { network, status, notifier, worker, events, log } = this.d
    if (this.running) {
      log('generate-skip', '이미 생성 중')
      return
    }
    this.running = true
    try {
      const online = await network.waitUntilOnline(() => {
        status.set('offline')
        events.progress({ stage: 'collect', message: '네트워크 연결을 기다리는 중' })
      })
      if (!online) {
        status.set('offline')
        events.progress({ stage: 'error', message: '네트워크에 연결할 수 없습니다. 다음 로그인·잠금 해제 때 다시 시도합니다.' })
        log('generate-offline', '5분 동안 연결되지 않아 중단')
        return
      }

      status.set('busy')
      log('generate-start', reason)
      const r = await worker.call('runPipeline', { reason })
      log('generate-done', `${r.entries}건 · $${r.costUsd.toFixed(4)}`)
      status.set('new')
      events.digestUpdated()
      notifier.briefingReady(r.headline)
    } catch (err) {
      const message = (err as Error).message
      log('generate-failed', message)
      status.set('error')
      events.progress({ stage: 'error', message })
      notifier.briefingFailed(message)
    } finally {
      this.running = false
    }
  }
}
