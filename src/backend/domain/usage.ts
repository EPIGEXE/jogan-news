// ============================================================================
// LLM 사용액 집계
//
// [역할]
// - 이번 달 · 오늘 쓴 LLM 비용과 한도(월 예산 · 하루 상한)를 한 묶음으로 계산
// - 절약 모드 판정: 이번 달 사용액이 월 예산 이상
// - 기준 시각은 로컬 시간 (이번 달 1일 0시, 오늘 0시)
// - Main(화면의 비용 표시)과 Worker(생성 · 번역 전 한도 확인)가 같은 규칙을 쓰도록 한 곳에 둠
// ============================================================================
import { dateKey } from '@shared/schedule'
import type { UsageSummary } from '@shared/types'
import type { LlmUsageRepository } from '@data/repositories/llm-usage-repository'
import type { SettingsRepository } from '@data/repositories/settings-repository'
import { readAppSettings } from './app-settings'

/**
 * 지금 시점의 사용액과 한도 계산
 *
 * @param {LlmUsageRepository} llmUsageRepository - LLM 사용량 저장소
 * @param {SettingsRepository} settingsRepository - 설정 저장소 (월 예산 · 하루 상한)
 * @param {Date} [now] - 기준 시각 (테스트용, 기본은 지금)
 * @returns {UsageSummary} 이번 달 · 오늘 사용액, 월 예산, 하루 상한, 절약 모드 여부
 */
export function summarizeUsage(
    llmUsageRepository: LlmUsageRepository,
    settingsRepository: SettingsRepository,
    now: Date = new Date()
): UsageSummary {
    const appSettings = readAppSettings(settingsRepository)

    // 이번 달 1일 0시 · 오늘 0시(로컬 시간)부터 쓴 금액
    const monthUsd = llmUsageRepository.sumCostSince(new Date(now.getFullYear(), now.getMonth(), 1).toISOString())
    const todayUsd = llmUsageRepository.sumCostSince(new Date(`${dateKey(now)}T00:00:00`).toISOString())

    return {
        monthUsd,
        todayUsd,
        budgetUsd: appSettings.budgetUsd,
        dailyCapUsd: appSettings.dailyCapUsd,
        saveMode: monthUsd >= appSettings.budgetUsd // 이번 달 사용액이 월 예산에 도달하면 절약 모드
    }
}
