import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { BriefingService } from '../services/briefing-service'
import type { ContentService } from '../services/content-service'

// 브리핑·기사 요청 → 서비스 호출

export function registerDigestIpc(d: {
  content: ContentService
  briefing: BriefingService
  runNow(): void
  openExternal(url: string): Promise<void>
}): void {
  ipcMain.handle(IPC.getLatestDigest, () => d.content.getLatestDigest())
  ipcMain.handle(IPC.runNow, () => d.runNow())
  ipcMain.handle(IPC.isRunning, () => d.briefing.isRunning())
  ipcMain.handle(IPC.markRead, (_e, itemId: number) => d.content.markRead(itemId))
  ipcMain.handle(IPC.setSaved, (_e, itemId: number, saved: boolean) => d.content.setSaved(itemId, saved))
  ipcMain.handle(IPC.saveMemo, (_e, itemId: number, body: string) => d.content.saveMemo(itemId, body))
  ipcMain.handle(IPC.getItem, (_e, itemId: number) => d.content.getItem(itemId))
  ipcMain.handle(IPC.addTag, (_e, itemId: number, name: string) => d.content.addTag(itemId, name))
  ipcMain.handle(IPC.removeTag, (_e, itemId: number, name: string) => d.content.removeTag(itemId, name))
  ipcMain.handle(IPC.openExternal, (_e, url: string) => d.openExternal(url))
}
