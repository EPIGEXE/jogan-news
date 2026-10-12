// ============================================================================
// 수집 서비스 테스트
//
// [역할]
// - 메모리 DB에 실제 저장소를 붙여 수집 서비스의 규칙 확인 (출처에서 글을 받아 오는 일만 가짜)
// - 같은 글 판정(주소 · 최근 3일 안의 같은 제목), 다른 출처 합치기, 대표 참여도 · 소개 글 고르기
// - 같은 소식을 대표 글로 합치기, 수집 기록 · 실패한 출처 · 오래된 기록 지우기
// - 미리 수집을 건너뛰는 경우 (브리핑 생성 중 · 이미 수집 중)
// ============================================================================
import { describe, expect, it } from 'vitest'
import type { RawItem } from '../collectors/types'
import { CollectService, type CollectDeps } from './collect-service'
import { createRawItem, createTestConfig, openTestRepositories } from './testing'

const DAY_MS = 24 * 3600 * 1000

// 수집 서비스와 그 서비스가 쓰는 저장소 준비 (출처에서 받아 오는 글은 테스트가 정함)
function setUp(overrides: Partial<CollectDeps> = {}) {
    const repositories = openTestRepositories()
    const logMessages: string[] = []
    const collectService = new CollectService({
        ...repositories,
        config: createTestConfig(),
        collectSource: async () => [],
        isBriefingRunning: () => false,
        log: (_level, logMessage) => logMessages.push(logMessage),
        ...overrides
    })
    return { ...repositories, collectService, logMessages }
}

describe('같은 글 판정', () => {
    it('주소가 같으면(추적 파라미터만 다름) 한 기사로 합치고, 다른 출처는 다른 출처 목록에 쌓는다', () => {
        const { collectService, itemRepository } = setUp()

        const first = collectService.storeRawItem(createRawItem())
        const second = collectService.storeRawItem(
            createRawItem({
                sourceId: 'gn',
                sourceName: 'GeekNews',
                url: 'https://mistral.ai/news/large-4',
                engagement: 0,
                engagementLabel: null
            })
        )

        expect(first.isNew).toBe(true)
        expect(second).toEqual({ itemId: first.itemId, isNew: false })
        const itemRow = itemRepository.findItemById(first.itemId)!
        expect(itemRow.otherSources).toEqual([{ sourceName: 'GeekNews', url: 'https://mistral.ai/news/large-4', engagementLabel: null }])
        expect(itemRow.engagement).toBe(100)
        expect(itemRow.engagementLabel).toBe('HN 100점')
    })

    it('주소가 달라도 최근 3일 안에 수집한 글과 제목이 같으면 같은 글이다', () => {
        const { collectService, itemRepository } = setUp()

        const first = collectService.storeRawItem(createRawItem())
        const second = collectService.storeRawItem(
            createRawItem({ sourceId: 'tc', sourceName: 'TechCrunch', url: 'https://techcrunch.com/mistral-large-4' })
        )

        expect(second).toEqual({ itemId: first.itemId, isNew: false })
        expect(itemRepository.findItemById(first.itemId)!.otherSources.map((otherSource) => otherSource.sourceName)).toEqual(['TechCrunch'])
    })

    it('제목이 같아도 3일보다 전에 수집한 글이면 새 기사로 넣는다', () => {
        const { collectService, itemRepository } = setUp()

        // 4일 전에 수집한 글을 직접 넣음
        const oldItemId = itemRepository.insertItem({
            urlKey: 'old.example.com/large-4',
            url: 'https://old.example.com/large-4',
            sourceId: 'hn',
            sourceName: 'Hacker News',
            kind: 'community',
            title: 'Mistral Large 4 released',
            titleNorm: 'mistral large 4 released',
            snippet: '',
            lang: 'en',
            publishedAt: null,
            engagement: 0,
            engagementLabel: null,
            collectedAt: new Date(Date.now() - 4 * DAY_MS).toISOString()
        })

        const stored = collectService.storeRawItem(createRawItem())
        expect(stored.isNew).toBe(true)
        expect(stored.itemId).not.toBe(oldItemId)
    })

    it('정규화한 제목이 12자보다 짧으면 제목으로는 합치지 않는다', () => {
        const { collectService } = setUp()

        const first = collectService.storeRawItem(createRawItem({ title: 'GPT-6', url: 'https://a.com/1' }))
        const second = collectService.storeRawItem(createRawItem({ title: 'GPT-6', url: 'https://b.com/2' }))

        expect(second.isNew).toBe(true)
        expect(second.itemId).not.toBe(first.itemId)
    })

    it('처음 보는 글은 검색 색인에 올린다', () => {
        const { collectService, database } = setUp()

        const stored = collectService.storeRawItem(createRawItem({ title: 'Agent memory benchmark', url: 'https://a.com/1' }))

        const indexedRowIds = database.$client.prepare('SELECT rowid FROM search_fts WHERE search_fts MATCH \'"benchmark"\'').all()
        expect(indexedRowIds).toEqual([{ rowid: stored.itemId }])
    })
})

