// Main 프로세스 진입점이자 조립 지점(composition root).
// 여기서는 객체를 만들고 서로 연결만 한다. 흐름은 services/, Electron 기능은 platform/,
// 바깥에서 들어오는 요청은 ipc/(화면)와 triggers/(OS 이벤트)에 있다.

import { join } from 'node:path'
import { app } from 'electron'
import type { Route } from '@shared/ipc'
import type { TriggerReason } from '@shared/schedule'
import { captureAndQuit } from './diagnostics/dev-screenshot'
import { DiagLog } from './diagnostics/diag-log'
import { registerIpc } from './ipc'
import { LoginItemAutostart } from './platform/autostart'
import { runNetworkChecks } from './platform/netcheck'
import { ElectronNetwork } from './platform/network'
import { BriefingNotifications, DesktopNotifier } from './platform/notifier'
import { BroadcastEvents } from './platform/renderer-events'
import { SafeStorageKeyStore } from './platform/secrets'
import { openExternalUrl, registerShortcut, unregisterShortcuts } from './platform/system'
import { TrayController } from './platform/tray/tray'
import { MainWindow } from './platform/window'
import { WorkerClient } from './platform/worker-client'
import { BriefingService } from './services/briefing-service'
import { ChatService } from './services/chat-service'
import { ContentService } from './services/content-service'
import { DiagnosticsService } from './services/diagnostics-service'
import { SettingsService } from './services/settings-service'
import { CollectTimer } from './triggers/collect-timer'
import { PowerTriggers } from './triggers/power-triggers'

const APP_ID = 'com.ainews.desktop'
const SHORTCUT = 'Control+Alt+N'

// 표시 이름은 Jogan이지만 데이터 폴더는 예전 이름(%APPDATA%\AINews)을 그대로 쓴다.
// 이름을 바꿨다고 저장한 기사·메모·설정이 새 폴더로 갈라지지 않게 한다.
app.setPath('userData', join(app.getPath('appData'), 'AINews'))
// 개발용: 별도 데이터 폴더로 실행 (스크린샷 확인 등). 설치판에서는 무시한다.
if (!app.isPackaged && process.env['AINEWS_USER_DATA']) app.setPath('userData', process.env['AINEWS_USER_DATA'])

let stop: (() => void) | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(main)
}

function configDir(): string {
  // 설치판은 resources/config, 개발 중에는 프로젝트의 config 폴더
  return app.isPackaged ? join(process.resourcesPath, 'config') : join(app.getAppPath(), 'config')
}

function main(): void {
  app.setAppUserModelId(APP_ID)
  const hidden = process.argv.includes('--hidden')

  // ── 바깥 기능 (platform) ──
  const events = new BroadcastEvents()
  const diag = new DiagLog(join(app.getPath('userData'), 'diagnostics.log'), (e) => events.diagEvent(e))
  const log = diag.log
  const window = new MainWindow(log)
  const openWindow = (route?: Route) => window.show(route)
  const keys = new SafeStorageKeyStore()
  const autostart = new LoginItemAutostart(log)
  autostart.migrateRenamedExe()
  const worker = new WorkerClient({
    dbPath: join(app.getPath('userData'), 'ainews.db'),
    configDir: configDir(),
    getApiKey: () => keys.get(),
    onProgress: (p) => events.progress(p),
    onItemUpdated: (itemId) => events.itemUpdated(itemId),
    onChatEvent: (event) => events.chat(event),
    log
  })

  // 트레이와 알림은 서로를 참조한다(알림 클릭 → 트레이 상태 초기화, 트레이 메뉴 → 새로고침·알림 테스트).
  // 그래서 트레이를 먼저 만들고, 트레이 메뉴 동작은 아래에서 만들어질 객체를 늦게 부른다.
  let triggers: PowerTriggers | null = null
  let notifications: BriefingNotifications | null = null
  const tray = new TrayController(
    {
      openToday: () => openWindow('today'),
      // 오늘 브리핑이 이미 있으면 만들지 않고 창을 연다
      refresh: () => void triggers?.fire('manual').then((started) => !started && openWindow('today')),
      testNotification: () => notifications?.test(),
      quit: () => app.quit()
    },
    autostart
  )
  notifications = new BriefingNotifications(new DesktopNotifier(log), openWindow, tray)

  // ── 서비스 ──
  const content = new ContentService(worker)
  const settings = new SettingsService({ keys, autostart, worker })
  const chat = new ChatService(worker)
  const network = new ElectronNetwork()
  const briefing = new BriefingService({
    network,
    status: tray,
    notifier: notifications,
    worker,
    events,
    log
  })

  // ── 들어오는 쪽 (OS 이벤트, 화면 요청) ──
  triggers = new PowerTriggers({
    getLastDigestDate: () => content.getLastDigestDate(),
    generate: (reason: TriggerReason) => briefing.generate(reason),
    log
  })
  const collectTimer = new CollectTimer({
    collect: () => content.collectOnly(),
    isOnline: () => network.isOnline(),
    log
  })
  const diagnostics = new DiagnosticsService({
    listEvents: () => diag.list(),
    testNotification: () => notifications?.test(),
    runNetworkChecks,
    nextTimerAt: () => triggers?.nextTimerAt ?? null,
    isPackaged: app.isPackaged,
    content
  })
  registerIpc({
    content,
    briefing,
    chat,
    settings,
    diagnostics,
    runNow: () => triggers?.fire('manual') ?? Promise.resolve(false),
    openExternal: openExternalUrl,
    window
  })

  // ── 시작 ──
  worker.start()
  window.create(!hidden)
  tray.create()
  registerShortcut(SHORTCUT, () => openWindow(), log)
  app.on('second-instance', () => openWindow())

  if (!app.isPackaged && process.env['AINEWS_SCREENSHOT']) {
    captureAndQuit(
      window,
      process.env['AINEWS_SCREENSHOT'],
      process.env['AINEWS_ROUTE'] as Route | undefined,
      process.env['AINEWS_KEYS']?.split(',').filter(Boolean)
    )
  }

  log('ready', hidden ? '숨김 모드로 시작 (자동 시작)' : '일반 시작')
  triggers.start()
  collectTimer.start()
  events.digestUpdated()

  stop = () => {
    window.markQuitting()
    collectTimer.stop()
    worker.stop()
  }
}

app.on('before-quit', () => stop?.())
app.on('will-quit', () => unregisterShortcuts())
// 창을 모두 닫아도 트레이에 남아 있도록 기본 종료 동작을 막는다.
app.on('window-all-closed', () => {})
