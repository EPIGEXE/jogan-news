// ============================================================================
// 창 버튼 요청
//
// [역할]
// - 직접 그린 제목 표시줄의 창 버튼(최소화 · 최대화 · 닫기) 요청을 창 조작에 전달
// - 닫기는 앱을 끄지 않고 트레이로 숨김
// - 창이 최대화되어 있는지 화면에 알려 줌 (이후의 변화는 창이 화면으로 보내는 알림으로 따로 도착)
// ============================================================================
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { WindowControls } from '../services/ports'

/**
 * 창 버튼 요청 핸들러 등록
 *
 * @param {WindowControls} windowControls - 창 조작
 * @returns {void}
 */
export function registerWindowIpc(windowControls: WindowControls): void {
    ipcMain.handle(IPC.windowMinimize, () => windowControls.minimize())
    ipcMain.handle(IPC.windowToggleMaximize, () => windowControls.toggleMaximize()) // 최대화되어 있으면 원래 크기로, 아니면 최대화
    ipcMain.handle(IPC.windowClose, () => windowControls.close()) // 닫지 않고 트레이로 숨기기
    ipcMain.handle(IPC.windowIsMaximized, () => windowControls.isMaximized()) // 지금 최대화되어 있는지
}
