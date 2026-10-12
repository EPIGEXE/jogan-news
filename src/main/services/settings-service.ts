// ============================================================================
// 설정 서비스
//
// [역할]
// - API 키 저장 · 삭제와 상태 조회 (키를 바꾸면 Worker에도 바로 알려 다음 호출부터 새 키 사용)
// - 키 자체는 밖으로 내보내지 않음 (어디서 왔는지와 끝 몇 글자만)
// - 키를 지우면 개발 중에는 .env의 키로 돌아감 (Worker에는 그렇게 정해진 키를 전달)
// - 앱 설정 · 사용 비용 조회와 설정 변경을 Worker에 전달
// - Windows 시작 시 실행 켜기 · 끄기
// ============================================================================
import type { ApiKeyStatus } from '@shared/ipc'
import type { AppSettings, UsageSummary } from '@shared/types'
import type { ApiKeyStore, AutostartPort, WorkerRpc } from './ports'

/**
 * 설정 (API 키 · 예산 · 자동 시작)
 */
export class SettingsService {
    constructor(
        private readonly deps: {
            keys: ApiKeyStore // API 키 보관소
            autostart: AutostartPort // Windows 시작 시 실행
            worker: WorkerRpc // 앱 설정 · 사용 비용을 가진 Worker
        }
    ) {}

    // API 키 상태 (키가 어디서 왔는지와 끝 몇 글자)
    apiKeyStatus(): ApiKeyStatus {
        return this.deps.keys.getStatus()
    }

    /**
     * API 키 저장 · 삭제
     * - 바뀐 뒤 실제로 쓸 키를 Worker에 바로 알림
     *
     * @param {string | null} apiKey - 새 키. null이나 빈 문자열이면 저장된 키 삭제 (개발 중에는 .env 키로 돌아감)
     * @returns {ApiKeyStatus} 바뀐 뒤의 키 상태
     */
    setApiKey(apiKey: string | null): ApiKeyStatus {
        // 보관소에 저장 (null이나 빈 문자열이면 저장된 키 삭제)
        this.deps.keys.setApiKey(apiKey)

        // 받은 값이 아니라 보관소에서 다시 읽은 키를 Worker에 전달
        // (지웠을 때 .env 키로 돌아가는 경우까지 같은 값을 쓰게 함)
        this.deps.worker.setApiKey(this.deps.keys.getApiKey())

        // 바뀐 뒤의 상태 반환
        return this.deps.keys.getStatus()
    }

    // 앱 설정 조회 (저장한 값이 없는 항목은 기본값)
    getSettings(): Promise<AppSettings> {
        return this.deps.worker.call('getSettings')
    }

    // 바꿀 항목만 받아 설정 변경 → 바뀐 뒤의 전체 설정
    updateSettings(settingsPatch: Partial<AppSettings>): Promise<AppSettings> {
        return this.deps.worker.call('updateSettings', settingsPatch)
    }

    // LLM 사용 비용 요약 (이번 달 · 오늘 쓴 비용, 월 예산 · 하루 상한, 절약 모드 여부)
    getUsage(): Promise<UsageSummary> {
        return this.deps.worker.call('getUsage')
    }

    // Windows 시작 시 실행이 켜져 있는지
    isAutostartEnabled(): boolean {
        return this.deps.autostart.isEnabled()
    }

    // 자동 시작 켜기 · 끄기 (바꾼 뒤의 실제 상태를 돌려줌)
    setAutostart(shouldEnable: boolean): boolean {
        return this.deps.autostart.setEnabled(shouldEnable)
    }
}
