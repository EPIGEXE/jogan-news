// ============================================================================
// Main 프로세스 진입점
//
// [역할]
// - 앱이 켜질 때 필요한 객체를 만들고 서로 연결 (조립만 담당)
// - 흐름은 services/, Electron 기능은 platform/, 들어오는 요청은 ipc/(화면) · triggers/(OS 이벤트)에 위임
// - 앱은 한 개만 실행: 한 번 더 실행하면 새로 뜬 쪽은 바로 끝나고, 이미 떠 있는 쪽이 창을 엶
// - 창을 모두 닫아도 트레이에 남음 (완전히 끄는 것은 트레이 메뉴의 "종료")
// - 자동 시작(--hidden)으로 켜지면 창을 보이지 않게 만들고 트레이에만 머묾
// - 데이터 폴더는 예전 이름(AINews)을 그대로 사용 (저장한 기사 · 메모 · 설정 유지)
// - 조립 중에 실패하면 이유를 오류 창으로 알리고 종료
// - 종료할 때 창 · 생성 트리거 · 수집 타이머 · Worker 정리
// ============================================================================

import { join } from 'node:path'
import { app, dialog } from 'electron'
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
import { BriefingTriggers } from './triggers/briefing-triggers'

const APP_ID = 'com.ainews.desktop' // Windows가 알림 · 작업 표시줄에서 이 앱을 구분하는 이름
const OPEN_WINDOW_SHORTCUT = 'Control+Alt+N' // 어디서든 창을 여는 전역 단축키

// 표시 이름은 Jogan이지만 데이터 폴더는 예전 이름(%APPDATA%\AINews)을 그대로 사용
// (이름을 바꿨다고 저장한 기사 · 메모 · 설정이 새 폴더로 갈라지지 않게 함)
app.setPath('userData', join(app.getPath('appData'), 'AINews'))
// 개발용: 별도 데이터 폴더로 실행 (스크린샷 확인 등). 설치판에서는 무시
if (!app.isPackaged && process.env['AINEWS_USER_DATA']) app.setPath('userData', process.env['AINEWS_USER_DATA'])

let cleanUpBeforeQuit: (() => void) | null = null // 종료 직전에 부를 정리 함수 (조립이 끝나기 전에는 null)

// 이미 실행 중이면 새로 뜬 쪽은 바로 종료
if (!app.requestSingleInstanceLock()) {
    app.quit()
} else {
    // 처음 뜬 쪽 → Electron이 준비되면 조립하고 시작
    app.whenReady()
        .then(assembleAndStart)
        .catch((startupError: unknown) => {
            // 조립 중에 실패하면 창 · 트레이 없이 프로세스만 남으므로, 이유를 알리고 종료
            const startupErrorMessage = startupError instanceof Error ? (startupError.stack ?? startupError.message) : String(startupError)
            console.error(startupErrorMessage)
            dialog.showErrorBox('Jogan을 시작하지 못했습니다', startupErrorMessage)
            app.exit(1)
        })
}

// 수집 소스 · 프롬프트 등 설정 파일이 있는 폴더 (설치판은 resources/config, 개발 중에는 프로젝트의 config 폴더)
function resolveConfigDir(): string {
    return app.isPackaged ? join(process.resourcesPath, 'config') : join(app.getAppPath(), 'config')
}

