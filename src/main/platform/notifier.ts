// ============================================================================
// Windows 알림
//
// [역할]
// - Windows 알림을 띄우고, 클릭하면 정해 둔 동작 실행
// - 알림이 뜸 · 눌림 · 실패함을 진단 기록에 남김 (알림을 쓸 수 없는 환경이면 기록만 하고 띄우지 않음)
// - 브리핑 완료 · 실패 · 알림 테스트의 문구와 클릭 동작 정의
// - 새 브리핑 알림 클릭: 오늘 화면을 열고 트레이의 새 브리핑 표시를 거둠
// - 생성 실패 알림 클릭: 설정 화면 열기
// - 알림 테스트 클릭: 오늘 화면 열기
// ============================================================================
import { Notification } from 'electron'
import type { Route } from '@shared/ipc'
import type { BriefingNotifier, LogFn, StatusPort } from '../services/ports'

/**
 * Windows 알림 표시
 *
 * - 알림이 뜨고 · 눌리고 · 실패한 것을 진단 기록에 남김
 */
export class DesktopNotifier {
    // 표시 중인 알림 (Notification 객체가 가비지 컬렉션되면 클릭 이벤트가 사라지므로 붙잡아 둠)
    private readonly shownNotifications = new Set<Notification>()

    constructor(private readonly log: LogFn) {}

    /**
     * 알림 띄우기
     *
     * @param {string} title - 알림 제목
     * @param {string} body - 알림 내용
     * @param {() => void} onClick - 알림을 클릭했을 때 부를 함수
     */
    show(title: string, body: string, onClick: () => void): void {
        // 알림을 쓸 수 없는 환경이면 기록만 남기고 끝
        if (!Notification.isSupported()) {
            this.log('notification-unsupported', '이 환경에서는 알림을 쓸 수 없음')
            return
        }

        // 알림을 만들고, 클릭 이벤트가 살아 있도록 붙잡아 둠
        const notification = new Notification({ title, body })
        this.shownNotifications.add(notification)

        // 화면에 뜸 → 기록
        notification.on('show', () => this.log('notification-shown', title))

        // 클릭 → 기록하고 정해 둔 동작 실행
        notification.on('click', () => {
            this.log('notification-click', title)
            this.shownNotifications.delete(notification)
            onClick()
        })

        // 닫힘 · 실패 → 더 붙잡아 둘 필요 없음 (실패는 이유를 기록)
        notification.on('close', () => this.shownNotifications.delete(notification))
        notification.on('failed', (_failedEvent, failureReason) => {
            this.log('notification-failed', failureReason)
            this.shownNotifications.delete(notification)
        })

        notification.show()
    }
}

const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'] // 요일 이름 (Date.getDay() 순서)

// 날짜를 '10/7(수)' 모양으로 변환
function formatShortDate(date: Date): string {
    return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAY_NAMES[date.getDay()]})`
}

/**
 * 브리핑 결과 알림의 문구와 클릭 동작
 */
export class BriefingNotifications implements BriefingNotifier {
    constructor(
        private readonly notifier: DesktopNotifier, // 알림을 실제로 띄우는 쪽
        private readonly openWindow: (route: Route) => void, // 창을 띄우고 그 화면으로 이동
        private readonly status: StatusPort // 트레이 상태 표시 (새 브리핑 표시를 거둘 때 사용)
    ) {}

    // 새 브리핑 알림 (클릭하면 오늘 화면을 열고 새 브리핑 표시를 거둠)
    // 제목은 앱 이름과 오늘 날짜, 내용은 오늘의 한 줄
    briefingReady(headline: string): void {
        this.notifier.show(`📰 Jogan · ${formatShortDate(new Date())}`, headline, () => {
            this.openWindow('today')
            this.status.setTrayState('idle')
        })
    }

    // 생성 실패 알림 (클릭하면 설정 화면 열기)
    briefingFailed(message: string): void {
        this.notifier.show('브리핑 생성 실패', message, () => this.openWindow('settings'))
    }

    // 알림 테스트 (클릭하면 오늘 화면이 열려야 정상)
    showTestNotification(): void {
        this.notifier.show('알림 테스트', '이 알림을 클릭하면 앱 창이 열려야 합니다', () => this.openWindow('today'))
    }
}
