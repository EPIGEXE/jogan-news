// ============================================================================
// 출처 통계 서비스
//
// [역할]
// - 출처 페이지의 통계 조립: 저장소의 집계 결과에 설정 파일의 출처 이름 · 수집 방식 · 조건을 붙임
// - 설정의 모든 출처(꺼진 것 포함)를 내보내고, 기록이 없는 출처는 빈 값으로 채움
// - 전체 흐름(단계별 개수의 합)은 설정에서 빠진 옛 출처까지 합함
// - 기간: 최근 7일 · 30일은 지금부터 그만큼 전 시각 이후, 'all'은 제한 없음 (글을 수집한 시각 기준)
// - 날마다 추이는 고른 기간과 상관없이 오늘까지 30일, 기록이 없는 날은 0으로 채움 (로컬 날짜)
// - 출처별 최근 수집 기록은 10건, 최근 브리핑에 실린 기사는 5건까지
// - 읽기만 함 (수집 기록 · LLM 사용량은 Worker가 씀)
// ============================================================================
import { dateKey } from '@shared/schedule'
import type { FunnelCounts, SourceFetchDTO, SourceStatDTO, SourceStatsDTO, StatsPeriod } from '@shared/types'
import { describeSource, type SourceConfig } from '@config/index'
import type { LlmUsageRepository } from '@data/repositories/llm-usage-repository'
import type { SourceFetchRepository } from '@data/repositories/source-fetch-repository'

const DAILY_TREND_DAYS = 30 // 날마다 추이를 보여 주는 기간 (일, 오늘 포함)
const RECENT_FETCHES_PER_SOURCE = 10 // 출처마다 보여 주는 최근 수집 기록 수
const RECENT_PUBLISHED_PER_SOURCE = 5 // 출처마다 보여 주는 최근 브리핑에 실린 기사 수
const DAY_MS = 24 * 3600_000 // 하루 (밀리초)

export interface SourceStatsServiceDeps {
    sourceFetchRepository: SourceFetchRepository // 수집 기록과 출처별 집계
    llmUsageRepository: LlmUsageRepository // LLM 비용 집계
    sources: SourceConfig[] // 설정 파일의 모든 출처 (꺼진 것 포함)
}

// 모든 단계가 0인 단계별 개수
const createEmptyFunnel = (): FunnelCounts => ({ collected: 0, merged: 0, triaged: 0, published: 0, saved: 0 })

// 여러 단계별 개수를 단계마다 더함 (목록이 비었으면 모두 0)
function sumFunnels(funnels: FunnelCounts[]): FunnelCounts {
    return funnels.reduce(
        (funnelSum, funnel) => ({
            collected: funnelSum.collected + funnel.collected,
            merged: funnelSum.merged + funnel.merged,
            triaged: funnelSum.triaged + funnel.triaged,
            published: funnelSum.published + funnel.published,
            saved: funnelSum.saved + funnel.saved
        }),
        createEmptyFunnel()
    )
}

// 출처 ID가 붙은 행 목록을 출처별 묶음으로 정리 (행의 순서는 그대로 유지)
function groupBySource<SourceRow extends { sourceId: string }, GroupedValue>(
    sourceRows: SourceRow[],
    toGroupedValue: (sourceRow: SourceRow) => GroupedValue
): Map<string, GroupedValue[]> {
    const valuesBySource = new Map<string, GroupedValue[]>()
    for (const sourceRow of sourceRows) {
        const valuesOfSource = valuesBySource.get(sourceRow.sourceId) ?? []
        valuesOfSource.push(toGroupedValue(sourceRow))
        valuesBySource.set(sourceRow.sourceId, valuesOfSource)
    }
    return valuesBySource
}

/**
 * 출처 페이지의 통계
 */
export class SourceStatsService {
    constructor(private readonly deps: SourceStatsServiceDeps) {}

