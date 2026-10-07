import type { BriefingService } from '../services/briefing-service'
import type { ContentService } from '../services/content-service'
import type { DiagnosticsService } from '../services/diagnostics-service'
import type { SettingsService } from '../services/settings-service'
import { registerDiagnosticsIpc } from './diagnostics'
import { registerDigestIpc } from './digest'
import { registerLibraryIpc } from './library'
import { registerSettingsIpc } from './settings'

// 화면(renderer)에서 오는 요청의 입구. 여기서는 서비스를 부르기만 하고 판단·저장은 하지 않는다.

export interface IpcDeps {
  content: ContentService
  briefing: BriefingService
  settings: SettingsService
  diagnostics: DiagnosticsService
  runNow(): void
  openExternal(url: string): Promise<void>
}

export function registerIpc(d: IpcDeps): void {
  registerDigestIpc(d)
  registerLibraryIpc(d)
  registerSettingsIpc(d)
  registerDiagnosticsIpc(d)
}