describe('참여도와 소개 글 고르기', () => {
    it('같은 출처에서 다시 오면 오른 참여도만 갱신하고, 비어 있던 소개 글은 채운다', () => {
        const { collectService, itemRepository } = setUp()
        const { itemId } = collectService.storeRawItem(createRawItem())

        // 참여도가 오르고 소개 글이 생김 → 둘 다 반영, 다른 출처 목록은 그대로
        collectService.storeRawItem(createRawItem({ engagement: 250, engagementLabel: 'HN 250점', snippet: '새 소개 글' }))
        expect(itemRepository.findItemById(itemId)).toMatchObject({
            engagement: 250,
            engagementLabel: 'HN 250점',
            snippet: '새 소개 글',
            otherSources: []
        })

        // 참여도가 내려갔고 소개 글이 이미 있음 → 그대로
        collectService.storeRawItem(
            createRawItem({ engagement: 10, engagementLabel: 'HN 10점', snippet: '더 길게 바뀐 소개 글이지만 쓰지 않음' })
        )
        expect(itemRepository.findItemById(itemId)).toMatchObject({ engagement: 250, engagementLabel: 'HN 250점', snippet: '새 소개 글' })
    })

    it('다른 출처에서 오면 더 큰 참여도와 더 긴 소개 글을 대표 값으로 쓴다', () => {
        const { collectService, itemRepository } = setUp()
        const { itemId } = collectService.storeRawItem(createRawItem({ snippet: '짧은 소개' }))

        collectService.storeRawItem(
            createRawItem({
                sourceId: 'hf',
                sourceName: 'HF Papers',
                url: 'https://mistral.ai/news/large-4',
                engagement: 300,
                engagementLabel: 'HF 300',
                snippet: '훨씬 더 길게 쓴 초록 전체'
            })
        )
        expect(itemRepository.findItemById(itemId)).toMatchObject({
            engagement: 300,
            engagementLabel: 'HF 300',
            snippet: '훨씬 더 길게 쓴 초록 전체'
        })

        // 참여도가 더 작고 소개 글이 더 짧은 출처 → 출처 목록에만 올리고 대표 값은 그대로
        collectService.storeRawItem(
            createRawItem({
                sourceId: 'gn',
                sourceName: 'GeekNews',
                url: 'https://mistral.ai/news/large-4',
                engagement: 5,
                engagementLabel: 'GN 5',
                snippet: '짧음'
            })
        )
        const itemRow = itemRepository.findItemById(itemId)!
        expect(itemRow).toMatchObject({ engagement: 300, engagementLabel: 'HF 300', snippet: '훨씬 더 길게 쓴 초록 전체' })
        expect(itemRow.otherSources.map((otherSource) => otherSource.sourceName)).toEqual(['HF Papers', 'GeekNews'])
    })

    it('이미 목록에 있는 출처 이름이면 다시 올리지 않는다', () => {
        const { collectService, itemRepository } = setUp()
        const { itemId } = collectService.storeRawItem(createRawItem())
        const fromGeekNews = createRawItem({ sourceId: 'gn', sourceName: 'GeekNews', url: 'https://mistral.ai/news/large-4' })

        collectService.storeRawItem(fromGeekNews)
        collectService.storeRawItem(fromGeekNews)

        expect(itemRepository.findItemById(itemId)!.otherSources).toHaveLength(1)
    })
})

