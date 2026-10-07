import { app } from 'electron'
import type { AutostartPort, LogFn } from '../services/ports'

/** Windows 로그인 항목(시작 프로그램) 등록 */
export class LoginItemAutostart implements AutostartPort {
  constructor(private readonly log: LogFn) {}

  // 설치판은 실행 파일만 등록하면 되지만, 개발 중에는 electron.exe에 앱 경로를 넘겨야 한다.
  // 개발 모드에서 자동 시작을 시험하려면 먼저 `npm run build`로 out/을 만들어 둬야 한다.
  private options(): Electron.Settings {
    return app.isPackaged
      ? { path: process.execPath, args: ['--hidden'] }
      : { path: process.execPath, args: [app.getAppPath(), '--hidden'] }
  }

  isEnabled(): boolean {
    const { path, args } = this.options()
    return app.getLoginItemSettings({ path, args }).openAtLogin
  }

  set(on: boolean): boolean {
    app.setLoginItemSettings({ ...this.options(), openAtLogin: on })
    const result = this.isEnabled()
    this.log('autostart', `${on ? '켬' : '끔'} 요청 → 현재 ${result ? '켜짐' : '꺼짐'}`)
    return result
  }
}
