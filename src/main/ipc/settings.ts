import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppSettings } from '@shared/types'
import type { SettingsService } from '../services/settings-service'

// 설정 요청 → 서비스 호출

export function registerSettingsIpc(d: { settings: SettingsService }): void {
  ipcMain.handle(IPC.getSettings, () => d.settings.getSettings())
  ipcMain.handle(IPC.updateSettings, (_e, patch: Partial<AppSettings>) => d.settings.updateSettings(patch))
  ipcMain.handle(IPC.getUsage, () => d.settings.getUsage())
  ipcMain.handle(IPC.getApiKeyStatus, () => d.settings.apiKeyStatus())
  ipcMain.handle(IPC.setApiKey, (_e, key: string | null) => d.settings.setApiKey(key))
  ipcMain.handle(IPC.getAutostart, () => d.settings.isAutostartEnabled())
  ipcMain.handle(IPC.setAutostart, (_e, on: boolean) => d.settings.setAutostart(on))
}
