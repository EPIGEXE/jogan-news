import { Notification } from 'electron'
import { logEvent } from './diag-log'

// Notification 객체가 가비지 컬렉션되면 클릭 이벤트가 사라지므로 표시 중인 알림을 붙잡아 둔다.
const alive = new Set<Notification>()

export function showNotification(title: string, body: string, onClick: () => void): void {
  if (!Notification.isSupported()) {
    logEvent('notification-unsupported', '이 환경에서는 알림을 쓸 수 없음')
    return
  }
  const n = new Notification({ title, body })
  alive.add(n)
  n.on('show', () => logEvent('notification-shown', title))
  n.on('click', () => {
    logEvent('notification-click', title)
    alive.delete(n)
    onClick()
  })
  n.on('close', () => alive.delete(n))
  n.on('failed', (_e, err) => {
    logEvent('notification-failed', err)
    alive.delete(n)
  })
  n.show()
}
