import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { logEvent } from './diag-log'

let win: BrowserWindow | null = null
let quitting = false

export function markQuitting(): void {
  quitting = true
}

export function getWindow(): BrowserWindow | null {
  return win
}

export function createWindow(show: boolean): BrowserWindow {
  win = new BrowserWindow({
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

  win.once('ready-to-show', () => {
    if (show) win?.show()
  })

  win.webContents.on('did-finish-load', () => logEvent('window-loaded'))
  win.webContents.on('did-fail-load', (_e, code, desc) => logEvent('window-load-failed', `${code} ${desc}`))
  win.webContents.on('render-process-gone', (_e, d) => logEvent('renderer-gone', d.reason))

  // 창을 닫으면 종료하지 않고 트레이로 숨긴다.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win?.hide()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
  return win
}

export function showWindow(): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
