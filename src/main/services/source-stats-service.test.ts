// ============================================================================
// 출처 통계 서비스 테스트
//
// [역할]
// - 저장소 집계에 설정의 출처 설명을 붙이고, 기록이 없는 출처를 빈 값으로 채우는지 확인
// - 전체 흐름이 설정에서 빠진 옛 출처까지 합하는지, 기간에 따라 개수 · 실패 · 비용이 달라지는지 확인
// - 날마다 추이가 오늘까지 30일로 채워지는지 확인
// ============================================================================
import { describe, expect, it } from 'vitest'
import { dateKey } from '@shared/schedule'
import type { SourceConfig } from '@config/index'
import { SourceStatsService } from './source-stats-service'
import { createTestRepositories, insertTestItem } from './test-support'

const DIGEST_STATS = { sources: 1, collected: 1, candidates: 1, selected: 1, costUsd: 0, failedSources: [], saveMode: false }

// 설정의 출처 두 곳: 기록이 있는 켜진 출처와, 기록이 없는 꺼진 출처
const SOURCES = [
    { id: 'hn', name: 'Hacker News', type: 'rss', enabled: true, weight: 1.2, kind: 'community', url: 'https://hn.example/rss' },
    { id: 'quiet', name: 'Quiet Blog', type: 'rss', enabled: false, weight: 1, kind: 'blog', url: 'https://quiet.example/rss' }
] as unknown as SourceConfig[]

function setup() {
    const repositories = createTestRepositories()
    const sourceStatsService = new SourceStatsService({ ...repositories, sources: SOURCES })
    return { ...repositories, sourceStatsService }
}

