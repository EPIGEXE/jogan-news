// ============================================================================
// 진단 화면 요청
//
// [역할]
// - 진단 화면의 요청(기록 조회 · 알림 테스트 · 네트워크 점검 · 트리거 상태)을 서비스에 전달
// - 기록 조회는 지금까지 쌓인 것만 응답 (이후에 생기는 기록은 화면으로 가는 알림 diag:event로 따로 도착)
// ============================================================================
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { DiagnosticsService } from '../services/diagnostics-service'

/**
 * 진단 화면 요청 핸들러 등록
 *
 * @param {{ diagnostics: DiagnosticsService }} deps - 진단 서비스
 * @returns {void}
 */
export function registerDiagnosticsIpc(deps: { diagnostics: DiagnosticsService }): void {
    ipcMain.handle(IPC.getDiagEvents, () => deps.diagnostics.listEvents()) // 지금까지 쌓인 진단 기록
    ipcMain.handle(IPC.testNotification, () => deps.diagnostics.testNotification()) // 테스트 알림 띄우기
    ipcMain.handle(IPC.runNetworkChecks, () => deps.diagnostics.runNetworkChecks()) // 외부 주소에 닿는지 점검
    ipcMain.handle(IPC.getTriggerState, () => deps.diagnostics.triggerState()) // 브리핑 생성 트리거의 지금 상태
}
