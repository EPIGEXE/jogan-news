// ============================================================================
// Worker 호출
//
// [역할]
// - Worker(utilityProcess)를 띄우고 시작에 필요한 값(DB 경로 · 설정 폴더 · API 키) 전달
// - Worker의 기능을 호출하고 결과를 기다림 (요청마다 번호를 붙여 응답과 짝지음)
// - Worker가 준비됐다고 알리기 전의 호출: 준비될 때까지 기다렸다가 전송
// - Worker가 보내는 알림(생성 진행 · 답변 조각 · 로그)을 받아 전달
// - Worker가 죽으면 응답을 기다리던 호출은 모두 실패 처리하고 3초 뒤 다시 띄움 (DESIGN.md 3절)
// - 다시 뜨기를 기다리는 동안 들어온 호출: 새 Worker가 준비되면 전송
// - 준비도 못 하고 연달아 3번 죽으면 다시 띄우기를 그만두고 호출을 바로 실패로 답함 (DB · 설정 오류처럼 다시 띄워도 안 되는 경우)
// - 앱을 끄는 중이면 다시 띄우지 않고, 기다리던 호출은 실패로 끝냄
// - 바뀐 API 키는 실행 중인 Worker에 바로 전달 (다시 뜰 때는 그때의 키를 새로 읽음)
// ============================================================================
import { join } from 'node:path'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import type { RunProgress } from '@shared/types'
import type { MainToWorker, WorkerMethod, WorkerParams, WorkerResult, WorkerToMain } from '@shared/worker-protocol'
import type { LogFn, WorkerRpc } from '../services/ports'

// 응답을 기다리는 호출 하나
interface PendingCall {
    resolve(callResult: unknown): void // 결과가 오면 호출
    reject(callError: Error): void // 실패했거나 Worker가 종료되면 호출
}

const RESTART_DELAY_MS = 3000 // Worker가 죽은 뒤 다시 띄울 때까지 기다리는 시간
const MAX_START_FAILURES = 3 // 준비 전에 연달아 이만큼 죽으면 다시 띄우지 않음

// Worker 한 번의 실행이 준비됐는지 알려 주는 문 (준비되면 열리고, 준비 전에 죽으면 실패)
interface ReadyGate {
    opened: Promise<void> // 준비되면 끝나고, 준비 전에 종료되면 실패하는 약속
    open(): void // 문 열기 (기다리던 호출이 전송됨)
    fail(exitError: Error): void // 문을 실패로 끝내기 (기다리던 호출이 이 오류로 실패)
    isSettled: boolean // 이미 열렸거나 실패했는지
}

// 아직 열리지도 실패하지도 않은 새 문 생성
function createReadyGate(): ReadyGate {
    // 약속을 밖에서 끝낼 수 있게 resolve · reject를 꺼내 둠
    let open!: () => void
    let fail!: (exitError: Error) => void
    const readyGate: ReadyGate = {
        opened: new Promise<void>((resolveOpened, rejectOpened) => {
            open = resolveOpened
            fail = rejectOpened
        }),
        open: () => {
            readyGate.isSettled = true
            open()
        },
        fail: (exitError) => {
            readyGate.isSettled = true
            fail(exitError)
        },
        isSettled: false
    }

    // 기다리는 호출이 없을 때 실패해도 처리되지 않은 거부로 남지 않게 함
    readyGate.opened.catch(() => {})
    return readyGate
}

/**
 * Worker 프로세스를 띄우고 호출
 *
 * - Worker가 준비됐다고 알린 뒤에 호출을 보냄
 * - Worker가 종료되면 기다리던 호출을 모두 실패 처리하고 다시 띄움
 * - 다시 뜨기를 기다리는 동안 들어온 호출은 새 Worker가 준비되면 보냄
 */
export class WorkerClient implements WorkerRpc {
    private workerProcess: UtilityProcess | null = null // 실행 중이 아니면 null
    private nextCallId = 1 // 다음 호출에 붙일 번호
    private readonly pendingCalls = new Map<number, PendingCall>() // 호출 번호별로 응답을 기다리는 호출
    private readyGate = createReadyGate() // 지금(또는 곧 다시 뜰) Worker가 준비됐는지
    private restartTimer: NodeJS.Timeout | null = null // 다시 띄우기를 기다리는 타이머
    private isStopping = false // true면 종료되어도 다시 띄우지 않음
    private startFailureCount = 0 // 준비되기 전에 연달아 죽은 횟수 (한 번이라도 준비되면 0으로)

