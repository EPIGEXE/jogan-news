// ============================================================================
// 트레이
//
// [역할]
// - 트레이 아이콘과 오른쪽 클릭 메뉴 표시
// - 앱 상태(대기 · 생성 중 · 새 브리핑 · 오프라인 · 실패)를 아이콘 배지 · 툴팁 · 메뉴 첫 줄로 표시
// - 툴팁: "Jogan · 상태"에 설명(새 브리핑이면 오늘의 한 줄, 실패면 이유)을 붙이고 127자를 넘으면 자름 (DESIGN.md 13.8절)
// - 아이콘 클릭: 오늘 브리핑을 열고, 새 브리핑 상태였으면 배지를 거둠
// - 메뉴: 오늘 브리핑 열기 · 지금 브리핑 만들기 · 알림 테스트 · Windows 시작 시 실행 켜기/끄기 · 종료
// - 아이콘을 만들기 전에 바뀐 상태는 기억해 두었다가 만들 때 반영
// ============================================================================
import { Menu, Tray } from 'electron'
import type { AutostartPort, StatusPort, TrayState } from '../../services/ports'
import { trayIcon } from './tray-icon'

const APP_NAME = 'Jogan' // 툴팁과 메뉴 첫 줄에 붙는 앱 이름

// 상태별로 툴팁과 메뉴 첫 줄에 보여줄 말
const STATE_LABEL: Record<TrayState, string> = {
    idle: '대기 중',
    busy: '브리핑 만드는 중',
    new: '새 브리핑',
    offline: '네트워크 연결 대기 중',
    error: '브리핑 생성 실패'
}

const TOOLTIP_MAX = 127 // Windows 트레이 툴팁의 최대 글자 수

// 툴팁 문구 생성 (최대 글자 수를 넘으면 끝을 …로 자름)
function buildTooltip(state: TrayState, detail?: string): string {
    const stateHeading = `${APP_NAME} · ${STATE_LABEL[state]}` // 설명이 없을 때의 문구
    const tooltipText = detail ? `${stateHeading}: ${detail}` : stateHeading
    return tooltipText.length > TOOLTIP_MAX ? `${tooltipText.slice(0, TOOLTIP_MAX - 1)}…` : tooltipText
}

// 트레이 메뉴 · 아이콘 클릭이 부르는 동작
export interface TrayActions {
    openToday(): void // 오늘 브리핑 열기
    runBriefingNow(): void // 지금 브리핑 만들기
    testNotification(): void // 알림 테스트
    quit(): void // 앱 종료
}

/**
 * 트레이 아이콘과 메뉴
 *
 * - 앱 상태(StatusPort)를 아이콘 배지 · 툴팁 · 메뉴 첫 줄로 표시
 */
export class TrayController implements StatusPort {
    private tray: Tray | null = null // create() 전에는 null
    private state: TrayState = 'idle' // 지금 보여 주는 앱 상태
    private detail: string | undefined // 툴팁에 붙일 설명 (새 브리핑의 한 줄, 실패 이유 등)

    constructor(
        private readonly actions: TrayActions, // 메뉴 · 아이콘 클릭이 부를 동작
        private readonly autostart: AutostartPort // 메뉴의 "Windows 시작 시 실행" 조회 · 변경용
    ) {}

    // 트레이 아이콘 생성
    create(): void {
        // 지금까지 기억해 둔 상태로 아이콘과 툴팁 표시
        this.tray = new Tray(trayIcon(this.state))
        this.tray.setToolTip(buildTooltip(this.state, this.detail))

        // 아이콘 클릭 → 오늘 브리핑 열기
        this.tray.on('click', () => {
            this.actions.openToday()
            // 새 브리핑을 열어 봤으면 배지를 거둠 (알림을 눌렀을 때와 같음)
            if (this.state === 'new') this.setTrayState('idle')
        })

        // 오른쪽 클릭 메뉴 준비
        this.rebuildMenu()
    }

    /**
     * 앱 상태 바꾸기 (아이콘 · 툴팁 · 메뉴에 반영)
     *
     * @param {TrayState} state - 새 상태
     * @param {string} [detail] - 툴팁에 붙일 설명
     */
    setTrayState(state: TrayState, detail?: string): void {
        // 새 상태 기억 (설명을 안 주면 이전 설명은 지워짐)
        this.state = state
        this.detail = detail
        if (!this.tray) return // 아이콘을 만들기 전이면 값만 기억

        // 아이콘 배지 · 툴팁 · 메뉴 첫 줄에 반영
        this.tray.setImage(trayIcon(state))
        this.tray.setToolTip(buildTooltip(state, detail))
        this.rebuildMenu()
    }

    // 오른쪽 클릭 메뉴를 지금 상태로 다시 만듦 (첫 줄의 상태와 자동 시작 체크 표시가 바뀌므로)
    private rebuildMenu(): void {
        if (!this.tray) return
        const trayActions = this.actions
        this.tray.setContextMenu(
            Menu.buildFromTemplate([
                // 첫 줄: 지금 상태 (누를 수 없는 표시용)
                { label: `${APP_NAME} · ${STATE_LABEL[this.state]}`, enabled: false },
                { type: 'separator' },
                { label: '오늘 브리핑 열기', click: () => trayActions.openToday() },
                { label: '지금 브리핑 만들기', click: () => trayActions.runBriefingNow() },
                { label: '알림 테스트', click: () => trayActions.testNotification() },
                { type: 'separator' },
                // 자동 시작 체크 항목: 누르면 켜기 · 끄기를 바꾸고, 실제 상태로 체크 표시를 다시 맞춤
                {
                    label: 'Windows 시작 시 실행',
                    type: 'checkbox',
                    checked: this.autostart.isEnabled(),
                    click: (autostartMenuItem) => {
                        this.autostart.setEnabled(autostartMenuItem.checked)
                        this.rebuildMenu()
                    }
                },
                { type: 'separator' },
                { label: '종료', click: () => trayActions.quit() }
            ])
        )
    }
}