describe('같은 소식을 대표 글로 합치기', () => {
    it('합쳐진 글의 출처를 대표로 옮기고, 합쳐진 글은 다음 후보에서 빠진다', () => {
        const { collectService, itemRepository } = setUp()
        const representative = collectService.storeRawItem(createRawItem())
        const member = collectService.storeRawItem(
            createRawItem({
                sourceId: 'tc',
                sourceName: 'TechCrunch',
                title: 'Mistral launches a 1T model',
                url: 'https://techcrunch.com/mistral',
                engagement: 0,
                engagementLabel: null
            })
        )

        const mergedRepresentative = collectService.mergeItemsInto(representative.itemId, [member.itemId])

        expect(mergedRepresentative).toEqual({ otherSourceCount: 1, engagement: 100 })
        expect(itemRepository.findItemById(member.itemId)!.mergedInto).toBe(representative.itemId)
        expect(itemRepository.findItemById(representative.itemId)!.otherSources).toEqual([
            { sourceName: 'TechCrunch', url: 'https://techcrunch.com/mistral', engagementLabel: null }
        ])
        expect(
            itemRepository.listBriefingCandidates(new Date(0).toISOString(), '2026-10-07').map((candidateRow) => candidateRow.id)
        ).toEqual([representative.itemId])
    })

    it('합쳐진 글에 이미 붙어 있던 출처도 옮기고, 대표 참여도는 묶인 글 중 가장 큰 값이다', () => {
        const { collectService, itemRepository } = setUp()
        const representative = collectService.storeRawItem(createRawItem({ engagement: 10, engagementLabel: 'HN 10점' }))
        const member = collectService.storeRawItem(
            createRawItem({
                sourceId: 'rd',
                sourceName: 'Reddit',
                title: 'Mistral ships its largest model yet',
                url: 'https://reddit.com/r/ml/1',
                engagement: 900,
                engagementLabel: 'Reddit 900'
            })
        )
        // 합쳐질 글에 다른 출처가 하나 붙어 있음
        collectService.storeRawItem(
            createRawItem({
                sourceId: 'gn',
                sourceName: 'GeekNews',
                url: 'https://reddit.com/r/ml/1',
                engagement: 0,
                engagementLabel: null
            })
        )

        const mergedRepresentative = collectService.mergeItemsInto(representative.itemId, [member.itemId])

        expect(mergedRepresentative).toEqual({ otherSourceCount: 2, engagement: 900 })
        const representativeRow = itemRepository.findItemById(representative.itemId)!
        expect(representativeRow.engagementLabel).toBe('Reddit 900')
        expect(representativeRow.otherSources.map((otherSource) => otherSource.sourceName)).toEqual(['Reddit', 'GeekNews'])
    })

    it('대표 자신과 없는 번호는 건너뛰고, 같은 출처(이름 · 주소)는 두 번 넣지 않는다', () => {
        const { collectService, itemRepository } = setUp()
        const representative = collectService.storeRawItem(createRawItem())
        const member = collectService.storeRawItem(
            createRawItem({
                sourceId: 'tc',
                sourceName: 'TechCrunch',
                title: 'Mistral launches a 1T model',
                url: 'https://techcrunch.com/mistral'
            })
        )

        collectService.mergeItemsInto(representative.itemId, [representative.itemId, 9999, member.itemId])
        const mergedAgain = collectService.mergeItemsInto(representative.itemId, [member.itemId])

        expect(mergedAgain.otherSourceCount).toBe(1)
        expect(itemRepository.findItemById(representative.itemId)!.mergedInto).toBeNull()
    })

    it('대표 기사가 없으면 오류', () => {
        const { collectService } = setUp()
        expect(() => collectService.mergeItemsInto(9999, [1])).toThrow('대표 기사')
    })
})

