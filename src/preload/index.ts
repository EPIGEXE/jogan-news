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

// Electron이 Main의 오류 앞에 붙이는 머리말 ("Error invoking remote method '채널': Error: ")
const INVOKE_ERROR_PREFIX = /^Error invoking remote method '[^']+': (Error: )?/

// Main의 기능 호출 (실패하면 머리말을 뗀 오류로 다시 던져, 화면에는 Main이 쓴 문구만 보이게 함)
function invoke<Result>(channel: string, ...channelArgs: unknown[]): Promise<Result> {
    return (ipcRenderer.invoke(channel, ...channelArgs) as Promise<Result>).catch((invokeError: unknown) => {
        const rawMessage = invokeError instanceof Error ? invokeError.message : String(invokeError)
        throw new Error(rawMessage.replace(INVOKE_ERROR_PREFIX, ''))
    })
}

// 화면에 내보내는 API (메서드마다 같은 이름의 IPC 채널로 전달)
// 각 메서드의 뜻은 shared/ipc.ts의 JoganApi 참고
const api: JoganApi = {
    // 브리핑 · 기사
    getLatestDigest: () => invoke(IPC.getLatestDigest),
    runNow: () => invoke(IPC.runNow),
    isRunning: () => invoke(IPC.isRunning),
    onRunProgress: (onRunProgress) => subscribe<RunProgress>(IPC.runProgress, onRunProgress),
    onDigestUpdated: (onDigestChange) => subscribe<void>(IPC.digestUpdated, onDigestChange),
    onNavigate: (onRouteRequest) => subscribe<Route>(IPC.navigate, onRouteRequest),
    markRead: (itemId) => invoke(IPC.markRead, itemId),
    setSaved: (itemId, saved) => invoke(IPC.setSaved, itemId, saved),
    saveMemo: (itemId, body) => invoke(IPC.saveMemo, itemId, body),
    openExternal: (url) => invoke(IPC.openExternal, url),
    onItemUpdated: (onItemChange) => subscribe<number>(IPC.itemUpdated, onItemChange),
    getItem: (itemId) => invoke(IPC.getItem, itemId),
    translateItem: (itemId) => invoke(IPC.translateItem, itemId),
    addHighlights: (itemId, ranges) => invoke(IPC.addHighlights, itemId, ranges),
    updateHighlightNote: (highlightId, note) => invoke(IPC.updateHighlightNote, highlightId, note),
    removeHighlight: (highlightId) => invoke(IPC.removeHighlight, highlightId),
    addTag: (itemId, name) => invoke(IPC.addTag, itemId, name),
    removeTag: (itemId, name) => invoke(IPC.removeTag, itemId, name),
    // 라이브러리 · 아카이브 · 출처
    search: (searchParams) => invoke(IPC.search, searchParams),
    getSourceStats: (period) => invoke(IPC.getSourceStats, period),
    listTags: () => invoke(IPC.listTags),
    listDigests: () => invoke(IPC.listDigests),
    getDigest: (digestDate) => invoke(IPC.getDigest, digestDate),
    // AI 질문
    getChat: (chatScope) => invoke(IPC.getChat, chatScope),
    ask: (chatScope, question) => invoke(IPC.ask, chatScope, question),
    clearChat: (chatScope) => invoke(IPC.clearChat, chatScope),
    listChatHistory: () => invoke(IPC.listChatHistory),
    getQuickActions: () => invoke(IPC.getQuickActions),
    onChatEvent: (onChatEvent) => subscribe<ChatEvent>(IPC.chatEvent, onChatEvent),
    // 설정
    getSettings: () => invoke(IPC.getSettings),
    updateSettings: (settingsPatch) => invoke(IPC.updateSettings, settingsPatch),
    getUsage: () => invoke(IPC.getUsage),
    getApiKeyStatus: () => invoke(IPC.getApiKeyStatus),
    setApiKey: (apiKey) => invoke(IPC.setApiKey, apiKey),
    getAutostart: () => invoke(IPC.getAutostart),
    setAutostart: (shouldEnable) => invoke(IPC.setAutostart, shouldEnable),
    // 창 (화면이 그린 제목 표시줄의 버튼)
    windowMinimize: () => invoke(IPC.windowMinimize),
    windowToggleMaximize: () => invoke(IPC.windowToggleMaximize),
    windowClose: () => invoke(IPC.windowClose),
    windowIsMaximized: () => invoke(IPC.windowIsMaximized),
    onWindowMaximizedChanged: (onMaximizedChange) => subscribe<boolean>(IPC.windowMaximizedChanged, onMaximizedChange),
    // 진단
    getDiagEvents: () => invoke(IPC.getDiagEvents),
    onDiagEvent: (onDiagEvent) => subscribe<DiagEvent>(IPC.diagEvent, onDiagEvent),
    testNotification: () => invoke(IPC.testNotification),
    runNetworkChecks: () => invoke(IPC.runNetworkChecks),
    getTriggerState: () => invoke(IPC.getTriggerState)
}

contextBridge.exposeInMainWorld('jogan', api) // 화면에서는 window.jogan으로 사용
