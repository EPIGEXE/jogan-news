import { BrowserWindow } from 'electron'
import type { TriggerReason } from '@shared/schedule'
import { IPC, type Route } from '@shared/ipc'
import type { RunProgress } from '@shared/types'
import { logEvent } from './diag-log'
import { waitForNetwork } from './network'
import { showNotification } from './notify'
import { setTrayState } from './tray'
import type { WorkerHost } from './worker-host'

// 브리핑 생성 흐름 (DESIGN.md 4.2절): 네트워크 확인 → 트레이 "생성 중" → Worker 실행 → 알림.

let running = false

export function isRunning(): boolean {
  return running
}

export function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, ...args)
}

export function broadcastProgress(p: RunProgress): void {
  broadcast(IPC.progress, p)
}

function shortDate(d: Date): string {
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`
}

export async function generateBriefing(
  worker: WorkerHost,
  reason: TriggerReason,
  openWindow: (route?: Route) => void
): Promise<void> {
  if (running) {
    logEvent('generate-skip', '이미 생성 중')
    return
  }
  running = true
  try {
    const online = await waitForNetwork(() => {
      setTrayState('offline')
      broadcastProgress({ stage: 'collect', message: '네트워크 연결을 기다리는 중' })
    })
    if (!online) {
      setTrayState('offline')
      broadcastProgress({ stage: 'error', message: '네트워크에 연결할 수 없습니다. 다음 로그인·잠금 해제 때 다시 시도합니다.' })
      logEvent('generate-offline', '5분 동안 연결되지 않아 중단')
      return
    }

    setTrayState('busy')
    logEvent('generate-start', reason)
    const r = await worker.call('runPipeline', { reason })
    logEvent('generate-done', `${r.entries}건 · $${r.costUsd.toFixed(4)}`)
    setTrayState('new')
    broadcast(IPC.digestUpdated)
    showNotification(`📰 AI 브리핑 · ${shortDate(new Date())}`, r.headline, () => {
      openWindow('today')
      setTrayState('idle')
    })
  } catch (err) {
    const message = (err as Error).message
    logEvent('generate-failed', message)
    setTrayState('error')
    broadcastProgress({ stage: 'error', message })
    showNotification('브리핑 생성 실패', message, () => openWindow('settings'))
  } finally {
    running = false
  }
}
