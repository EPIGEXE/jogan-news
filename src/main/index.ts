import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, globalShortcut } from 'electron'
import type { TriggerReason } from '@shared/schedule'
import { IPC, type Route } from '@shared/ipc'
import { broadcast, broadcastProgress, generateBriefing } from './briefing'
import { logEvent } from './diag-log'
import { registerIpc } from './ipc'
import { showNotification } from './notify'
import { getApiKey } from './secrets'
import { createTray } from './tray'
import { fire, startTriggers, type TriggerDeps } from './triggers'
import { createWindow, getWindow, markQuitting, showWindow } from './window'
import { WorkerHost } from './worker-host'

const APP_ID = 'com.ainews.desktop'
const SHORTCUT = 'Control+Alt+N'

// 개발용: 별도 데이터 폴더로 실행 (스크린샷 확인 등). 설치판에서는 무시한다.
if (!app.isPackaged && process.env['AINEWS_USER_DATA']) app.setPath('userData', process.env['AINEWS_USER_DATA'])

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => openWindow())
  app.whenReady().then(main)
}

let worker: WorkerHost

function openWindow(route?: Route): void {
  showWindow()
  if (route) getWindow()?.webContents.send(IPC.navigate, route)
}

function configDir(): string {
  // 설치판은 resources/config, 개발 중에는 프로젝트의 config 폴더
  return app.isPackaged ? join(process.resourcesPath, 'config') : join(app.getAppPath(), 'config')
}

function generate(reason: TriggerReason): Promise<void> {
  return generateBriefing(worker, reason, openWindow)
}

function testNotification(): void {
  showNotification('알림 테스트', '이 알림을 클릭하면 앱 창이 열려야 합니다', () => openWindow())
}

function main(): void {
  app.setAppUserModelId(APP_ID)
  const hidden = process.argv.includes('--hidden')

  worker = new WorkerHost({
    dbPath: join(app.getPath('userData'), 'ainews.db'),
    configDir: configDir(),
    getApiKey,
    onProgress: broadcastProgress,
    onItemUpdated: (itemId) => broadcast(IPC.itemUpdated, itemId)
  })
  worker.start()

  const triggerDeps: TriggerDeps = {
    getLastDigestDate: () => worker.call('getLastDigestDate'),
    generate
  }

  registerIpc({ worker, runNow: () => void fire('manual', triggerDeps), testNotification })
  createWindow(!hidden)
  createTray({
    openWindow: () => openWindow('today'),
    testNotification,
    manualTrigger: () => void fire('manual', triggerDeps)
  })

  if (!globalShortcut.register(SHORTCUT, () => openWindow())) {
    logEvent('shortcut-failed', `${SHORTCUT} 등록 실패 (다른 프로그램이 사용 중일 수 있음)`)
  }

  if (!app.isPackaged && process.env['AINEWS_SCREENSHOT']) captureAndQuit(process.env['AINEWS_SCREENSHOT'])

  logEvent('ready', hidden ? '숨김 모드로 시작 (자동 시작)' : '일반 시작')
  startTriggers(triggerDeps)
  broadcast(IPC.digestUpdated)
}

/** 개발용: 창을 그린 뒤 화면을 PNG로 저장하고 종료한다. AINEWS_ROUTE로 시작 화면을 고른다. */
function captureAndQuit(path: string): void {
  const win = getWindow()
  if (!win) return
  win.webContents.once('did-finish-load', () => {
    const route = process.env['AINEWS_ROUTE'] as Route | undefined
    setTimeout(() => {
      if (route) win.webContents.send(IPC.navigate, route)
      setTimeout(async () => {
        writeFileSync(path, (await win.webContents.capturePage()).toPNG())
        app.quit()
      }, 1500)
    }, 2500)
  })
}

app.on('before-quit', () => {
  markQuitting()
  worker?.stop()
})
app.on('will-quit', () => globalShortcut.unregisterAll())
// 창을 모두 닫아도 트레이에 남아 있도록 기본 종료 동작을 막는다.
app.on('window-all-closed', () => {})
