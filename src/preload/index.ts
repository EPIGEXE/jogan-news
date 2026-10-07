import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AinewsApi, type DiagEvent, type Route } from '@shared/ipc'
import type { RunProgress } from '@shared/types'

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, v: T) => cb(v)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: AinewsApi = {
  // 브리핑
  getLatestDigest: () => ipcRenderer.invoke(IPC.getLatestDigest),
  runNow: () => ipcRenderer.invoke(IPC.runNow),
  isRunning: () => ipcRenderer.invoke(IPC.isRunning),
  onProgress: (cb) => subscribe<RunProgress>(IPC.progress, cb),
  onDigestUpdated: (cb) => subscribe<void>(IPC.digestUpdated, cb),
  onNavigate: (cb) => subscribe<Route>(IPC.navigate, cb),
  markRead: (itemId) => ipcRenderer.invoke(IPC.markRead, itemId),
  setSaved: (itemId, saved) => ipcRenderer.invoke(IPC.setSaved, itemId, saved),
  saveMemo: (itemId, body) => ipcRenderer.invoke(IPC.saveMemo, itemId, body),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  onItemUpdated: (cb) => subscribe<number>(IPC.itemUpdated, cb),
  getItem: (itemId) => ipcRenderer.invoke(IPC.getItem, itemId),
  addTag: (itemId, name) => ipcRenderer.invoke(IPC.addTag, itemId, name),
  removeTag: (itemId, name) => ipcRenderer.invoke(IPC.removeTag, itemId, name),
  // 라이브러리·아카이브
  search: (p) => ipcRenderer.invoke(IPC.search, p),
  listTags: () => ipcRenderer.invoke(IPC.listTags),
  listDigests: () => ipcRenderer.invoke(IPC.listDigests),
  getDigest: (date) => ipcRenderer.invoke(IPC.getDigest, date),
  // 설정
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  getUsage: () => ipcRenderer.invoke(IPC.getUsage),
  getApiKeyStatus: () => ipcRenderer.invoke(IPC.getApiKeyStatus),
  setApiKey: (key) => ipcRenderer.invoke(IPC.setApiKey, key),
  getAutostart: () => ipcRenderer.invoke(IPC.getAutostart),
  setAutostart: (on) => ipcRenderer.invoke(IPC.setAutostart, on),
  // 진단
  getEvents: () => ipcRenderer.invoke(IPC.getEvents),
  onEvent: (cb) => subscribe<DiagEvent>(IPC.event, cb),
  testNotification: () => ipcRenderer.invoke(IPC.testNotification),
  runNetworkChecks: () => ipcRenderer.invoke(IPC.runNetworkChecks),
  getTriggerState: () => ipcRenderer.invoke(IPC.getTriggerState)
}

contextBridge.exposeInMainWorld('ainews', api)
