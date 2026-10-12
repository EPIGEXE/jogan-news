// ============================================================================
// 브리핑 생성 서비스
//
// [역할]
// - 브리핑 한 번을 만드는 흐름 진행 (네트워크 확인, 상태를 "생성 중"으로 표시, Worker 실행, 결과 알림) (DESIGN.md 4.2절)
// - 한 번에 하나만 생성: 이미 만드는 중이면 새 요청은 기록만 남기고 건너뜀
// - 인터넷에 연결될 때까지 대기: 기다리기 시작하면 "오프라인"으로 표시, 끝내 안 되면 Worker를 부르지 않고 중단
// - 성공: 트레이를 "새 브리핑"으로, 화면에 새 브리핑 게시 알림, 오늘의 한 줄로 Windows 알림
// - 실패: 트레이를 "실패"로, 화면에 실패 이유 전달, 실패 알림 (예외를 밖으로 던지지 않음)
// - 오늘 브리핑을 만들어야 하는지는 판단하지 않음 (부르기 전에 triggers/가 확인)
// - 낮 동안의 미리 수집 요청을 Worker에 전달 (언제 수집할지는 triggers/의 타이머가 정함)
// ============================================================================
import type { TriggerReason } from '@shared/schedule'
import type { BriefingNotifier, LogFn, NetworkPort, RendererEvents, StatusPort, WorkerRpc } from './ports'

export interface BriefingDeps {
    network: NetworkPort // 인터넷 연결 확인
    status: StatusPort // 트레이 상태 표시
    notifier: BriefingNotifier // 결과 알림
    worker: WorkerRpc // 실제 수집 · 요약을 하는 Worker
    events: RendererEvents // 화면으로 보내는 알림
    log: LogFn // 진단 기록
}

/**
 * 브리핑 생성 흐름
 * - 한 번에 하나만 생성
 * - 실패해도 예외를 밖으로 던지지 않고 상태 · 알림으로 알림
 */
export class BriefingService {
    private isGenerating = false // 지금 브리핑을 만드는 중인지

    constructor(private readonly deps: BriefingDeps) {}

    // 지금 브리핑을 만드는 중인지 (네트워크 연결을 기다리는 동안도 포함)
    isRunning(): boolean {
        return this.isGenerating
    }

    // 낮 동안 미리 수집 (LLM 없음) → 새로 쌓인 글 수
    // 브리핑을 만드는 중이거나 이미 수집 중이면 Worker가 건너뛰고 skipped: true
    collectOnly(): Promise<{ collected: number; skipped: boolean }> {
        return this.deps.worker.call('collectOnly')
    }

    /**
     * 브리핑 생성
     * - 이미 만드는 중이면 아무것도 하지 않음
     * - 인터넷에 연결될 때까지 기다리고, 끝내 안 되면 오프라인으로 표시하고 중단
     *
     * @param {TriggerReason} reason - 생성을 시작한 계기 (앱 시작 · 잠금 해제 · 타이머 · 수동 등)
     * @returns {Promise<void>} 생성이 끝나면(성공 · 실패 모두) 완료
     */
    async generate(reason: TriggerReason): Promise<void> {
        const { network, status, notifier, worker, events, log } = this.deps

        // 이미 만드는 중이면 건너뜀 (한 번에 하나만 생성)
        if (this.isGenerating) {
            log('generate-skip', '이미 생성 중')
            return
        }
        this.isGenerating = true

        try {
            // 인터넷에 연결될 때까지 대기 (로그인 직후에는 Wi-Fi · VPN이 늦게 붙을 수 있음)
            // 바로 연결되지 않아 기다리기 시작하면 트레이와 화면에 "연결 대기 중"으로 표시
            const isOnline = await network.waitUntilOnline(() => {
                status.setTrayState('offline')
                events.runProgress({ stage: 'collect', message: '네트워크 연결을 기다리는 중' })
            })

            // 끝내 연결되지 않음 → 오프라인으로 남기고 중단 (Worker를 부르지 않음, 알림도 띄우지 않음)
            // 다음 트리거(로그인 · 잠금 해제 등) 때 다시 시도됨
            if (!isOnline) {
                status.setTrayState('offline')
                events.runProgress({ stage: 'error', message: '네트워크에 연결할 수 없습니다. 다음 로그인·잠금 해제 때 다시 시도합니다.' })
                log('generate-offline', '5분 동안 연결되지 않아 중단')
                return
            }

            // 트레이를 "생성 중"으로 바꾸고 Worker에서 수집 · 선별 · 요약 실행
            // 진행 상황은 Worker가 보내는 알림으로 화면에 따로 전달됨 (이 서비스를 거치지 않음)
            status.setTrayState('busy')
            log('generate-start', reason)
            const runResult = await worker.call('runPipeline', { reason })
            log('generate-done', `${runResult.entryCount}건 · $${runResult.costUsd.toFixed(4)}`)

            // 성공 → 트레이를 "새 브리핑"으로(툴팁에 오늘의 한 줄), 화면에 새 브리핑 게시, Windows 알림
            status.setTrayState('new', runResult.headline)
            events.digestUpdated()
            notifier.briefingReady(runResult.headline)
        } catch (pipelineError) {
            // 실패 → 이유를 진단 기록 · 트레이 · 화면 · 알림에 모두 전달 (예외는 여기서 끝냄)
            const failureMessage = (pipelineError as Error).message
            log('generate-failed', failureMessage)
            status.setTrayState('error', failureMessage)
            events.runProgress({ stage: 'error', message: failureMessage })
            notifier.briefingFailed(failureMessage)
        } finally {
            // 성공 · 실패 · 오프라인 중단 모두 다음 생성을 받을 수 있게 되돌림
            this.isGenerating = false
        }
    }
}
