// ============================================================================
// 설정 서비스 테스트
//
// [역할]
// - API 키를 저장 · 삭제할 때 Worker에 실제로 쓸 키를 바로 알리는지 확인
// - 저장된 키가 없을 때 개발용 .env 키 또는 null로 돌아가는지 확인
// - 앱 설정: 저장한 값이 없으면 기본값, 바꾸면 넘긴 항목만 저장되는지 확인
// - 사용 비용 요약: 사용액 합계와 절약 모드 판정 확인
// ============================================================================
import { describe, expect, it } from 'vitest'
import type { ApiKeyStatus } from '@shared/ipc'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { ApiKeyStore } from './ports'
import { SettingsService } from './settings-service'
import { createFakeWorker, createTestRepositories } from './test-support'

// 메모리에만 저장하는 가짜 키 보관소 (envKey는 개발용 .env 키 흉내)
function createMemoryKeyStore(envKey: string | null = null): ApiKeyStore {
    let storedKey: string | null = null
    return {
        getApiKey: () => storedKey ?? envKey,
        getStatus: (): ApiKeyStatus =>
            storedKey
                ? { source: 'stored', hint: storedKey.slice(-4) }
                : envKey
                  ? { source: 'env', hint: envKey.slice(-4) }
                  : { source: 'none', hint: null },
        setApiKey: (apiKey) => {
            storedKey = apiKey?.trim() || null
        }
    }
}

function setup(envKey: string | null = null) {
    const repositories = createTestRepositories()
    const fakeWorker = createFakeWorker()
    const settingsService = new SettingsService({
        ...repositories,
        keys: createMemoryKeyStore(envKey),
        autostart: { isEnabled: () => false, setEnabled: (shouldEnable) => shouldEnable },
        worker: fakeWorker.worker
    })
    return { ...repositories, settingsService, workerSetApiKey: fakeWorker.setApiKey }
}

describe('SettingsService', () => {
    it('키를 저장하면 Worker에 새 키를 바로 알리고 상태를 돌려준다', () => {
        const { settingsService, workerSetApiKey } = setup()
        expect(settingsService.setApiKey('  gsk_abcd1234  ')).toEqual({ source: 'stored', hint: '1234' })
        expect(workerSetApiKey).toHaveBeenLastCalledWith('gsk_abcd1234')
    })

    it('저장된 키를 지우면 개발용 .env 키로 돌아가고 Worker에도 그 키를 알린다', () => {
        const { settingsService, workerSetApiKey } = setup('gsk_env_9999')
        settingsService.setApiKey('gsk_user_1111')
        expect(settingsService.setApiKey(null)).toEqual({ source: 'env', hint: '9999' })
        expect(workerSetApiKey).toHaveBeenLastCalledWith('gsk_env_9999')
    })

    it('키가 하나도 없으면 Worker에 null을 알린다', () => {
        const { settingsService, workerSetApiKey } = setup()
        expect(settingsService.setApiKey('')).toEqual({ source: 'none', hint: null })
        expect(workerSetApiKey).toHaveBeenLastCalledWith(null)
    })

    it('저장한 설정이 없으면 기본값을 돌려준다', () => {
        const { settingsService } = setup()
        expect(settingsService.getSettings()).toEqual(DEFAULT_SETTINGS)
    })

    it('설정은 넘긴 항목만 바꾸고, 바뀐 뒤의 전체 설정을 돌려준다', () => {
        const { settingsService, settingsRepository } = setup()

        expect(settingsService.updateSettings({ budgetUsd: 3 })).toEqual({ ...DEFAULT_SETTINGS, budgetUsd: 3 })
        // 값이 undefined인 항목은 저장하지 않음
        expect(settingsService.updateSettings({ digestSize: 10, dailyCapUsd: undefined })).toEqual({
            ...DEFAULT_SETTINGS,
            budgetUsd: 3,
            digestSize: 10
        })
        expect(
            settingsRepository
                .listSettings()
                .map((settingRow) => settingRow.key)
                .sort()
        ).toEqual(['budgetUsd', 'digestSize'])
        expect(settingsService.getSettings()).toMatchObject({ budgetUsd: 3, digestSize: 10, dailyCapUsd: DEFAULT_SETTINGS.dailyCapUsd })
    })

    it('사용 비용 요약: 이번 달 사용액이 월 예산에 도달하면 절약 모드', () => {
        const { settingsService, llmUsageRepository } = setup()
        expect(settingsService.getUsage()).toEqual({ monthUsd: 0, todayUsd: 0, budgetUsd: 5, dailyCapUsd: 0.5, saveMode: false })

        llmUsageRepository.insertUsage({
            runId: null,
            role: 'summary',
            model: 'test-model',
            usage: { input: 0, cachedInput: 0, output: 0, reasoning: 0 },
            latencyMs: 0,
            costUsd: 2
        })
        expect(settingsService.getUsage()).toMatchObject({ monthUsd: 2, todayUsd: 2, saveMode: false })

        // 월 예산을 사용액 아래로 내리면 절약 모드
        settingsService.updateSettings({ budgetUsd: 2 })
        expect(settingsService.getUsage()).toMatchObject({ budgetUsd: 2, saveMode: true })
    })
})