    /**
     * 출처별 통계와 전체 흐름 · 비용 · 날마다 추이
     *
     * @param {StatsPeriod} statsPeriod - 통계를 볼 기간 (일 수 또는 'all')
     * @returns {SourceStatsDTO} 설정의 모든 출처에 통계를 붙인 결과
     */
    getSourceStats(statsPeriod: StatsPeriod): SourceStatsDTO {
        const { sourceFetchRepository, llmUsageRepository, sources } = this.deps

        // 고른 기간의 시작 시각 (전체 기간이면 제한 없음)
        const periodStartIso = statsPeriod === 'all' ? null : new Date(Date.now() - statsPeriod * DAY_MS).toISOString()

        // 출처별 단계 개수: 고른 기간과 전체 기간을 따로 집계
        const toFunnelEntry = ({ sourceId, ...funnelCounts }: FunnelCounts & { sourceId: string }) => [sourceId, funnelCounts] as const
        const periodFunnelBySource = new Map(sourceFetchRepository.listFunnelCountsBySource(periodStartIso).map(toFunnelEntry))
        const totalFunnelBySource = new Map(sourceFetchRepository.listFunnelCountsBySource(null).map(toFunnelEntry))

        // 출처별 최근 수집 기록 (최근 것부터), 고른 기간의 수집 실패 횟수
        const recentFetchesBySource = groupBySource(
            sourceFetchRepository.listRecentFetchesPerSource(RECENT_FETCHES_PER_SOURCE),
            ({ sourceId: _sourceId, ...sourceFetch }): SourceFetchDTO => sourceFetch
        )
        const failureCountBySource = new Map(
            sourceFetchRepository
                .countFailuresBySource(periodStartIso)
                .map((sourceFailureCount) => [sourceFailureCount.sourceId, sourceFailureCount.failureCount])
        )

        // 출처별 최근 브리핑에 실린 기사 (최근 날짜 · 순위 순)
        const recentPublishedBySource = groupBySource(
            sourceFetchRepository.listRecentPublishedPerSource(RECENT_PUBLISHED_PER_SOURCE),
            (sourcePublishedItem) => ({
                itemId: sourcePublishedItem.itemId,
                titleKo: sourcePublishedItem.titleKo,
                digestDate: sourcePublishedItem.digestDate
            })
        )

        // 설정의 출처마다 이름 · 수집 방식 · 조건을 붙이고, 기록이 없는 출처는 빈 값으로 채움
        const sourceStats = sources.map((sourceConfig): SourceStatDTO => {
            const sourceDescription = describeSource(sourceConfig)
            const recentFetches = recentFetchesBySource.get(sourceConfig.id) ?? []
            return {
                id: sourceConfig.id,
                name: sourceConfig.name,
                method: sourceDescription.method,
                enabled: sourceConfig.enabled,
                weight: sourceConfig.weight,
                rules: sourceDescription.rules,
                url: sourceDescription.url,
                period: periodFunnelBySource.get(sourceConfig.id) ?? createEmptyFunnel(),
                total: totalFunnelBySource.get(sourceConfig.id) ?? createEmptyFunnel(),
                lastFetch: recentFetches[0] ?? null, // 최근 것부터 정렬돼 있어 첫 번째가 가장 최근
                failures: failureCountBySource.get(sourceConfig.id) ?? 0,
                recentFetches,
                recentPublished: recentPublishedBySource.get(sourceConfig.id) ?? []
            }
        })

        // 고른 기간의 용도별 LLM 비용 (큰 순), 고른 기간의 비용은 그 합
        const costByRole = llmUsageRepository.listCostByRole(periodStartIso)

        // 전체 흐름은 DB에 있는 모든 출처를 합함 (설정에서 빠진 옛 출처 포함)
        return {
            period: statsPeriod,
            funnel: { period: sumFunnels([...periodFunnelBySource.values()]), total: sumFunnels([...totalFunnelBySource.values()]) },
            cost: {
                period: costByRole.reduce((periodCostUsd, roleCost) => periodCostUsd + roleCost.usd, 0),
                total: llmUsageRepository.sumCostTotal(),
                byRole: costByRole
            },
            daily: this.listDailyCounts(),
            sources: sourceStats
        }
    }

    // 오늘까지 30일의 날짜별 수집한 글 수 · 브리핑에 실린 글 수 (모든 출처 합계, 기록이 없는 날은 0)
    private listDailyCounts(): SourceStatsDTO['daily'] {
        const { sourceFetchRepository } = this.deps

        // 시작 날짜는 오늘에서 29일 전 (로컬 날짜)
        const dailyStartDate = new Date()
        dailyStartDate.setDate(dailyStartDate.getDate() - (DAILY_TREND_DAYS - 1))
        const dailyStartDateKey = dateKey(dailyStartDate)

        // 시작 날짜 이후의 날짜별 개수 (개수가 0인 날은 들어 있지 않음)
        const collectedCountByDay = new Map(
            sourceFetchRepository.listCollectedCountsByDay(dailyStartDateKey).map((dayCount) => [dayCount.date, dayCount.count])
        )
        const publishedCountByDay = new Map(
            sourceFetchRepository.listPublishedCountsByDay(dailyStartDateKey).map((dayCount) => [dayCount.date, dayCount.count])
        )

        // 시작 날짜부터 오늘까지 하루씩 채움 (기록이 없는 날은 0)
        const dailyCounts: SourceStatsDTO['daily'] = []
        for (let dayOffset = 0; dayOffset < DAILY_TREND_DAYS; dayOffset++) {
            const dayDate = new Date(dailyStartDate)
            dayDate.setDate(dailyStartDate.getDate() + dayOffset)
            const dayKey = dateKey(dayDate)
            dailyCounts.push({
                date: dayKey,
                collected: collectedCountByDay.get(dayKey) ?? 0,
                published: publishedCountByDay.get(dayKey) ?? 0
            })
        }
        return dailyCounts
    }
}
