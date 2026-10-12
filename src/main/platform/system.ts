// ============================================================================
// 시스템 기능
//
// [역할]
// - 전역 단축키 등록 · 해제 (다른 프로그램이 이미 쓰는 단축키면 등록 실패를 진단 기록에 남김)
// - 기본 브라우저로 링크 열기 (http · https 주소만 열고 나머지는 무시)
// ============================================================================
import { globalShortcut, shell } from 'electron'
import type { LogFn } from '../services/ports'

/**
 * 전역 단축키 등록
 *
 * - 다른 프로그램이 이미 쓰고 있으면 실패를 진단 기록에 남김
 *
 * @param {string} accelerator - 단축키 (Electron 표기)
 * @param {() => void} onPress - 단축키를 눌렀을 때 부를 함수
 * @param {LogFn} log - 진단 기록 함수
 */
export function registerShortcut(accelerator: string, onPress: () => void, log: LogFn): void {
    // 등록에 실패하면 앱은 그대로 쓰되 단축키만 동작하지 않음
    if (!globalShortcut.register(accelerator, onPress)) {
        log('shortcut-failed', `${accelerator} 등록 실패 (다른 프로그램이 사용 중일 수 있음)`)
    }
}

/**
 * 등록한 전역 단축키 모두 해제
 *
 * - 앱이 꺼질 때 호출
 */
export function unregisterShortcuts(): void {
    globalShortcut.unregisterAll()
}

/**
 * 기본 브라우저로 링크 열기
 *
 * - 화면에서 넘어온 값이므로 http(s)만 열고 나머지는 무시
 *
 * @param {string} url - 열 주소
 */
export async function openExternalUrl(url: string): Promise<void> {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
}