    constructor(
        private readonly options: {
            dbPath: string // Worker가 열 DB 파일 경로
            configDir: string // 수집 소스 · 프롬프트 등 설정 파일이 있는 폴더
            getApiKey(): string | null // Worker를 띄울 때마다 읽는 API 키
            onProgress(runProgress: RunProgress): void // 브리핑 생성 진행 상황을 받을 함수
            onChatDelta(requestId: string, deltaText: string): void // AI 답변 조각을 받을 함수 (requestId는 그 질문의 요청 번호)
            log: LogFn // 진단 기록
        }
    ) {}

    // Worker를 띄우고 시작 값 전달 (종료되면 이 메서드를 다시 불러 재시작)
    start(): void {
        // Worker 프로세스 띄우기
        const workerProcess = utilityProcess.fork(join(import.meta.dirname, 'worker.js'), [], {
            serviceName: 'Jogan Worker',
            stdio: 'pipe'
        })
        this.workerProcess = workerProcess

        // Worker의 콘솔 출력을 Main의 콘솔로 옮김
        workerProcess.stdout?.on('data', (outputChunk: Buffer) => process.stdout.write(`[worker] ${outputChunk}`))
        workerProcess.stderr?.on('data', (errorOutputChunk: Buffer) => process.stderr.write(`[worker] ${errorOutputChunk}`))

        // 이 실행의 준비 문 (종료 처리에서 this.readyGate를 새 문으로 바꾸므로 이 실행의 것을 따로 잡아 둠)
        const readyGate = this.readyGate

        // Worker가 보낸 메시지 처리 (준비 완료 → 문을 엶, 그 밖 → 종류에 맞게 처리)
        workerProcess.on('message', (workerMessage: WorkerToMain) => {
            if (workerMessage.type === 'ready') {
                this.startFailureCount = 0
                readyGate.open()
            } else this.handleWorkerMessage(workerMessage)
        })

        // Worker 종료 처리
        workerProcess.on('exit', (exitCode) => {
            this.workerProcess = null

            // 종료된 Worker는 응답할 수 없으므로 기다리던 호출을 모두 실패로 끝냄
            const exitError = new Error('Worker가 종료됐습니다.')
            for (const pendingCall of this.pendingCalls.values()) pendingCall.reject(exitError)
            this.pendingCalls.clear()

            // 준비되기 전에 죽었으면, 준비를 기다리던 호출도 실패로 끝냄
            const diedBeforeReady = !readyGate.isSettled
            if (diedBeforeReady) readyGate.fail(exitError)

            // 앱을 끄는 중(stop 호출 뒤)이면 다시 띄우지 않음
            if (this.isStopping) return

            // 준비도 못 하고 연달아 죽으면 다시 띄워도 같은 결과이므로 그만둠
            // 이후의 호출은 기다리지 않고 바로 실패 (이유는 Worker가 남긴 오류 기록에 있음)
            if (diedBeforeReady && ++this.startFailureCount >= MAX_START_FAILURES) {
                this.options.log('worker-exit', `코드 ${exitCode}, 시작에 ${MAX_START_FAILURES}번 연달아 실패해 다시 띄우지 않음`)
                this.readyGate = createReadyGate()
                this.readyGate.fail(new Error('Worker를 시작하지 못했습니다. 진단 화면의 기록을 확인해 주세요.'))
                return
            }

            // 다시 뜰 때까지 들어오는 호출은 새 문 앞에서 대기
            this.readyGate = createReadyGate()
            this.options.log('worker-exit', `코드 ${exitCode}, ${RESTART_DELAY_MS / 1000}초 뒤 다시 시작`)

            // 잠시 뒤 다시 띄움 (기다리는 사이에 stop이 불렸으면 띄우지 않음)
            this.restartTimer = setTimeout(() => {
                this.restartTimer = null
                if (!this.isStopping) this.start()
            }, RESTART_DELAY_MS)
        })

        // 시작 값 전달 (Worker는 이 값으로 DB · 설정을 연 뒤 준비 완료를 알림)
        this.post({
            type: 'init',
            dbPath: this.options.dbPath,
            configDir: this.options.configDir,
            apiKey: this.options.getApiKey()
        })
    }

