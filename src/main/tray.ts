import { app, Menu, Tray } from 'electron'
import { isAutostartEnabled, setAutostart } from './autostart'
import { trayIcon, type TrayState } from './tray-icon'

const STATE_LABEL: Record<TrayState, string> = {
  idle: '대기 중',
  busy: '브리핑 생성 중…',
  new: '새 브리핑 도착',
  offline: '오프라인',
  error: '오류 발생'
}

export interface TrayActions {
  openWindow(): void
  testNotification(): void
  manualTrigger(): void
}

let tray: Tray | null = null
let actions: TrayActions | null = null
let current: TrayState = 'idle'

function rebuildMenu(): void {
  if (!tray || !actions) return
  const a = actions
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `AI 브리핑 · ${STATE_LABEL[current]}`, enabled: false },
      { type: 'separator' },
      { label: '오늘 브리핑 열기', click: () => a.openWindow() },
      { label: '지금 새로고침', click: () => a.manualTrigger() },
      { label: '알림 테스트', click: () => a.testNotification() },
      { type: 'separator' },
      {
        label: 'Windows 시작 시 실행',
        type: 'checkbox',
        checked: isAutostartEnabled(),
        click: (item) => {
          setAutostart(item.checked)
          rebuildMenu()
        }
      },
      { type: 'separator' },
      { label: '종료', click: () => app.quit() }
    ])
  )
}

export function createTray(a: TrayActions): Tray {
  actions = a
  tray = new Tray(trayIcon(current))
  tray.setToolTip('AI 브리핑')
  tray.on('click', () => a.openWindow())
  rebuildMenu()
  return tray
}

export function setTrayState(state: TrayState): void {
  current = state
  if (!tray) return
  tray.setImage(trayIcon(state))
  tray.setToolTip(`AI 브리핑 · ${STATE_LABEL[state]}`)
  rebuildMenu()
}
