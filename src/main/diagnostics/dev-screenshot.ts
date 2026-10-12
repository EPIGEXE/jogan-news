import { writeFileSync } from 'node:fs'
import { app } from 'electron'
import type { Route } from '@shared/ipc'
import type { MainWindow } from '../platform/window'

/**
 * 개발용: 창을 그린 뒤 화면을 PNG로 저장하고 종료한다 (화면 확인 자동화).
 * AINEWS_SCREENSHOT=<파일.png>, AINEWS_ROUTE=<시작 화면>, AINEWS_KEYS=<쉼표로 구분한 키, 예: Enter,j,wheel:800,click:900:120,drag:804:400:600,move:400:420,alt+Left>.
 * AINEWS_SIZE=<너비x높이>로 창 크기를 바꿀 수 있다. 설치판에서는 쓰지 않는다.
 */
export function captureAndQuit(window: MainWindow, path: string, route?: Route, keys: string[] = []): void {
  const win = window.browserWindow
  if (!win) return
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  win.webContents.once('did-finish-load', async () => {
    // AINEWS_SIZE=1920x1050 → 그 창 크기로 확인
    const size = /^(\d+)x(\d+)$/.exec(process.env['AINEWS_SIZE'] ?? '')
    if (size) win.setContentSize(Number(size[1]), Number(size[2]))
    await wait(2500)
    if (route) window.show(route)
    await wait(1200)
    for (const key of keys) {
      // wheel:N → 창 가운데에서 아래로 N픽셀 스크롤
      const wheel = /^wheel:(-?\d+)$/.exec(key)
      if (wheel) {
        const [w, h] = win.getContentSize()
        win.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(w! / 2), y: Math.round(h! / 2), deltaX: 0, deltaY: -Number(wheel[1]) })
        await wait(500)
        continue
      }
      // drag:X1:Y:X2 → (X1, Y)에서 X2까지 가로로 끎
      const drag = /^drag:(\d+):(\d+):(\d+)$/.exec(key)
      if (drag) {
        const [x1, y, x2] = [Number(drag[1]), Number(drag[2]), Number(drag[3])]
        win.webContents.sendInputEvent({ type: 'mouseDown', x: x1, y, button: 'left', clickCount: 1 })
        for (let i = 1; i <= 10; i++) {
          win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x1 + ((x2 - x1) * i) / 10), y, button: 'left' })
          await wait(30)
        }
        win.webContents.sendInputEvent({ type: 'mouseUp', x: x2, y, button: 'left', clickCount: 1 })
        await wait(500)
        continue
      }
      // move:X:Y → 마우스를 그 위치로 옮김 (마우스를 올렸을 때 모습 확인)
      const move = /^move:(\d+):(\d+)$/.exec(key)
      if (move) {
        win.webContents.sendInputEvent({ type: 'mouseMove', x: Number(move[1]), y: Number(move[2]) })
        await wait(800)
        continue
      }
      // click:X:Y → 그 위치를 마우스로 누름
      const click = /^click:(\d+):(\d+)$/.exec(key)
      if (click) {
        const [x, y] = [Number(click[1]), Number(click[2])]
        win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
        win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
        await wait(500)
        continue
      }
      // alt+Left → Alt를 누른 채 그 키 (뒤로 · 앞으로 확인)
      const alt = /^alt\+(.+)$/.exec(key)
      if (alt) {
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: alt[1]!, modifiers: ['alt'] })
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: alt[1]!, modifiers: ['alt'] })
        await wait(500)
        continue
      }
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key })
      if (key.length === 1) win.webContents.sendInputEvent({ type: 'char', keyCode: key })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key })
      await wait(500)
    }
    await wait(1500)
    writeFileSync(path, (await win.webContents.capturePage()).toPNG())
    app.quit()
  })
}
