import { writeFileSync } from 'node:fs'
import { app } from 'electron'
import type { Route } from '@shared/ipc'
import type { MainWindow } from '../platform/window'

/**
 * 개발용: 창을 그린 뒤 화면을 PNG로 저장하고 종료한다 (화면 확인 자동화).
 * AINEWS_SCREENSHOT=<파일.png>, AINEWS_ROUTE=<시작 화면>. 설치판에서는 쓰지 않는다.
 */
export function captureAndQuit(window: MainWindow, path: string, route?: Route): void {
  const win = window.browserWindow
  if (!win) return
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (route) window.show(route)
      setTimeout(async () => {
        writeFileSync(path, (await win.webContents.capturePage()).toPNG())
        app.quit()
      }, 1500)
    }, 2500)
  })
}
