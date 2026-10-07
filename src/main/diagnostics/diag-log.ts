import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import type { DiagEvent } from '@shared/ipc'

// 진단 기록. 잠금/해제처럼 창을 보고 있지 않을 때 일어나는 일을 확인하려고 파일에도 남긴다.
// 기록만 맡고, 화면으로 보내는 일은 onEvent로 받은 쪽(renderer-events)이 한다.

const MAX_EVENTS = 300

export class DiagLog {
  private readonly events: DiagEvent[] = []

  constructor(
    private readonly filePath: string,
    private readonly onEvent: (e: DiagEvent) => void = () => {}
  ) {
    if (!existsSync(filePath)) return
    for (const line of readFileSync(filePath, 'utf8').trim().split('\n').slice(-MAX_EVENTS)) {
      try {
        this.events.push(JSON.parse(line) as DiagEvent)
      } catch {
        // 깨진 줄은 무시
      }
    }
  }

  /** LogFn으로 넘길 수 있게 화살표 함수로 둔다 */
  readonly log = (kind: string, detail?: string): void => {
    const e: DiagEvent = { at: new Date().toISOString(), kind, detail }
    this.events.push(e)
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
    appendFileSync(this.filePath, JSON.stringify(e) + '\n')
    this.onEvent(e)
  }

  list(): DiagEvent[] {
    return [...this.events]
  }
}
