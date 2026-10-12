// ============================================================================
// 진단 기록
//
// [역할]
// - 앱에서 일어난 일(잠금 · 해제 · 생성 시작 등)을 메모리와 파일에 기록
// - 창을 보고 있지 않을 때 일어난 일도 나중에 확인할 수 있게 파일에 남김 (한 줄에 JSON 한 건)
// - 시작할 때 파일에서 최근 기록을 다시 읽어 옴 (깨진 줄은 무시)
// - 메모리에는 최근 300건만 둠 (넘으면 오래된 것부터 버림)
// - 파일이 끝없이 커지지 않게, 600줄을 넘으면 메모리의 최근 기록만 남기고 다시 씀
// - 기록만 담당 (화면으로 보내는 일은 onEvent로 받은 쪽이 처리)
// ============================================================================
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { DiagEvent } from '@shared/ipc'

const MAX_EVENTS = 300 // 메모리에 두는 기록 수 (넘으면 오래된 것부터 버림)
const MAX_FILE_LINES = MAX_EVENTS * 2 // 파일이 이 줄 수를 넘으면 최근 MAX_EVENTS건만 남기고 줄임

/**
 * 진단 기록 보관
 */
export class DiagLog {
    private readonly diagEvents: DiagEvent[] = [] // 최근 기록 (오래된 것이 앞)
    private fileLineCount = 0 // 파일에 쌓인 줄 수 (줄일 때를 알기 위함)

    /**
     * @param {string} filePath - 기록을 한 줄씩 덧붙이는 파일
     * @param onEvent - 새 기록이 생길 때마다 부르는 함수
     */
    constructor(
        private readonly filePath: string,
        private readonly onEvent: (diagEvent: DiagEvent) => void = () => {}
    ) {
        // 파일이 아직 없으면(첫 실행) 읽을 것 없음
        if (!existsSync(filePath)) return

        // 지난 실행에서 남긴 기록 중 최근 것만 메모리로 읽어 옴 (onEvent는 부르지 않음)
        const logLines = readFileSync(filePath, 'utf8').trim().split('\n')
        for (const logLine of logLines.slice(-MAX_EVENTS)) {
            try {
                this.diagEvents.push(JSON.parse(logLine) as DiagEvent)
            } catch {
                // 깨진 줄은 무시
            }
        }

        // 파일의 줄 수를 기억하고, 이미 너무 길면 바로 줄임
        this.fileLineCount = logLines.length
        this.compactFileIfTooLong()
    }

    // 기록 한 건 남기기 (LogFn으로 넘길 수 있게 화살표 함수로 둠)
    readonly log = (kind: string, detail?: string): void => {
        // 지금 시각을 붙여 메모리에 추가 (최대 건수를 넘으면 오래된 것부터 버림)
        const newDiagEvent: DiagEvent = { at: new Date().toISOString(), kind, detail }
        this.diagEvents.push(newDiagEvent)
        if (this.diagEvents.length > MAX_EVENTS) this.diagEvents.splice(0, this.diagEvents.length - MAX_EVENTS)

        // 파일 끝에 한 줄 덧붙이고, 너무 길어졌으면 줄임
        appendFileSync(this.filePath, JSON.stringify(newDiagEvent) + '\n')
        this.fileLineCount++
        this.compactFileIfTooLong()

        // 새 기록을 받는 쪽에 전달 (진단 화면에 바로 보이게 하는 용도)
        this.onEvent(newDiagEvent)
    }

    // 파일이 너무 길어졌으면 메모리에 있는 최근 기록만 남기고 다시 씀
    private compactFileIfTooLong(): void {
        // 아직 한도를 넘지 않았으면 그대로 둠
        if (this.fileLineCount <= MAX_FILE_LINES) return

        // 메모리의 기록으로 파일 전체를 다시 쓰고 줄 수를 맞춤
        writeFileSync(this.filePath, this.diagEvents.map((diagEvent) => JSON.stringify(diagEvent) + '\n').join(''))
        this.fileLineCount = this.diagEvents.length
    }

    // 지금까지의 기록 복사본 (받은 쪽이 고쳐도 원본은 그대로)
    listEvents(): DiagEvent[] {
        return [...this.diagEvents]
    }
}
