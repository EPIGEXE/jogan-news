import { BrowserWindow } from 'electron'
import { IPC, type DiagEvent, type Route } from '@shared/ipc'
import type { RunProgress } from '@shared/types'
import type { RendererEvents } from '../services/ports'

/** 화면으로 보내는 알림을 한곳에서 보낸다 (열려 있는 모든 창에) */
export class BroadcastEvents implements RendererEvents {
  private send(channel: string, ...args: unknown[]): void {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, ...args)
  }

  progress(p: RunProgress): void {
    this.send(IPC.progress, p)
  }

  digestUpdated(): void {
    this.send(IPC.digestUpdated)
  }

  itemUpdated(itemId: number): void {
    this.send(IPC.itemUpdated, itemId)
  }

  navigate(route: Route): void {
    this.send(IPC.navigate, route)
  }

  diagEvent(e: DiagEvent): void {
    this.send(IPC.event, e)
  }
}
