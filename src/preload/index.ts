// ============================================================================
// 화면용 API 연결
//
// [역할]
// - 화면(renderer)이 Main의 기능을 부를 수 있도록 window.jogan에 API 제공
// - 화면의 호출을 정해진 IPC 채널로 Main에 전달하고 결과를 돌려줌 (채널 이름은 shared/ipc.ts에 정의)
// - Main이 보내는 알림을 화면이 구독 · 해제할 수 있게 연결 (on으로 시작하는 메서드)
// - 화면에는 이 API만 내보냄 (ipcRenderer 자체는 내보내지 않음)
// ============================================================================
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type JoganApi, type DiagEvent, type Route } from '@shared/ipc'
import type { ChatEvent, RunProgress } from '@shared/types'

// Main이 채널로 보내는 알림을 구독 (반환한 함수를 부르면 구독 해제)
function subscribe<T>(channel: string, onPayload: (payload: T) => void): () => void {
    // 화면에는 IPC 이벤트 객체를 빼고 내용만 넘김
    const ipcListener = (_ipcEvent: Electron.IpcRendererEvent, payload: T) => onPayload(payload)
    ipcRenderer.on(channel, ipcListener)

    // 해제할 때 같은 함수를 떼어 냄
    return () => ipcRenderer.removeListener(channel, ipcListener)
}

// 화면에 내보내는 API (메서드마다 같은 이름의 IPC 채널로 전달)
// 각 메서드의 뜻은 shared/ipc.ts의 JoganApi 참고
const api: JoganApi = {
    // 브리핑 · 기사
    getLatestDigest: () => ipcRenderer.invoke(IPC.getLatestDigest),
    runNow: () => ipcRenderer.invoke(IPC.runNow),
    isRunning: () => ipcRenderer.invoke(IPC.isRunning),
    onRunProgress: (onRunProgress) => subscribe<RunProgress>(IPC.runProgress, onRunProgress),
    onDigestUpdated: (onDigestChange) => subscribe<void>(IPC.digestUpdated, onDigestChange),
    onNavigate: (onRouteRequest) => subscribe<Route>(IPC.navigate, onRouteRequest),
    markRead: (itemId) => ipcRenderer.invoke(IPC.markRead, itemId),
    setSaved: (itemId, saved) => ipcRenderer.invoke(IPC.setSaved, itemId, saved),
    saveMemo: (itemId, body) => ipcRenderer.invoke(IPC.saveMemo, itemId, body),
    openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
    onItemUpdated: (onItemChange) => subscribe<number>(IPC.itemUpdated, onItemChange),
    getItem: (itemId) => ipcRenderer.invoke(IPC.getItem, itemId),
    translateItem: (itemId) => ipcRenderer.invoke(IPC.translateItem, itemId),
    addHighlights: (itemId, ranges) => ipcRenderer.invoke(IPC.addHighlights, itemId, ranges),
    updateHighlightNote: (highlightId, note) => ipcRenderer.invoke(IPC.updateHighlightNote, highlightId, note),
    removeHighlight: (highlightId) => ipcRenderer.invoke(IPC.removeHighlight, highlightId),
    addTag: (itemId, name) => ipcRenderer.invoke(IPC.addTag, itemId, name),
    removeTag: (itemId, name) => ipcRenderer.invoke(IPC.removeTag, itemId, name),
    // 라이브러리 · 아카이브 · 출처
    search: (searchParams) => ipcRenderer.invoke(IPC.search, searchParams),
    getSourceStats: (period) => ipcRenderer.invoke(IPC.getSourceStats, period),
    listTags: () => ipcRenderer.invoke(IPC.listTags),
    listDigests: () => ipcRenderer.invoke(IPC.listDigests),
    getDigest: (digestDate) => ipcRenderer.invoke(IPC.getDigest, digestDate),
    // AI 질문
    getChat: (chatScope) => ipcRenderer.invoke(IPC.getChat, chatScope),
    ask: (chatScope, question) => ipcRenderer.invoke(IPC.ask, chatScope, question),
    clearChat: (chatScope) => ipcRenderer.invoke(IPC.clearChat, chatScope),
    getQuickActions: () => ipcRenderer.invoke(IPC.getQuickActions),
    onChatEvent: (onChatEvent) => subscribe<ChatEvent>(IPC.chatEvent, onChatEvent),
    // 설정
    getSettings: () => ipcRenderer.invoke(IPC.getSettings),
    updateSettings: (settingsPatch) => ipcRenderer.invoke(IPC.updateSettings, settingsPatch),
    getUsage: () => ipcRenderer.invoke(IPC.getUsage),
    getApiKeyStatus: () => ipcRenderer.invoke(IPC.getApiKeyStatus),
    setApiKey: (apiKey) => ipcRenderer.invoke(IPC.setApiKey, apiKey),
    getAutostart: () => ipcRenderer.invoke(IPC.getAutostart),
    setAutostart: (shouldEnable) => ipcRenderer.invoke(IPC.setAutostart, shouldEnable),
    // 창 (화면이 그린 제목 표시줄의 버튼)
    windowMinimize: () => ipcRenderer.invoke(IPC.windowMinimize),
    windowToggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize),
    windowClose: () => ipcRenderer.invoke(IPC.windowClose),
    windowIsMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized),
    onWindowMaximizedChanged: (onMaximizedChange) => subscribe<boolean>(IPC.windowMaximizedChanged, onMaximizedChange),
    // 진단
    getDiagEvents: () => ipcRenderer.invoke(IPC.getDiagEvents),
    onDiagEvent: (onDiagEvent) => subscribe<DiagEvent>(IPC.diagEvent, onDiagEvent),
    testNotification: () => ipcRenderer.invoke(IPC.testNotification),
    runNetworkChecks: () => ipcRenderer.invoke(IPC.runNetworkChecks),
    getTriggerState: () => ipcRenderer.invoke(IPC.getTriggerState)
}

contextBridge.exposeInMainWorld('jogan', api) // 화면에서는 window.jogan으로 사용
