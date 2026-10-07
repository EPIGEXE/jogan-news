import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { IPC, type DiagEvent } from '@shared/ipc'

// 0단계 진단용 이벤트 기록. 잠금/해제처럼 창을 보고 있지 않을 때 일어나는 일을 확인하려고 파일에도 남긴다.

const MAX_EVENTS = 300
let events: DiagEvent[] | null = null

function logPath(): string {
  return join(app.getPath('userData'), 'diagnostics.log')
}

function load(): DiagEvent[] {
  if (events) return events
  events = []
  if (existsSync(logPath())) {
    const lines = readFileSync(logPath(), 'utf8').trim().split('\n').slice(-MAX_EVENTS)
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as DiagEvent)
      } catch {
        // 깨진 줄은 무시
      }
    }
  }
  return events
}

export function logEvent(kind: string, detail?: string): void {
  const e: DiagEvent = { at: new Date().toISOString(), kind, detail }
  const list = load()
  list.push(e)
  if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS)
  appendFileSync(logPath(), JSON.stringify(e) + '\n')
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.event, e)
}

export function getEvents(): DiagEvent[] {
  return [...load()]
}
