import type { BriefingService } from '../services/briefing-service'
import type { ChatService } from '../services/chat-service'
import type { ContentService } from '../services/content-service'
import type { DiagnosticsService } from '../services/diagnostics-service'
import type { WindowControls } from '../services/ports'
import type { SettingsService } from '../services/settings-service'
import { registerChatIpc } from './chat'
import { registerDiagnosticsIpc } from './diagnostics'
import { registerDigestIpc } from './digest'
import { registerLibraryIpc } from './library'
import { registerSettingsIpc } from './settings'
import { registerWindowIpc } from './window'

// 화면(renderer)에서 오는 요청의 입구. 여기서는 서비스를 부르기만 하고 판단·저장은 하지 않는다.

export interface IpcDeps {
  content: ContentService
  briefing: BriefingService
  chat: ChatService
  settings: SettingsService
  diagnostics: DiagnosticsService
  runNow(): Promise<boolean>
  openExternal(url: string): Promise<void>
  window: WindowControls
}

export function registerIpc(d: IpcDeps): void {
  registerDigestIpc(d)
  registerLibraryIpc(d)
  registerChatIpc(d)
  registerSettingsIpc(d)
  registerDiagnosticsIpc(d)
  registerWindowIpc(d.window)
}
