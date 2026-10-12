// ============================================================================
// 앱 창
//
// [역할]
// - 앱 창 하나를 만들고 화면(renderer)을 불러옴 (개발 중에는 개발 서버, 아니면 빌드된 파일)
// - 기본 테두리 · 제목 표시줄 없이 만들고, 화면이 그린 제목 표시줄의 창 버튼(최소화 · 최대화 · 닫기) 처리 (DESIGN.md 13.10절)
// - 창을 닫으면 앱을 끄지 않고 트레이로 숨김 (앱을 끄는 중일 때만 실제로 닫음)
// - 최대화 상태가 바뀌면 화면에 알림 (최대화 · 복원 버튼 모양 전환용)
// - 창을 앞으로 띄우고 원하는 화면으로 이동
// - 화면 불러오기 완료 · 실패, 화면 프로세스 종료를 진단 기록에 남김
// - 창이 없을 때(만들기 전 · 실제로 닫힌 뒤)의 호출은 아무 일도 하지 않음
// ============================================================================
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { IPC, type Route } from '@shared/ipc'
import type { LogFn, WindowControls } from '../services/ports'

/**
 * 앱 창 하나
 *
 * - 닫으면 종료하지 않고 트레이로 숨김
 */
export class MainWindow implements WindowControls {
    private createdWindow: BrowserWindow | null = null // create() 전이거나 창이 실제로 닫힌 뒤에는 null
    private isQuitting = false // true면 창을 닫을 때 숨기지 않고 정말 닫음

    constructor(private readonly log: LogFn) {}

    // 앱을 정말 끌 때 호출 (이후로는 창을 닫으면 숨기지 않고 닫음)
    markQuitting(): void {
        this.isQuitting = true
    }

    // 만들어 둔 창 (없으면 null)
    get browserWindow(): BrowserWindow | null {
        return this.createdWindow
    }

    /**
     * 창을 만들고 화면 불러오기
     *
     * @param {boolean} shouldShow - false면 만들기만 하고 보이지 않게 둠
     */
    create(shouldShow: boolean): void {
        // 창 만들기 (화면이 그려질 때까지 보이지 않게 만듦)
        const browserWindow = new BrowserWindow({
            width: 1280,
            height: 860,
            minWidth: 720,
            minHeight: 520,
            show: false,
            title: 'Jogan',
            autoHideMenuBar: true,
            // 기본 테두리 · 제목 표시줄 없이 앱이 지면 윗줄(TitleBar)과 창 버튼까지 직접 그림 (DESIGN.md 13.10절)
            // 가장자리를 끌어 크기 조절, 윗줄 빈 곳을 끌어 이동 · 더블클릭 최대화는 그대로 동작
            frame: false,
            backgroundColor: '#f5f5f2',
            webPreferences: {
                preload: join(import.meta.dirname, '../preload/index.cjs'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true
            }
        })
        this.createdWindow = browserWindow

        // 화면이 그려질 준비가 되면 창을 보이고 화면 내용에 키보드 초점을 줌
        browserWindow.once('ready-to-show', () => {
            // 숨김 시작(자동 시작)이면 만들어만 두고 보이지 않음
            if (!shouldShow) return
            browserWindow.show()
            browserWindow.webContents.focus()
        })

        // 최대화 상태가 바뀌면 화면의 최대화 · 복원 버튼 모양을 바꾸도록 알림
        const sendMaximizedState = () => browserWindow.webContents.send(IPC.windowMaximizedChanged, browserWindow.isMaximized())
        browserWindow.on('maximize', sendMaximizedState)
        browserWindow.on('unmaximize', sendMaximizedState)

        // 화면 불러오기 완료 · 실패, 화면 프로세스 종료를 진단 기록에 남김
        browserWindow.webContents.on('did-finish-load', () => this.log('window-loaded'))
        browserWindow.webContents.on('did-fail-load', (_loadEvent, errorCode, errorDescription) =>
            this.log('window-load-failed', `${errorCode} ${errorDescription}`)
        )
        browserWindow.webContents.on('render-process-gone', (_goneEvent, goneDetails) => this.log('renderer-gone', goneDetails.reason))

        // 앱을 끄는 중이 아니면 닫지 않고 숨김
        browserWindow.on('close', (closeEvent) => {
            if (!this.isQuitting) {
                closeEvent.preventDefault()
                browserWindow.hide()
            }
        })

        // 실제로 닫힌 창은 더 쓸 수 없으므로 참조를 비움 (이후의 show · minimize 호출은 아무 일도 하지 않음)
        browserWindow.on('closed', () => {
            if (this.createdWindow === browserWindow) this.createdWindow = null
        })

        // 개발 중에는 개발 서버 주소, 아니면 빌드된 파일
        if (process.env['ELECTRON_RENDERER_URL']) void browserWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
        else void browserWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
    }

    // 최소화 버튼
    minimize(): void {
        this.createdWindow?.minimize()
    }

    // 최대화되어 있으면 원래 크기로, 아니면 최대화
    toggleMaximize(): void {
        const browserWindow = this.createdWindow
        if (!browserWindow) return
        if (browserWindow.isMaximized()) browserWindow.unmaximize()
        else browserWindow.maximize()
    }

    // 닫기 버튼 (앱을 끄지 않고 트레이로 숨김, close 이벤트에서 숨김 처리)
    close(): void {
        this.createdWindow?.close()
    }

    // 지금 최대화되어 있는지 (창이 없으면 false)
    isMaximized(): boolean {
        return this.createdWindow?.isMaximized() ?? false
    }

    /**
     * 창을 앞으로 띄우기
     *
     * @param {Route} [route] - 주면 그 화면으로 이동
     */
    show(route?: Route): void {
        // 창이 없으면(만들기 전 · 실제로 닫힌 뒤) 아무 일도 하지 않음
        const browserWindow = this.createdWindow
        if (!browserWindow) return

        // 최소화 · 숨김 상태에서 꺼내 앞으로 가져옴
        if (browserWindow.isMinimized()) browserWindow.restore()
        browserWindow.show()
        browserWindow.focus()

        // 제목 표시줄을 앱이 그리므로 창을 띄워도 화면 내용에 키보드 초점이 바로 가지 않을 수 있음
        // 단축키가 바로 먹도록 화면 내용에 초점을 줌
        browserWindow.webContents.focus()

        // 갈 화면을 받았으면 화면에 이동 요청
        if (route) browserWindow.webContents.send(IPC.navigate, route)
    }
}
