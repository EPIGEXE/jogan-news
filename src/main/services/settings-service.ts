import type { ApiKeyStatus } from '@shared/ipc'
import type { AppSettings, UsageSummary } from '@shared/types'
import type { ApiKeyStore, AutostartPort, WorkerRpc } from './ports'

// 설정: API 키, 예산, 자동 시작. API 키를 바꾸면 Worker에도 바로 알려서 다음 호출부터 새 키를 쓴다.

export class SettingsService {
  constructor(
    private readonly d: {
      keys: ApiKeyStore
      autostart: AutostartPort
      worker: WorkerRpc
    }
  ) {}

  apiKeyStatus(): ApiKeyStatus {
    return this.d.keys.status()
  }

  /** null이나 빈 문자열이면 저장된 키를 지운다 (개발 중에는 .env 키로 돌아감) */
  setApiKey(key: string | null): ApiKeyStatus {
    this.d.keys.set(key)
    this.d.worker.setApiKey(this.d.keys.get())
    return this.d.keys.status()
  }

  getSettings(): Promise<AppSettings> {
    return this.d.worker.call('getSettings')
  }

  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return this.d.worker.call('updateSettings', patch)
  }

  getUsage(): Promise<UsageSummary> {
    return this.d.worker.call('getUsage')
  }

  isAutostartEnabled(): boolean {
    return this.d.autostart.isEnabled()
  }

  setAutostart(on: boolean): boolean {
    return this.d.autostart.set(on)
  }
}