    // Worker 종료 (다시 띄우지 않음)
    stop(): void {
        // 종료 처리와 재시작 타이머가 다시 띄우지 않도록 표시하고, 예약된 재시작 취소
        this.isStopping = true
        if (this.restartTimer) clearTimeout(this.restartTimer)
        this.restartTimer = null

        // 다시 뜨기를 기다리던 호출이 영원히 멈춰 있지 않게 실패로 끝냄
        if (!this.readyGate.isSettled) this.readyGate.fail(new Error('앱을 종료하는 중입니다.'))

        // 실행 중인 Worker 종료 (실행 중이 아니면 할 일 없음)
        this.workerProcess?.kill()
    }

    // 바뀐 API 키를 실행 중인 Worker에 전달 (실행 중이 아니면 생략, 다시 뜰 때 getApiKey로 새 키를 읽음)
    setApiKey(apiKey: string | null): void {
        if (!this.workerProcess) return
        this.post({ type: 'set-api-key', apiKey })
    }

    /**
     * Worker의 기능 호출
     *
     * - Worker가 준비될 때까지 기다린 뒤 전송 (다시 뜨는 중이면 새 Worker가 준비될 때까지)
     *
     * @param {M} method - 호출할 기능 이름
     * @param params - 그 기능의 인자 (인자가 없는 기능이면 생략)
     * @returns {Promise<WorkerResult<M>>} 기능의 결과 (실패했거나 Worker가 종료되면 reject)
     */
    async call<M extends WorkerMethod>(
        method: M,
        ...params: WorkerParams<M> extends undefined ? [] : [WorkerParams<M>]
    ): Promise<WorkerResult<M>> {
        // Worker가 준비될 때까지 대기 (준비 전에 죽었거나 앱을 끄는 중이면 여기서 실패)
        await this.readyGate.opened

        // 호출 번호를 붙여 대기 목록에 올리고 전송 (응답은 handleWorkerMessage가 번호로 찾아 끝냄)
        const callId = this.nextCallId++
        return new Promise<WorkerResult<M>>((resolveCall, rejectCall) => {
            this.pendingCalls.set(callId, { resolve: resolveCall as (callResult: unknown) => void, reject: rejectCall })
            try {
                this.post({ type: 'rpc', id: callId, method, params: params[0] })
            } catch (postError) {
                // 보내지 못한 호출은 응답이 오지 않으므로 대기 목록에서 뺌
                this.pendingCalls.delete(callId)
                rejectCall(postError as Error)
            }
        })
    }

    // Worker로 메시지 전송 (실행 중이 아니면 오류)
    private post(mainMessage: MainToWorker): void {
        if (!this.workerProcess) throw new Error('Worker가 실행 중이 아닙니다.')
        this.workerProcess.postMessage(mainMessage)
    }

    // Worker가 보낸 메시지를 종류에 맞게 처리
    private handleWorkerMessage(workerMessage: WorkerToMain): void {
        switch (workerMessage.type) {
            case 'rpc-result': {
                // 호출의 응답 → 번호로 기다리던 호출을 찾아 성공 · 실패로 끝냄
                // 기다리는 호출이 없는 번호면 무시
                const pendingCall = this.pendingCalls.get(workerMessage.id)
                if (!pendingCall) return
                this.pendingCalls.delete(workerMessage.id)
                if (workerMessage.ok) pendingCall.resolve(workerMessage.result)
                else pendingCall.reject(new Error(workerMessage.error))
                break
            }
            case 'progress':
                // 브리핑 생성 진행 상황
                this.options.onProgress(workerMessage.progress)
                break
            case 'chat-delta':
                // AI 답변 조각 (완료 · 실패는 answerQuestion 호출의 응답으로 옴)
                this.options.onChatDelta(workerMessage.requestId, workerMessage.text)
                break
            case 'log':
                // 경고 · 오류는 진단 기록에, 일반 로그는 개발 중에만 콘솔에 남김
                if (workerMessage.level !== 'info') this.options.log(`worker-${workerMessage.level}`, workerMessage.message)
                else if (!app.isPackaged) console.log(`[worker] ${workerMessage.message}`)
                break
        }
    }
}
