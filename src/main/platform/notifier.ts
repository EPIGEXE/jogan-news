import { Notification } from 'electron'
import type { Route } from '@shared/ipc'
import type { BriefingNotifier, LogFn, StatusPort } from '../services/ports'

/** Windows 알림. 클릭하면 onClick을 부른다 */
export class DesktopNotifier {
  // Notification 객체가 가비지 컬렉션되면 클릭 이벤트가 사라지므로 표시 중인 알림을 붙잡아 둔다.
  private readonly alive = new Set<Notification>()

  constructor(private readonly log: LogFn) {}

  show(title: string, body: string, onClick: () => void): void {
    if (!Notification.isSupported()) {
      this.log('notification-unsupported', '이 환경에서는 알림을 쓸 수 없음')
      return
    }
    const n = new Notification({ title, body })
    this.alive.add(n)
    n.on('show', () => this.log('notification-shown', title))
    n.on('click', () => {
      this.log('notification-click', title)
      this.alive.delete(n)
      onClick()
    })
    n.on('close', () => this.alive.delete(n))
    n.on('failed', (_e, err) => {
      this.log('notification-failed', err)
      this.alive.delete(n)
    })
    n.show()
  }
}

const DAYS = ['일', '월', '화', '수', '목', '금', '토']

function shortDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}(${DAYS[d.getDay()]})`
}

/** 브리핑 결과 알림의 문구와 클릭 동작 */
export class BriefingNotifications implements BriefingNotifier {
  constructor(
    private readonly notifier: DesktopNotifier,
    private readonly openWindow: (route: Route) => void,
    private readonly status: StatusPort
  ) {}

  briefingReady(headline: string): void {
    this.notifier.show(`📰 AI 브리핑 · ${shortDate(new Date())}`, headline, () => {
      this.openWindow('today')
      this.status.set('idle')
    })
  }

  briefingFailed(message: string): void {
    this.notifier.show('브리핑 생성 실패', message, () => this.openWindow('settings'))
  }

  test(): void {
    this.notifier.show('알림 테스트', '이 알림을 클릭하면 앱 창이 열려야 합니다', () => this.openWindow('today'))
  }
}
