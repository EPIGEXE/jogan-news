// ============================================================================
// 설정 요청
//
// [역할]
// - 화면의 설정 요청(설정 조회 · 변경, 사용 비용, API 키, 자동 시작)을 서비스에 전달
// - API 키 자체는 화면에 돌려주지 않음 (어디서 왔는지와 끝 4자리만)
// - 설정 변경은 바꿀 항목만 받고, 바뀐 뒤의 전체 설정을 응답
// ============================================================================
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppSettings } from '@shared/types'
import type { SettingsService } from '../services/settings-service'

/**
 * 설정 요청 핸들러 등록
 *
 * @param {{ settings: SettingsService }} deps - 설정 서비스
 * @returns {void}
 */
export function registerSettingsIpc(deps: { settings: SettingsService }): void {
    // 앱 설정 조회 · 변경, LLM 사용 비용 요약
    ipcMain.handle(IPC.getSettings, () => deps.settings.getSettings())
    ipcMain.handle(IPC.updateSettings, (_invokeEvent, settingsPatch: Partial<AppSettings>) => deps.settings.updateSettings(settingsPatch))
    ipcMain.handle(IPC.getUsage, () => deps.settings.getUsage())

    // API 키: 상태 조회, 저장 · 삭제 (null이면 삭제)
    ipcMain.handle(IPC.getApiKeyStatus, () => deps.settings.apiKeyStatus())
    ipcMain.handle(IPC.setApiKey, (_invokeEvent, apiKey: string | null) => deps.settings.setApiKey(apiKey))

    // Windows 시작 시 실행: 켜져 있는지, 켜기 · 끄기
    ipcMain.handle(IPC.getAutostart, () => deps.settings.isAutostartEnabled())
    ipcMain.handle(IPC.setAutostart, (_invokeEvent, shouldEnable: boolean) => deps.settings.setAutostart(shouldEnable))
}
