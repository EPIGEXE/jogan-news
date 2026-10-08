import { Menu, Tray } from 'electron'
import type { AutostartPort, StatusPort, TrayState } from '../../services/ports'
import { trayIcon } from './tray-icon'

const APP_NAME = 'Jogan'

const STATE_LABEL: Record<TrayState, string> = {
  idle: '대기 중',
  busy: '브리핑 만드는 중',
  new: '새 브리핑',
  offline: '네트워크 연결 대기 중',
  error: '브리핑 생성 실패'
}

/** Windows 트레이 툴팁은 127자까지 */
const TOOLTIP_MAX = 127

function tooltip(state: TrayState, detail?: string): string {
  const head = `${APP_NAME} · ${STATE_LABEL[state]}`
  const text = detail ? `${head}: ${detail}` : head
  return text.length > TOOLTIP_MAX ? `${text.slice(0, TOOLTIP_MAX - 1)}…` : text
}

export interface TrayActions {
  openToday(): void
  refresh(): void
  testNotification(): void
  quit(): void
}

/** 트레이 아이콘과 메뉴. 앱 상태(StatusPort)를 아이콘 배지·툴팁·메뉴 첫 줄로 보여준다 */
export class TrayController implements StatusPort {
  private tray: Tray | null = null
  private state: TrayState = 'idle'
  private detail: string | undefined

  constructor(
    private readonly actions: TrayActions,
    private readonly autostart: AutostartPort
  ) {}

  create(): void {
    this.tray = new Tray(trayIcon(this.state))
    this.tray.setToolTip(tooltip(this.state, this.detail))
    this.tray.on('click', () => {
      this.actions.openToday()
      // 새 브리핑을 열어 봤으면 배지를 거둔다 (알림을 눌렀을 때와 같음)
      if (this.state === 'new') this.set('idle')
    })
    this.rebuildMenu()
  }

  set(state: TrayState, detail?: string): void {
    this.state = state
    this.detail = detail
    if (!this.tray) return
    this.tray.setImage(trayIcon(state))
    this.tray.setToolTip(tooltip(state, detail))
    this.rebuildMenu()
  }

  private rebuildMenu(): void {
    if (!this.tray) return
    const a = this.actions
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `${APP_NAME} · ${STATE_LABEL[this.state]}`, enabled: false },
        { type: 'separator' },
        { label: '오늘 브리핑 열기', click: () => a.openToday() },
        { label: '지금 브리핑 만들기', click: () => a.refresh() },
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
