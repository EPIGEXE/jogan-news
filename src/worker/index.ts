// ============================================================================
// Worker 진입점
//
// [역할]
// - Electron utilityProcess로 실행되어 Main과 메시지로만 대화 (규약은 shared/worker-protocol.ts)
// - 시작 값(init)을 받으면 DB · 설정을 열어 서비스를 만들고 준비 완료(ready)를 알림
// - 기능 호출(rpc)을 서비스의 같은 이름 메서드로 넘기고, 받은 번호 그대로 성공 · 실패를 답함
// - 서비스가 만들어지기 전에 온 호출은 실패로 답함
// - 서비스의 알림(생성 진행 · 기사 변경 · 답변 스트리밍 · 로그)을 Main으로 전달
// - 잡히지 않은 오류는 로그 메시지로 Main에 알림
// - 초기화에 실패하면 이유를 로그로 알리고 종료 (살아 있기만 하고 일은 못 하는 상태로 남지 않게, 다시 띄울지는 Main이 결정)
// ============================================================================

import type { MainToWorker, WorkerMethod, WorkerToMain } from '@shared/worker-protocol'
import { WorkerService } from './service'

const parentPort = process.parentPort // Main과 메시지를 주고받는 통로
let workerService: WorkerService | null = null // init을 받아 만들기 전에는 null

const EXIT_AFTER_LOG_MS = 200 // 초기화 실패 로그가 Main에 전달될 시간을 준 뒤 종료

// Main으로 메시지 전송
function sendToMain(workerMessage: WorkerToMain): void {
    parentPort.postMessage(workerMessage)
}

// 로그를 Main으로 전달 (경고 · 오류는 Main이 진단 기록에 남김)
const sendLog = (level: 'info' | 'warn' | 'error', logMessage: string) => sendToMain({ type: 'log', level, message: logMessage })

// 기능 호출 하나를 서비스에 넘기고 결과를 같은 번호로 답함
async function handleRpc(callId: number, method: WorkerMethod, params: unknown): Promise<void> {
    try {
        // 서비스가 아직 없으면(init 전이거나 초기화 실패) 실패로 답함
        if (!workerService) throw new Error('Worker가 아직 초기화되지 않았습니다.')

        // 기능 이름과 같은 이름의 서비스 메서드 호출 (동기 · 비동기 메서드 모두 await로 받음)
        const serviceMethod = workerService[method] as (methodParams: unknown) => unknown
        const callResult = await serviceMethod.call(workerService, params)

        // 성공 → 결과 전달 (결과가 없는 기능이면 null)
        sendToMain({ type: 'rpc-result', id: callId, ok: true, result: callResult ?? null })
    } catch (callError) {
        // 실패 → 오류 내용만 전달 (Main이 Error로 다시 만들어 호출한 쪽에 던짐)
        sendToMain({ type: 'rpc-result', id: callId, ok: false, error: (callError as Error).message })
    }
}

// Main이 보낸 메시지를 종류에 맞게 처리
parentPort.on('message', (messageEvent) => {
    const mainMessage = messageEvent.data as MainToWorker
    switch (mainMessage.type) {
        case 'init':
            // 시작 값 → DB · 설정을 열어 서비스를 만들고 준비 완료를 알림
            try {
                workerService = new WorkerService({
                    dbPath: mainMessage.dbPath,
                    configDir: mainMessage.configDir,
                    apiKey: mainMessage.apiKey,
                    onProgress: (runProgress) => sendToMain({ type: 'progress', progress: runProgress }),
                    onItemUpdated: (itemId) => sendToMain({ type: 'item-updated', itemId }),
                    onChatEvent: (chatEvent) => sendToMain({ type: 'chat', event: chatEvent }),
                    log: sendLog
                })
                sendToMain({ type: 'ready' })
            } catch (initError) {
                // 초기화 실패(DB를 못 엶 · 설정 파일 오류 등) → 이유를 로그로 알리고 종료
                // ready를 보내지 않은 채 살아 있으면 Main의 모든 호출이 끝없이 기다리게 됨
                sendLog('error', `Worker 초기화 실패: ${(initError as Error).stack ?? (initError as Error).message}`)
                setTimeout(() => process.exit(1), EXIT_AFTER_LOG_MS)
            }
            break
        case 'set-api-key':
            // API 키 변경 → 서비스에 반영 (서비스가 아직 없으면 무시)
            workerService?.setApiKey(mainMessage.apiKey)
            break
        case 'rpc':
            // 기능 호출 → 끝나기를 기다리지 않고 다음 메시지를 받음 (응답은 handleRpc가 보냄)
            void handleRpc(mainMessage.id, mainMessage.method, mainMessage.params)
            break
    }
})

// 어디서도 잡히지 않은 오류 · Promise 거부는 로그로 Main에 알림
process.on('uncaughtException', (uncaughtError) => sendLog('error', `처리되지 않은 오류: ${uncaughtError.stack ?? uncaughtError.message}`))
process.on('unhandledRejection', (rejectionReason) => sendLog('error', `처리되지 않은 Promise 오류: ${String(rejectionReason)}`))