describe('SourceStatsService', () => {
    it('설정의 출처마다 단계 개수 · 수집 기록 · 실린 기사를 붙이고, 전체 흐름은 설정에 없는 출처까지 합한다', () => {
        const { sourceStatsService, itemRepository, digestRepository, libraryRepository, sourceFetchRepository } = setup()
        const publishedItemId = insertTestItem(itemRepository, { title: 'A one' })
        insertTestItem(itemRepository, { title: 'A two' })
        const mergedItemId = insertTestItem(itemRepository, { sourceId: 'gn', sourceName: 'GeekNews', title: 'G one' })
        itemRepository.updateItemTriage(publishedItemId, { category: 'tools', relevance: 0.9, importance: 4 })
        itemRepository.updateItemsMergedInto([mergedItemId], publishedItemId)
        const digestId = digestRepository.insertDigest('2026-10-08', { headline: '오늘', overview: null, stats: DIGEST_STATS })
        digestRepository.insertEntries(digestId, [{ itemId: publishedItemId, rank: 1, section: 'top', whyItMatters: null }])
        libraryRepository.insertSaveIfAbsent(publishedItemId)

        const nowIso = new Date().toISOString()
        const hourAgoIso = new Date(Date.now() - 3600_000).toISOString()
        sourceFetchRepository.insertSourceFetch({
            sourceId: 'hn',
            at: hourAgoIso,
            reason: 'collect',
            ok: false,
            fetched: 0,
            newItems: 0,
            error: 'HTTP 403'
        })
        sourceFetchRepository.insertSourceFetch({
            sourceId: 'hn',
            at: nowIso,
            reason: 'briefing',
            ok: true,
            fetched: 30,
            newItems: 2,
            error: null
        })

        const sourceStats = sourceStatsService.getSourceStats(7)
        expect(sourceStats.period).toBe(7)
        expect(sourceStats.sources.map((sourceStat) => sourceStat.id)).toEqual(['hn', 'quiet'])

        const [hackerNewsStat, quietStat] = sourceStats.sources
        expect(hackerNewsStat).toMatchObject({
            name: 'Hacker News',
            enabled: true,
            weight: 1.2,
            period: { collected: 2, merged: 0, triaged: 1, published: 1, saved: 1 },
            total: { collected: 2, merged: 0, triaged: 1, published: 1, saved: 1 },
            lastFetch: { fetchedAt: nowIso, ok: true, reason: 'briefing', fetchedCount: 30, newItems: 2 },
            failures: 1,
            recentPublished: [{ itemId: publishedItemId, titleKo: 'A one', digestDate: '2026-10-08' }]
        })
        expect(hackerNewsStat!.recentFetches.map((sourceFetch) => sourceFetch.fetchedAt)).toEqual([nowIso, hourAgoIso])
        expect(hackerNewsStat!.recentFetches[0]).not.toHaveProperty('sourceId')
        expect(typeof hackerNewsStat!.method).toBe('string')

        // 기록이 없는 출처는 빈 값
        expect(quietStat).toMatchObject({
            enabled: false,
            period: { collected: 0, merged: 0, triaged: 0, published: 0, saved: 0 },
            lastFetch: null,
            failures: 0,
            recentFetches: [],
            recentPublished: []
        })

        // 전체 흐름은 설정에 없는 gn의 글(합쳐진 글 1건)까지 합함
        expect(sourceStats.funnel.total).toEqual({ collected: 3, merged: 1, triaged: 1, published: 1, saved: 1 })
        expect(sourceStats.funnel.period).toEqual(sourceStats.funnel.total)
    })

    it('기간 밖의 글 · 실패 · 비용은 고른 기간에서 빠지고 전체에는 남는다', () => {
        const { sourceStatsService, itemRepository, sourceFetchRepository, llmUsageRepository, database } = setup()
        const longAgoIso = new Date(Date.now() - 20 * 24 * 3600_000).toISOString()
        insertTestItem(itemRepository, { collectedAt: longAgoIso })
        insertTestItem(itemRepository)
        sourceFetchRepository.insertSourceFetch({
            sourceId: 'hn',
            at: longAgoIso,
            reason: 'collect',
            ok: false,
            fetched: 0,
            newItems: 0,
            error: 'timeout'
        })
        const tokenUsage = { input: 0, cachedInput: 0, output: 0, reasoning: 0 }
        llmUsageRepository.insertUsage({ runId: null, role: 'summary', model: 'test-model', usage: tokenUsage, latencyMs: 0, costUsd: 0.2 })
        llmUsageRepository.insertUsage({ runId: null, role: 'triage', model: 'test-model', usage: tokenUsage, latencyMs: 0, costUsd: 0.1 })
        // 사용량 한 건을 기간 밖으로 옮김 (기록 시각은 넣을 때의 지금이라 직접 고침)
        database.$client.prepare("UPDATE llm_usage SET at = ? WHERE role = 'triage'").run(longAgoIso)

        const weekStats = sourceStatsService.getSourceStats(7)
        expect(weekStats.sources[0]).toMatchObject({ period: { collected: 1 }, total: { collected: 2 }, failures: 0 })
        expect(weekStats.cost.period).toBeCloseTo(0.2)
        expect(weekStats.cost.total).toBeCloseTo(0.3)
        expect(weekStats.cost.byRole).toEqual([{ role: 'summary', usd: 0.2 }])

        const allStats = sourceStatsService.getSourceStats('all')
        expect(allStats.sources[0]).toMatchObject({ period: { collected: 2 }, failures: 1 })
        expect(allStats.cost.period).toBeCloseTo(0.3)
        expect(allStats.cost.byRole.map((roleCost) => roleCost.role)).toEqual(['summary', 'triage'])
    })

    it('날마다 추이는 오늘까지 30일을 빈 날 없이 채운다', () => {
        const { sourceStatsService, itemRepository, digestRepository } = setup()
        const todayKey = dateKey(new Date())
        const firstItemId = insertTestItem(itemRepository)
        insertTestItem(itemRepository)
        const digestId = digestRepository.insertDigest(todayKey, { headline: '오늘', overview: null, stats: DIGEST_STATS })
        digestRepository.insertEntries(digestId, [{ itemId: firstItemId, rank: 1, section: 'top', whyItMatters: null }])

        const { daily } = sourceStatsService.getSourceStats('all')
        expect(daily).toHaveLength(30)
        expect(daily.at(-1)).toEqual({ date: todayKey, collected: 2, published: 1 })
        expect(daily[0]).toMatchObject({ collected: 0, published: 0 })
        expect(new Set(daily.map((dayCount) => dayCount.date)).size).toBe(30)
    })
})
