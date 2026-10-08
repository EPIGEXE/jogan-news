import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { IPC, type Route } from '@shared/ipc'
import type { LogFn, WindowControls } from '../services/ports'

/** 앱 창 하나. 닫으면 종료하지 않고 트레이로 숨긴다 */
export class MainWindow implements WindowControls {
  private win: BrowserWindow | null = null
  private quitting = false

  constructor(private readonly log: LogFn) {}

  /** 앱을 정말 끌 때 부른다. 이후로는 창을 닫으면 숨기지 않고 닫는다 */
  markQuitting(): void {
    this.quitting = true
  }

  get browserWindow(): BrowserWindow | null {
    return this.win
  }

  create(show: boolean): void {
    const win = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 720,
      minHeight: 520,
      show: false,
      title: 'Jogan',
      autoHideMenuBar: true,
      // 기본 테두리·제목 표시줄 없이 앱이 지면 윗줄(TitleBar)과 창 버튼까지 직접 그린다 (DESIGN.md 13.10절).
      // 가장자리를 끌어 크기 조절, 윗줄 빈 곳을 끌어 이동·더블클릭 최대화는 그대로 된다
      frame: false,
      backgroundColor: '#f5f5f2',
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.win = win

    win.once('ready-to-show', () => {
      if (!show) return
      win.show()
      win.webContents.focus()
    })
    // 최대화 상태가 바뀌면 화면의 최대화/복원 버튼 모양을 바꾸게 알린다
    const sendMaximized = () => win.webContents.send(IPC.windowMaximizedChanged, win.isMaximized())
    win.on('maximize', sendMaximized)
    win.on('unmaximize', sendMaximized)
    win.webContents.on('did-finish-load', () => this.log('window-loaded'))
    win.webContents.on('did-fail-load', (_e, code, desc) => this.log('window-load-failed', `${code} ${desc}`))
    win.webContents.on('render-process-gone', (_e, d) => this.log('renderer-gone', d.reason))
    win.on('close', (e) => {
      if (!this.quitting) {
        e.preventDefault()
        win.hide()
      }
    })

    if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  minimize(): void {
    this.win?.minimize()
  }

  toggleMaximize(): void {
    const win = this.win
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  }

  /** 닫기 버튼: 앱을 끄지 않고 트레이로 숨긴다 (close 이벤트에서 숨김 처리) */
  close(): void {
    this.win?.close()
  }

  isMaximized(): boolean {
    return this.win?.isMaximized() ?? false
  }

  /** 창을 앞으로 띄운다. route를 주면 그 화면으로 이동한다 */
  show(route?: Route): void {
    const win = this.win
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    // 제목 표시줄을 앱이 그리므로 창을 띄워도 화면 내용에 키보드 초점이 바로 가지 않을 수 있다. 단축키가 바로 먹게 준다
    win.webContents.focus()
    if (route) win.webContents.send(IPC.navigate, route)
  }
}
