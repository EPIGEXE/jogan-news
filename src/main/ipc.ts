import { app, ipcMain, shell } from 'electron'
import { dateKey, DEFAULT_SCHEDULE } from '@shared/schedule'
import { IPC, type TriggerState } from '@shared/ipc'
import type { AppSettings, SearchParams } from '@shared/types'
import { isAutostartEnabled, setAutostart } from './autostart'
import { isRunning } from './briefing'
import { getEvents } from './diag-log'
import { runNetworkChecks } from './netcheck'
import { getApiKey, getApiKeyStatus, setApiKey } from './secrets'
import { getNextTimerAt } from './triggers'
import type { WorkerHost } from './worker-host'

export interface IpcDeps {
  worker: WorkerHost
  runNow(): void
  testNotification(): void
}

export function registerIpc({ worker, runNow, testNotification }: IpcDeps): void {
  // 브리핑
  ipcMain.handle(IPC.getLatestDigest, () => worker.call('getLatestDigest'))
  ipcMain.handle(IPC.runNow, () => runNow())
  ipcMain.handle(IPC.isRunning, () => isRunning())
  ipcMain.handle(IPC.markRead, (_e, itemId: number) => worker.call('markRead', { itemId }))
  ipcMain.handle(IPC.setSaved, (_e, itemId: number, saved: boolean) => worker.call('setSaved', { itemId, saved }))
  ipcMain.handle(IPC.saveMemo, (_e, itemId: number, body: string) => worker.call('saveMemo', { itemId, body }))
  ipcMain.handle(IPC.getItem, (_e, itemId: number) => worker.call('getItem', { itemId }))
  ipcMain.handle(IPC.addTag, (_e, itemId: number, name: string) => worker.call('addTag', { itemId, name }))
  ipcMain.handle(IPC.removeTag, (_e, itemId: number, name: string) => worker.call('removeTag', { itemId, name }))

  // 라이브러리·아카이브
  ipcMain.handle(IPC.search, (_e, p: SearchParams) => worker.call('search', p))
  ipcMain.handle(IPC.listTags, () => worker.call('listTags'))
  ipcMain.handle(IPC.listDigests, () => worker.call('listDigests'))
  ipcMain.handle(IPC.getDigest, (_e, date: string) => worker.call('getDigest', { date }))

  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    // 화면에서 넘어온 값이므로 http(s)만 연다.
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
  })

  // 설정
  ipcMain.handle(IPC.getSettings, () => worker.call('getSettings'))
  ipcMain.handle(IPC.updateSettings, (_e, patch: Partial<AppSettings>) => worker.call('updateSettings', patch))
  ipcMain.handle(IPC.getUsage, () => worker.call('getUsage'))
  ipcMain.handle(IPC.getApiKeyStatus, () => getApiKeyStatus())
  ipcMain.handle(IPC.setApiKey, (_e, key: string | null) => {
    setApiKey(key)
    worker.setApiKey(getApiKey())
    return getApiKeyStatus()
  })
  ipcMain.handle(IPC.getAutostart, () => isAutostartEnabled())
  ipcMain.handle(IPC.setAutostart, (_e, on: boolean) => setAutostart(on))

  // 진단
  ipcMain.handle(IPC.getEvents, () => getEvents())
  ipcMain.handle(IPC.testNotification, () => testNotification())
  ipcMain.handle(IPC.runNetworkChecks, () => runNetworkChecks())
  ipcMain.handle(IPC.getTriggerState, async (): Promise<TriggerState> => {
    const next = getNextTimerAt()
    return {
      today: dateKey(new Date()),
      lastDigestDate: await worker.call('getLastDigestDate'),
      nextTimerAt: next ? next.toISOString() : null,
      morningHour: DEFAULT_SCHEDULE.morningHour,
      dayStartHour: DEFAULT_SCHEDULE.dayStartHour,
      isPackaged: app.isPackaged
    }
  })
}
