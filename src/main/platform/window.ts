import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { IPC, type Route } from '@shared/ipc'
import type { LogFn } from '../services/ports'

/** 앱 창 하나. 닫으면 종료하지 않고 트레이로 숨긴다 */
export class MainWindow {
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
      width: 1100,
      height: 800,
      minWidth: 720,
      minHeight: 520,
      show: false,
      title: 'AI 브리핑',
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.win = win

    win.once('ready-to-show', () => {
      if (show) win.show()
    })
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

  /** 창을 앞으로 띄운다. route를 주면 그 화면으로 이동한다 */
  show(route?: Route): void {
    const win = this.win
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (route) win.webContents.send(IPC.navigate, route)
  }
}
