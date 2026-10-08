import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { WindowControls } from '../services/ports'

// 직접 그린 제목 표시줄의 창 버튼 → 창 조작

export function registerWindowIpc(w: WindowControls): void {
  ipcMain.handle(IPC.windowMinimize, () => w.minimize())
  ipcMain.handle(IPC.windowToggleMaximize, () => w.toggleMaximize())
  ipcMain.handle(IPC.windowClose, () => w.close())
  ipcMain.handle(IPC.windowIsMaximized, () => w.isMaximized())
}
