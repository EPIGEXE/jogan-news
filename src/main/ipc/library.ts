import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { SearchParams } from '@shared/types'
import type { ContentService } from '../services/content-service'

// 라이브러리·아카이브 요청 → 서비스 호출

export function registerLibraryIpc(d: { content: ContentService }): void {
  ipcMain.handle(IPC.search, (_e, p: SearchParams) => d.content.search(p))
  ipcMain.handle(IPC.listTags, () => d.content.listTags())
  ipcMain.handle(IPC.listDigests, () => d.content.listDigests())
  ipcMain.handle(IPC.getDigest, (_e, date: string) => d.content.getDigest(date))
}
