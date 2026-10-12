// ============================================================================
// 사용자 설정 읽기
//
// [역할]
// - 저장된 설정 행(키 · 값)을 앱이 쓰는 설정 모양(AppSettings)으로 읽음
// - 저장된 값이 없는 항목은 기본값 사용
// - Main(설정 화면 · 사용량 표시)과 Worker(예산 확인 · 기사 수)가 같은 규칙으로 읽도록 한 곳에 둠
// - 설정을 바꾸는 일은 여기서 하지 않음 (Main의 설정 서비스가 담당)
// ============================================================================
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'
import type { SettingsRepository } from '@data/repositories/settings-repository'

/**
 * 현재 사용자 설정 읽기
 *
 * @param {SettingsRepository} settingsRepository - 설정 저장소
 * @returns {AppSettings} 기본값 위에 저장된 값을 덮어쓴 설정
 */
export function readAppSettings(settingsRepository: SettingsRepository): AppSettings {
    // 저장된 값은 JSON 글자라서 풀어 읽음
    const storedSettings = Object.fromEntries(
        settingsRepository.listSettings().map((settingRow) => [settingRow.key, JSON.parse(settingRow.value) as unknown])
    )

    return { ...DEFAULT_SETTINGS, ...storedSettings } as AppSettings
}
