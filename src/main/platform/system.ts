import { globalShortcut, shell } from 'electron'
import type { LogFn } from '../services/ports'

/** 전역 단축키 등록. 다른 프로그램이 이미 쓰고 있으면 실패를 기록한다 */
export function registerShortcut(accelerator: string, onPress: () => void, log: LogFn): void {
  if (!globalShortcut.register(accelerator, onPress)) {
    log('shortcut-failed', `${accelerator} 등록 실패 (다른 프로그램이 사용 중일 수 있음)`)
  }
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}

/** 기본 브라우저로 링크 열기. 화면에서 넘어온 값이므로 http(s)만 연다 */
export async function openExternalUrl(url: string): Promise<void> {
  if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
}
