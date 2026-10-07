import { Menu, Tray } from 'electron'
import type { AutostartPort, StatusPort, TrayState } from '../../services/ports'
import { trayIcon } from './tray-icon'

const STATE_LABEL: Record<TrayState, string> = {
  idle: '대기 중',
  busy: '브리핑 생성 중…',
  new: '새 브리핑 도착',
  offline: '오프라인',
  error: '오류 발생'
}

export interface TrayActions {
  openToday(): void
  refresh(): void
  testNotification(): void
  quit(): void
}

/** 트레이 아이콘과 메뉴. 앱 상태(StatusPort)를 아이콘 색과 메뉴 첫 줄로 보여준다 */
export class TrayController implements StatusPort {
  private tray: Tray | null = null
  private state: TrayState = 'idle'

  constructor(
    private readonly actions: TrayActions,
    private readonly autostart: AutostartPort
  ) {}

  create(): void {
    this.tray = new Tray(trayIcon(this.state))
    this.tray.setToolTip('AI 브리핑')
    this.tray.on('click', () => this.actions.openToday())
    this.rebuildMenu()
  }

  set(state: TrayState): void {
    this.state = state
    if (!this.tray) return
    this.tray.setImage(trayIcon(state))
    this.tray.setToolTip(`AI 브리핑 · ${STATE_LABEL[state]}`)
    this.rebuildMenu()
  }

  private rebuildMenu(): void {
    if (!this.tray) return
    const a = this.actions
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `AI 브리핑 · ${STATE_LABEL[this.state]}`, enabled: false },
        { type: 'separator' },
        { label: '오늘 브리핑 열기', click: () => a.openToday() },
        { label: '지금 새로고침', click: () => a.refresh() },
        { label: '알림 테스트', click: () => a.testNotification() },
        { type: 'separator' },
        {
          label: 'Windows 시작 시 실행',
          type: 'checkbox',
          checked: this.autostart.isEnabled(),
          click: (item) => {
            this.autostart.set(item.checked)
            this.rebuildMenu()
          }
        },
        { type: 'separator' },
        { label: '종료', click: () => a.quit() }
      ])
    )
  }
}
