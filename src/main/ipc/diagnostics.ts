import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { DiagnosticsService } from '../services/diagnostics-service'

// 진단 화면 요청 → 서비스 호출

export function registerDiagnosticsIpc(d: { diagnostics: DiagnosticsService }): void {
  ipcMain.handle(IPC.getEvents, () => d.diagnostics.events())
  ipcMain.handle(IPC.testNotification, () => d.diagnostics.testNotification())
  ipcMain.handle(IPC.runNetworkChecks, () => d.diagnostics.runNetworkChecks())
  ipcMain.handle(IPC.getTriggerState, () => d.diagnostics.triggerState())
}
