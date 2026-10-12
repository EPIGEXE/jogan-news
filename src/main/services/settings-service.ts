// ============================================================================
// 설정 서비스
//
// [역할]
// - API 키 저장 · 삭제와 상태 조회 (키를 바꾸면 Worker에도 바로 알려 다음 호출부터 새 키 사용)
// - 키 자체는 밖으로 내보내지 않음 (어디서 왔는지와 끝 몇 글자만)
// - 키를 지우면 개발 중에는 .env의 키로 돌아감 (Worker에는 그렇게 정해진 키를 전달)
// - 앱 설정 조회 · 변경: 저장된 값이 없는 항목은 기본값, 바꿀 때는 넘긴 항목만 저장 (값은 JSON 글자로 보관)
// - LLM 사용 비용 요약 (이번 달 · 오늘 사용액, 월 예산 · 하루 상한, 절약 모드 여부)
// - Windows 시작 시 실행 켜기 · 끄기
// ============================================================================
import type { ApiKeyStatus } from '@shared/ipc'
import type { AppSettings, UsageSummary } from '@shared/types'
import { readAppSettings } from '@domain/app-settings'
import { summarizeUsage } from '@domain/usage'
import { runInTransaction, type AppDatabase } from '@data/client'
import type { LlmUsageRepository } from '@data/repositories/llm-usage-repository'
import type { SettingsRepository } from '@data/repositories/settings-repository'
import type { ApiKeyStore, AutostartPort, WorkerRpc } from './ports'

export interface SettingsServiceDeps {
    database: AppDatabase // 여러 쓰기를 한 묶음으로 실행할 때만 사용
    settingsRepository: SettingsRepository // 앱 설정 저장소
    llmUsageRepository: LlmUsageRepository // 사용 비용 집계 (읽기만)
    keys: ApiKeyStore // API 키 보관소
    autostart: AutostartPort // Windows 시작 시 실행
    worker: Pick<WorkerRpc, 'setApiKey'> // 바뀐 API 키를 알릴 Worker
}

/**
 * 설정 (API 키 · 예산 · 자동 시작)
 */
export class SettingsService {
    constructor(private readonly deps: SettingsServiceDeps) {}

    // API 키 상태 (키가 어디서 왔는지와 끝 몇 글자)
    apiKeyStatus(): ApiKeyStatus {
        return this.deps.keys.getStatus()
    }

    /**
     * API 키 저장 · 삭제
     *
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
    getSettings(): AppSettings {
        return readAppSettings(this.deps.settingsRepository)
    }

    /**
     * 앱 설정 변경
     *
     * - 넘긴 항목만 저장 (값이 undefined인 항목은 건드리지 않음)
     *
     * @param {Partial<AppSettings>} settingsPatch - 바꿀 항목
     * @returns {AppSettings} 바뀐 뒤의 전체 설정
     */
    updateSettings(settingsPatch: Partial<AppSettings>): AppSettings {
        const { database, settingsRepository } = this.deps

        // 넘긴 항목을 한 묶음으로 저장 (중간에 실패하면 하나도 바뀌지 않음)
        runInTransaction(database, () => {
            for (const [settingKey, settingValue] of Object.entries(settingsPatch)) {
                // 값이 없는 항목은 건드리지 않음
                if (settingValue === undefined) continue

                // 항목 저장 (이미 있으면 값 교체, 값은 JSON 글자로)
                settingsRepository.upsertSetting(settingKey, JSON.stringify(settingValue))
            }
        })
        return readAppSettings(settingsRepository)
    }

    // LLM 사용 비용 요약 (이번 달 · 오늘 쓴 비용, 월 예산 · 하루 상한, 절약 모드 여부)
    getUsage(): UsageSummary {
        return summarizeUsage(this.deps.llmUsageRepository, this.deps.settingsRepository)
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