describe('출처에서 수집해 쌓기', () => {
    it('새로 쌓인 글만 세고, 출처마다 수집 기록을 남긴다', async () => {
        const feedItems: RawItem[] = [
            createRawItem({ sourceId: 'feed', sourceName: 'Test Feed', title: 'First story about agents', url: 'https://feed.test/1' }),
            createRawItem({ sourceId: 'feed', sourceName: 'Test Feed', title: 'Second story about models', url: 'https://feed.test/2' })
        ]
        const { collectService, sourceFetchRepository } = setUp({ collectSource: async () => feedItems })

        expect(await collectService.collectAndStore(new Date(0), 'briefing')).toEqual({ collected: 2, failedSources: [] })
        // 같은 글이 다시 오면 새 글로 세지 않음
        expect(await collectService.collectAndStore(new Date(0), 'collect')).toEqual({ collected: 0, failedSources: [] })

        expect(
            sourceFetchRepository.listRecentFetchesPerSource(5).map((fetchRecord) => [fetchRecord.reason, fetchRecord.newItems])
        ).toEqual(
            expect.arrayContaining([
                ['briefing', 2],
                ['collect', 0]
            ])
        )
        expect(sourceFetchRepository.listRecentFetchesPerSource(5)).toHaveLength(2)
        expect(sourceFetchRepository.listRecentFetchesPerSource(5)[0]).toMatchObject({
            sourceId: 'feed',
            ok: true,
            fetchedCount: 2,
            error: null
        })
    })

    it('출처가 실패해도 끝까지 진행하고, 실패를 수집 기록(오류 첫 줄)과 결과에 남긴다', async () => {
        const { collectService, sourceFetchRepository, logMessages } = setUp({
            collectSource: async () => {
                throw new Error('HTTP 403\n자세한 내용')
            }
        })

        const collectResult = await collectService.collectAndStore(new Date(0), 'collect')

        expect(collectResult).toEqual({ collected: 0, failedSources: ['Test Feed (HTTP 403\n자세한 내용)'] })
        expect(sourceFetchRepository.listRecentFetchesPerSource(1)).toMatchObject([
            { sourceId: 'feed', ok: false, fetchedCount: 0, newItems: 0, error: 'HTTP 403', reason: 'collect' }
        ])
        expect(logMessages.some((logMessage) => logMessage.startsWith('수집 실패: Test Feed'))).toBe(true)
    })

    it('90일이 지난 수집 기록은 지운다', async () => {
        const { collectService, sourceFetchRepository } = setUp()
        sourceFetchRepository.insertSourceFetch({
            sourceId: 'feed',
            at: '2020-01-01T00:00:00.000Z',
            reason: 'briefing',
            ok: true,
            fetched: 1,
            newItems: 0,
            error: null
        })

        await collectService.collectAndStore(new Date(0), 'briefing')

        const remainingFetches = sourceFetchRepository.listRecentFetchesPerSource(10)
        expect(remainingFetches).toHaveLength(1)
        expect(remainingFetches[0]!.fetchedAt).not.toBe('2020-01-01T00:00:00.000Z')
    })

    it('진행 상황을 출처 수만큼 알리고 중복 합치기 단계로 넘어간다', async () => {
        const { collectService } = setUp()
        const stages: string[] = []

        await collectService.collectAndStore(new Date(0), 'briefing', (runProgress) =>
            stages.push(`${runProgress.stage}:${runProgress.current ?? ''}/${runProgress.total ?? ''}`)
        )

        expect(stages).toEqual(['collect:0/1', 'collect:1/1', 'dedup:/'])
    })
})

describe('미리 수집', () => {
    it('최근 24시간 글을 받아 쌓고 새 글 수를 돌려준다', async () => {
        let receivedSince: Date | null = null
        const { collectService, sourceFetchRepository } = setUp({
            collectSource: async (_source, since) => {
                receivedSince = since
                return [createRawItem({ url: 'https://feed.test/1' })]
            }
        })

        expect(await collectService.collectOnly()).toEqual({ collected: 1, skipped: false })

        const hoursAgo = (Date.now() - receivedSince!.getTime()) / 3600_000
        expect(hoursAgo).toBeGreaterThan(23.9)
        expect(hoursAgo).toBeLessThan(24.1)
        expect(sourceFetchRepository.listRecentFetchesPerSource(1)[0]!.reason).toBe('collect')
    })

    it('브리핑을 만드는 중이면 건너뛴다', async () => {
        let collectCallCount = 0
        const { collectService } = setUp({
            isBriefingRunning: () => true,
            collectSource: async () => {
                collectCallCount++
                return []
            }
        })

        expect(await collectService.collectOnly()).toEqual({ collected: 0, skipped: true })
        expect(collectCallCount).toBe(0)
    })

    it('이미 수집 중이면 건너뛰고, 끝난 뒤에는 다시 받는다', async () => {
        let releaseCollect: (rawItems: RawItem[]) => void = () => {}
        const { collectService } = setUp({
            collectSource: () => new Promise<RawItem[]>((resolve) => (releaseCollect = resolve))
        })

        const firstCollect = collectService.collectOnly()
        expect(await collectService.collectOnly()).toEqual({ collected: 0, skipped: true })

        releaseCollect([])
        expect(await firstCollect).toEqual({ collected: 0, skipped: false })

        const thirdCollect = collectService.collectOnly()
        releaseCollect([])
        expect(await thirdCollect).toEqual({ collected: 0, skipped: false })
    })
})
