// ============================================================================
// Windows 자동 시작
//
// [역할]
// - Windows 로그인 때 앱이 창 없이 켜지도록 시작 프로그램에 등록 · 해제 (`--hidden` 인자를 붙여 등록)
// - 지금 실행 파일로 자동 시작이 켜져 있는지 확인
// - 설치판: 실행 파일만 등록
// - 개발 중: electron.exe에 앱 경로를 함께 넘겨 등록
// - 켜기 · 끄기 요청과 그 뒤의 실제 상태를 진단 기록에 남김
// ============================================================================
import { app } from 'electron'
import type { AutostartPort, LogFn } from '../services/ports'

/**
 * Windows 로그인 항목(시작 프로그램) 등록
 *
 * - 자동으로 켜질 때는 `--hidden` 인자를 붙여 창 없이 시작
 */
export class LoginItemAutostart implements AutostartPort {
    constructor(private readonly log: LogFn) {}

    // 등록 · 조회에 쓰는 실행 경로와 인자 (등록할 때와 조회할 때 같은 값을 써야 같은 항목으로 인식됨)
    // 설치판은 실행 파일만 등록하면 되지만, 개발 중에는 electron.exe에 앱 경로를 넘겨야 함
    // 개발 모드에서 자동 시작을 시험하려면 먼저 `npm run build`로 out/을 만들어 둬야 함
    private loginItemOptions(): Electron.Settings {
        return app.isPackaged
            ? { path: process.execPath, args: ['--hidden'] }
            : { path: process.execPath, args: [app.getAppPath(), '--hidden'] }
    }

    // 지금 실행 파일로 자동 시작이 켜져 있는지
    isEnabled(): boolean {
        const { path, args } = this.loginItemOptions()
        return app.getLoginItemSettings({ path, args }).openAtLogin
    }

    /**
     * 자동 시작 켜기 · 끄기
     *
     * @param {boolean} shouldEnable - true면 등록, false면 해제
     * @returns {boolean} 바꾼 뒤 실제로 켜져 있는지
     */
    setEnabled(shouldEnable: boolean): boolean {
        // 시작 프로그램에 등록 · 해제
        app.setLoginItemSettings({ ...this.loginItemOptions(), openAtLogin: shouldEnable })

        // 요청한 값이 아니라 다시 읽은 실제 상태를 기록 · 반환
        const isEnabledNow = this.isEnabled()
        this.log('autostart', `${shouldEnable ? '켬' : '끔'} 요청 → 현재 ${isEnabledNow ? '켜짐' : '꺼짐'}`)
        return isEnabledNow
    }
}