// 앱에 필요한 객체를 만들어 연결하고 시작
function assembleAndStart(): void {
    // Windows 알림이 이 앱의 것으로 뜨도록 앱 ID 지정 (DESIGN.md 5절)
    app.setAppUserModelId(APP_ID)
    const startsHidden = process.argv.includes('--hidden') // 자동 시작으로 켜진 경우 (창을 띄우지 않음)

    // =============================== 바깥 기능 (platform) ===================================
    // 화면으로 보내는 알림과 진단 기록 (새 기록이 생길 때마다 화면에도 전달)
    const rendererEvents = new BroadcastEvents()
    const diagLog = new DiagLog(join(app.getPath('userData'), 'diagnostics.log'), (diagEvent) => rendererEvents.diagEvent(diagEvent))
    const log = diagLog.log // 진단 기록 남기기 (아래 객체들에 넘겨 줌)

    // 앱 창 (아직 만들지는 않음, 아래 "시작"에서 생성)
    const mainWindow = new MainWindow(log)
    const openWindow = (route?: Route) => mainWindow.show(route) // 창을 앞으로 띄우기 (route를 주면 그 화면으로 이동)

    // API 키 보관과 Windows 자동 시작
    const apiKeyStore = new SafeStorageKeyStore()
    const autostart = new LoginItemAutostart(log)

    // Worker 호출 (Worker가 보내는 생성 진행 · 기사 변경 · 답변 조각은 그대로 화면에 전달)
    const workerClient = new WorkerClient({
        dbPath: join(app.getPath('userData'), 'ainews.db'),
        configDir: resolveConfigDir(),
        getApiKey: () => apiKeyStore.getApiKey(), // Worker를 띄울 때마다 지금 쓸 키를 읽음
        onProgress: (runProgress) => rendererEvents.runProgress(runProgress),
        onItemUpdated: (itemId) => rendererEvents.itemUpdated(itemId),
        onChatEvent: (chatEvent) => rendererEvents.chatEvent(chatEvent),
        log
    })

    // 트레이와 알림은 서로를 참조 (알림 클릭 시 트레이 상태 초기화, 트레이 메뉴에서 새로고침 · 알림 테스트)
    // 그래서 트레이를 먼저 만들고, 트레이 메뉴 동작은 아래에서 만들어질 객체를 늦게 호출
    let powerTriggers: BriefingTriggers | null = null // 아래 "들어오는 쪽"에서 생성 (그 전에는 null)
    let briefingNotifications: BriefingNotifications | null = null // 트레이를 만든 바로 뒤에 생성
    const trayController = new TrayController(
        {
            openToday: () => openWindow('today'),
            // 생성을 시작하지 않았으면(오늘 브리핑이 이미 있음 등) 만들지 않고 오늘 화면 열기
            runBriefingNow: () => void powerTriggers?.checkAndGenerate('manual').then((hasStarted) => !hasStarted && openWindow('today')),
            testNotification: () => briefingNotifications?.showTestNotification(),
            quit: () => app.quit()
        },
        autostart
    )
    briefingNotifications = new BriefingNotifications(new DesktopNotifier(log), openWindow, trayController)

    // =============================== 서비스 ===================================
    // 서비스는 Electron을 모르고, 위에서 만든 바깥 기능을 포트(services/ports.ts)로 받음
    const contentService = new ContentService(workerClient)
    const settingsService = new SettingsService({ keys: apiKeyStore, autostart, worker: workerClient })
    const chatService = new ChatService(workerClient)
    const electronNetwork = new ElectronNetwork()
    const briefingService = new BriefingService({
        network: electronNetwork,
        status: trayController, // 앱 상태는 트레이 아이콘으로 표시
        notifier: briefingNotifications,
        worker: workerClient,
        events: rendererEvents,
        log
    })

    // =============================== 들어오는 쪽 (OS 이벤트 · 화면 요청) ===================================
    // 브리핑 생성 트리거 (앱 시작 · 잠금 해제 · 절전 복귀 · 오전 타이머 · 수동 요청)
    powerTriggers = new BriefingTriggers({
        getLastDigestDate: () => contentService.getLastDigestDate(),
        generate: (reason: TriggerReason) => briefingService.generate(reason),
        log
    })

    // 낮 동안 2시간마다 미리 수집하는 타이머
    const collectTimer = new CollectTimer({
        collect: () => contentService.collectOnly(),
        isOnline: () => electronNetwork.isOnline(),
        log
    })

    // 진단 화면용 기능
    const diagnosticsService = new DiagnosticsService({
        listEvents: () => diagLog.listEvents(),
        testNotification: () => briefingNotifications?.showTestNotification(),
        runNetworkChecks,
        nextTimerAt: () => powerTriggers?.nextMorningTimerAt ?? null,
        isPackaged: app.isPackaged,
        content: contentService
    })

    // 화면 요청 핸들러 등록
    registerIpc({
        content: contentService,
        briefing: briefingService,
        chat: chatService,
        settings: settingsService,
        diagnostics: diagnosticsService,
        // 화면의 "지금 만들기"도 트리거를 거침 (오늘 브리핑이 이미 있으면 시작하지 않고 false)
        runNow: () => powerTriggers?.checkAndGenerate('manual') ?? Promise.resolve(false),
        openExternal: openExternalUrl,
        window: mainWindow
    })

    // =============================== 시작 ===================================
    // Worker · 창 · 트레이 띄우기 (자동 시작이면 창은 만들기만 하고 보이지 않게 둠)
    workerClient.start()
    mainWindow.create(!startsHidden)
    trayController.create()

    // 창을 여는 다른 길: 전역 단축키, 앱을 한 번 더 실행
    registerShortcut(OPEN_WINDOW_SHORTCUT, () => openWindow(), log)
    app.on('second-instance', () => openWindow()) // 앱을 한 번 더 실행하면 이미 떠 있는 창 열기

    // 개발용: 화면을 PNG로 저장하고 종료 (설치판에서는 무시)
    if (!app.isPackaged && process.env['AINEWS_SCREENSHOT']) {
        captureAndQuit(
            mainWindow,
            process.env['AINEWS_SCREENSHOT'],
            process.env['AINEWS_ROUTE'] as Route | undefined,
            process.env['AINEWS_KEYS']?.split(',').filter(Boolean)
        )
    }

    // 생성 트리거와 수집 타이머 시작
    log('ready', startsHidden ? '숨김 모드로 시작 (자동 시작)' : '일반 시작')
    powerTriggers.start() // 1분 뒤 시작 트리거 확인, 잠금 · 절전 이벤트와 오전 타이머 연결
    collectTimer.start() // 10분마다 수집할 때가 됐는지 확인
    rendererEvents.digestUpdated() // 열려 있는 창에 브리핑이 바뀌었다고 알림

    // 종료 직전 정리 등록 (조립이 끝난 뒤에만 부를 수 있음)
    cleanUpBeforeQuit = () => {
        mainWindow.markQuitting() // 이후로는 창을 닫으면 숨기지 않고 정말 닫음
        powerTriggers?.stop()
        collectTimer.stop()
        workerClient.stop() // Worker 종료 (다시 띄우지 않음)
    }
}

// 종료 직전: 창 · 트리거 · 타이머 · Worker 정리 (조립이 끝나기 전이면 할 것 없음)
app.on('before-quit', () => cleanUpBeforeQuit?.())
// 종료 확정: 전역 단축키 해제
app.on('will-quit', () => unregisterShortcuts())
// 창을 모두 닫아도 트레이에 남아 있도록 기본 종료 동작 차단
app.on('window-all-closed', () => {})
