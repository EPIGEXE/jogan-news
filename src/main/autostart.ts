import { app } from 'electron'
import { logEvent } from './diag-log'

// 설치판은 실행 파일만 등록하면 되지만, 개발 중에는 electron.exe에 앱 경로를 넘겨야 한다.
// 개발 모드에서 자동 시작을 시험하려면 먼저 `npm run build`로 out/을 만들어 둬야 한다.
function loginItemOptions(): Electron.Settings {
  return app.isPackaged
    ? { path: process.execPath, args: ['--hidden'] }
    : { path: process.execPath, args: [app.getAppPath(), '--hidden'] }
}

export function isAutostartEnabled(): boolean {
  const { path, args } = loginItemOptions()
  return app.getLoginItemSettings({ path, args }).openAtLogin
}

export function setAutostart(on: boolean): boolean {
  app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: on })
  const result = isAutostartEnabled()
  logEvent('autostart', `${on ? '켬' : '끔'} 요청 → 현재 ${result ? '켜짐' : '꺼짐'}`)
  return result
}
