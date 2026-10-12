// ============================================================================
// 브리핑 생성 서비스 테스트
//
// [역할]
// - 메모리 DB에 실제 저장소와 실제 수집 · 보강 · 번역 서비스를 붙여 브리핑 생성 확인 (출처 수집과 LLM만 가짜)
// - 게시 규칙: 같은 날짜로 다시 게시하면 내용을 바꿔 끼움
// - 생성 전체: 선별 · 같은 소식 합치기 · 요약 · 번역 · 머리글 · 게시 · 실행 기록
// - 지난 7일 중복: 이미 보낸 소식은 빼고, 후속 소식은 표시해서 실음
// - 시작하지 않는 경우(API 키 없음 · 하루 상한 · 이미 생성 중)와 실패한 실행의 기록
// ============================================================================
import { describe, expect, it } from 'vitest'
import { dateKey } from '@shared/schedule'
import type { RunProgress } from '@shared/types'
import { runs } from '@data/schema'
import type { RawItem } from '../collectors/types'
import { CollectService } from './collect-service'
import { EnrichmentService } from './enrichment-service'
import { PipelineService } from './pipeline-service'
import { createFakeLlm, createRawItem, createTestConfig, openTestRepositories, readItemIdsFromPrompt, type FakeLlmOptions } from './testing'
import { TranslationService } from './translation-service'

const digestStats = { sources: 1, collected: 1, candidates: 1, selected: 1, costUsd: 0, failedSources: [], saveMode: false }
const LONG_ABSTRACT = 'This paragraph describes the announcement in enough detail to be summarized. '.repeat(6) // 300자를 넘는 본문

// 논문 글 만들기 (논문은 원문을 추출하지 않고 수집한 초록이 본문이 됨)
const paper = (title: string, url: string, overrides: Partial<RawItem> = {}): RawItem =>
    createRawItem({ sourceId: 'feed', sourceName: 'Test Feed', kind: 'paper', title, url, snippet: LONG_ABSTRACT, ...overrides })

// 모든 호출에 무난한 답을 돌려주는 가짜 LLM 응답 (묶기 · 중복 확인은 테스트가 바꿔 끼움)
function respondWith(overrides: Partial<Record<string, (userMessage: string) => unknown>> = {}) {
    const defaultResponses: Record<string, (userMessage: string) => unknown> = {
        triage: (userMessage) => ({
            results: readItemIdsFromPrompt(userMessage).map((itemId) => ({
                id: itemId,
                category: 'research',
                relevance: 0.9,
                importance: 4
            }))
        }),
        clusters: () => ({ groups: [] }),
        recent_matches: () => ({ matches: [] }),
        article_summary: (userMessage) => {
            const originalTitle = /원제: (.*)/.exec(userMessage)?.[1] ?? ''
            return {
                title_ko: `요약 제목 ${originalTitle}`,
                summary_ko: `요약 본문 ${originalTitle}`,
                key_points: ['핵심'],
                why_it_matters: `중요한 이유 ${originalTitle}`,
                category: 'research',
                relevance: 0.9,
                importance: 4
            }
        },
        translation: (userMessage) => ({
            paragraphs: userMessage
                .split('\n')
                .filter((promptLine) => promptLine.startsWith('{'))
                .map((promptLine) => ({ n: (JSON.parse(promptLine) as { n: number }).n, ko: '번역한 문단' }))
        }),
        digest: () => ({ headline: '오늘의 한 줄', overview: '오늘의 흐름' })
    }
    const responses = { ...defaultResponses, ...overrides }
    return (schemaName: string, userMessage: string) => responses[schemaName]!(userMessage)
}

// 브리핑 생성 서비스와 그 서비스가 쓰는 실제 서비스 · 저장소 준비
function setUp(options: { feedItems?: RawItem[]; llm?: FakeLlmOptions } = {}) {
    const repositories = openTestRepositories()
    const config = createTestConfig()
    const logMessages: string[] = []
    const log = (_level: string, logMessage: string) => void logMessages.push(logMessage)
    const progressStages: RunProgress['stage'][] = []
    const fakeLlm = createFakeLlm({ respondJson: respondWith(), ...options.llm })
    const feed = { items: options.feedItems ?? [] } // 출처에서 받아 올 글 (테스트 도중에 바꿀 수 있음)

    const collectService = new CollectService({
        ...repositories,
        config,
        collectSource: async () => feed.items,
        isBriefingRunning: () => pipelineService.isRunning(),
        log
    })
    const enrichmentService = new EnrichmentService({
        ...repositories,
        llmSessions: fakeLlm.llmSessions,
        config,
        extractArticle: async () => null,
        log
    })
    const translationService = new TranslationService({
        ...repositories,
        llmSessions: fakeLlm.llmSessions,
        config,
        ensureContent: (itemRow) => enrichmentService.ensureContent(itemRow),
        log
    })
    const pipelineService: PipelineService = new PipelineService({
        ...repositories,
        llmSessions: fakeLlm.llmSessions,
        config,
        collectAndStore: (since, reason, onProgress) => collectService.collectAndStore(since, reason, onProgress),
        mergeItemsInto: (representativeItemId, memberItemIds) => collectService.mergeItemsInto(representativeItemId, memberItemIds),
        ensureContent: (itemRow) => enrichmentService.ensureContent(itemRow),
        translateWithSession: (llmSession, itemId, saveMode) => translationService.translateWithSession(llmSession, itemId, saveMode),
        onProgress: (runProgress) => progressStages.push(runProgress.stage),
        log
    })
    return { ...repositories, collectService, pipelineService, fakeLlm, feed, logMessages, progressStages }
}

describe('브리핑 게시', () => {
    it('같은 날짜로 다시 게시하면 브리핑을 바꿔 끼운다', () => {
        const { collectService, pipelineService, digestRepository } = setUp()
        const first = collectService.storeRawItem(createRawItem())
        const second = collectService.storeRawItem(createRawItem({ title: 'Another story here', url: 'https://example.com/other' }))
        const entryOf = (itemId: number) => [{ itemId, rank: 1, section: 'top' as const, whyItMatters: null }]

        const firstDigestId = pipelineService.publishDigest({
            date: '2026-10-07',
            headline: '1차',
            overview: '첫 흐름',
            stats: digestStats,
            entries: entryOf(first.itemId)
        })
        const secondDigestId = pipelineService.publishDigest({
            date: '2026-10-07',
            headline: '2차',
            overview: null,
            stats: { ...digestStats, selected: 7 },
            entries: entryOf(second.itemId)
        })

        // 같은 호의 내용만 바뀜 (호가 새로 생기지 않음)
        expect(secondDigestId).toBe(firstDigestId)
        expect(digestRepository.listDigestSummaries()).toHaveLength(1)
        const digest = digestRepository.findLatestDigest()!
        expect(digest).toMatchObject({ headline: '2차', overview: null, stats: { selected: 7 } })
        expect(digest.entries.map((entry) => entry.itemId)).toEqual([second.itemId])
    })

    it('다른 날짜로 게시하면 새 호가 생긴다', () => {
        const { collectService, pipelineService, digestRepository } = setUp()
        const { itemId } = collectService.storeRawItem(createRawItem())
        const entries = [{ itemId, rank: 1, section: 'top' as const, whyItMatters: '따로 적은 이유' }]

        pipelineService.publishDigest({ date: '2026-10-06', headline: '어제', overview: null, stats: digestStats, entries })
        pipelineService.publishDigest({ date: '2026-10-07', headline: '오늘', overview: null, stats: digestStats, entries })

        expect(digestRepository.listDigestSummaries().map((digestSummary) => digestSummary.date)).toEqual(['2026-10-07', '2026-10-06'])
        expect(digestRepository.findDigestByDate('2026-10-06')!.entries[0]!.whyItMatters).toBe('따로 적은 이유')
    })
})

describe('브리핑 생성', () => {
    it('수집한 글을 선별 · 요약 · 번역해 오늘 날짜로 게시하고 실행 기록을 성공으로 닫는다', async () => {
        const { pipelineService, itemRepository, digestRepository, searchRepository, database, fakeLlm, progressStages } = setUp({
            feedItems: [
                paper('Alpha agent benchmark results', 'https://feed.test/alpha'),
                paper('Beta model training recipe', 'https://feed.test/beta')
            ]
        })

        const runResult = await pipelineService.runPipeline('manual')

        // 결과와 게시된 브리핑
        const todayDateKey = dateKey(new Date())
        expect(runResult).toMatchObject({ date: todayDateKey, headline: '오늘의 한 줄', entryCount: 2, costUsd: 0 })
        const digest = digestRepository.findDigestByDate(todayDateKey)!
        expect(digest.id).toBe(runResult.digestId)
        expect(digest).toMatchObject({
            overview: '오늘의 흐름',
            stats: { sources: 1, collected: 2, candidates: 2, selected: 2, saveMode: false }
        })
        expect(digest.entries.map((entry) => entry.titleKo).sort()).toEqual([
            '요약 제목 Alpha agent benchmark results',
            '요약 제목 Beta model training recipe'
        ])
        expect(digest.entries[0]!.whyItMatters).toContain('중요한 이유')

        // 본문은 수집한 초록으로 보관되고 번역이 붙음
        const contentRow = itemRepository.findContentByItemId(digest.entries[0]!.itemId)!
        expect(contentRow.fullText).toBe(false)
        expect(contentRow.paragraphsKo).toEqual(['번역한 문단'])

        // 요약한 제목으로 검색됨
        expect(searchRepository.searchItems({ scope: 'published', query: '요약 제목' })).toHaveLength(2)

        // 실행 기록은 성공, LLM 호출은 그 실행 번호로
        const runRows = database.select().from(runs).all()
        expect(runRows).toMatchObject([{ reason: 'manual', status: 'ok', error: null }])
        expect(fakeLlm.calls.every((llmCall) => llmCall.runId === runRows[0]!.id)).toBe(true)
        expect(progressStages.at(-1)).toBe('done')
        expect(pipelineService.isRunning()).toBe(false)
    })

    it('같은 날 다시 만들면 이미 선별 · 요약한 기사는 다시 호출하지 않고 같은 호를 바꿔 끼운다', async () => {
        const { pipelineService, digestRepository, fakeLlm } = setUp({
            feedItems: [
                paper('Alpha agent benchmark results', 'https://feed.test/alpha'),
                paper('Beta model training recipe', 'https://feed.test/beta')
            ]
        })
        const firstRun = await pipelineService.runPipeline('manual')
        const firstCallCount = fakeLlm.calls.length

        const secondRun = await pipelineService.runPipeline('manual')

        expect(secondRun.digestId).toBe(firstRun.digestId)
        expect(digestRepository.listDigestSummaries()).toHaveLength(1)
        const secondRunRoles = fakeLlm.calls.slice(firstCallCount).map((llmCall) => llmCall.role)
        expect(secondRunRoles).not.toContain('triage')
        expect(secondRunRoles).not.toContain('summary')
        expect(secondRunRoles).not.toContain('translate')
    })

    it('같은 소식으로 묶인 글은 대표 하나만 싣고 나머지는 대표에 합친다', async () => {
        const { pipelineService, itemRepository, digestRepository } = setUp({
            feedItems: [
                paper('Alpha agent benchmark results', 'https://feed.test/alpha'),
                paper('Alpha benchmark covered elsewhere', 'https://other.test/alpha'),
                paper('Beta model training recipe', 'https://feed.test/beta')
            ],
            llm: {
                respondJson: respondWith({
                    // 1차 묶기에서 앞의 두 글을 같은 소식으로 묶음 (2차 묶기는 묶지 않음)
                    clusters: (userMessage) => {
                        const itemIds = readItemIdsFromPrompt(userMessage)
                        return itemIds.length === 3 ? { groups: [{ ids: [1, 2], primary: 1 }] } : { groups: [] }
                    }
                })
            }
        })

        const runResult = await pipelineService.runPipeline('manual')

        expect(runResult.entryCount).toBe(2)
        expect(
            digestRepository
                .findLatestDigest()!
                .entries.map((entry) => entry.itemId)
                .sort()
        ).toEqual([1, 3])
        expect(itemRepository.findItemById(2)!.mergedInto).toBe(1)
        expect(itemRepository.findItemById(1)!.otherSources.map((otherSource) => otherSource.url)).toEqual(['https://other.test/alpha'])
    })

    it('지난 7일 브리핑에 실린 소식은 빼고, 후속 소식은 표시해서 싣는다', async () => {
        const { pipelineService, collectService, itemRepository, digestRepository, feed } = setUp({
            llm: {
                respondJson: respondWith({
                    // 후보 2번은 이미 보낸 소식, 3번은 후속 소식 (지난 기사는 1번)
                    recent_matches: () => ({
                        matches: [
                            { id: 2, previous_id: 1, follow_up: false },
                            { id: 3, previous_id: 1, follow_up: true },
                            { id: 4, previous_id: 999, follow_up: false } // 보내지 않은 지난 기사 번호 → 무시
                        ]
                    })
                })
            }
        })

        // 어제 브리핑에 실린 기사 (1번)
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        const previous = collectService.storeRawItem(paper('Gamma launch announced', 'https://feed.test/gamma'))
        pipelineService.publishDigest({
            date: dateKey(yesterday),
            headline: '어제',
            overview: null,
            stats: digestStats,
            entries: [{ itemId: previous.itemId, rank: 1, section: 'top', whyItMatters: null }]
        })

        // 오늘 후보 (2 · 3 · 4번)
        feed.items = [
            paper('Gamma launch repeated by another outlet', 'https://other.test/gamma'),
            paper('Gamma gets a major update today', 'https://feed.test/gamma-update'),
            paper('Delta research preview opens', 'https://feed.test/delta')
        ]
        const runResult = await pipelineService.runPipeline('manual')

        expect(runResult.entryCount).toBe(2)
        const todayEntries = digestRepository.findDigestByDate(runResult.date)!.entries
        expect(todayEntries.map((entry) => entry.itemId).sort()).toEqual([3, 4])
        expect(itemRepository.findItemById(2)!.mergedInto).toBe(1)
        expect(todayEntries.find((entry) => entry.itemId === 3)!.followUpOf).toMatchObject({ itemId: 1, digestDate: dateKey(yesterday) })
        expect(todayEntries.find((entry) => entry.itemId === 4)!.followUpOf).toBeNull()
    })

    it('본문이 300자에 못 미치는 기사는 싣지 않는다', async () => {
        const { pipelineService, digestRepository } = setUp({
            feedItems: [
                paper('Alpha agent benchmark results', 'https://feed.test/alpha'),
                paper('Title only item without body', 'https://feed.test/short', { snippet: '한 줄 소개' })
            ]
        })

        const runResult = await pipelineService.runPipeline('manual')

        expect(runResult.entryCount).toBe(1)
        expect(digestRepository.findLatestDigest()!.entries.map((entry) => entry.originalTitle)).toEqual(['Alpha agent benchmark results'])
    })

    it('요약 · 번역 · 머리글이 실패해도 게시하고, 머리글은 1위 기사 제목으로 대신한다', async () => {
        const failing = () => {
            throw new Error('LLM 오류')
        }
        const { pipelineService, digestRepository } = setUp({
            feedItems: [paper('Alpha agent benchmark results', 'https://feed.test/alpha')],
            llm: { respondJson: respondWith({ article_summary: failing, translation: failing, digest: failing }) }
        })

        const runResult = await pipelineService.runPipeline('manual')

        expect(runResult).toMatchObject({ headline: 'Alpha agent benchmark results', entryCount: 1 })
        expect(digestRepository.findLatestDigest()).toMatchObject({ headline: 'Alpha agent benchmark results', overview: null })
    })
})

describe('브리핑을 만들지 않는 경우', () => {
    it('API 키가 없으면 실행 기록을 만들지 않고 오류', async () => {
        const { pipelineService, database } = setUp({ llm: { hasApiKey: false } })

        await expect(pipelineService.runPipeline('manual')).rejects.toThrow('Groq API 키가 없습니다')
        expect(database.select().from(runs).all()).toEqual([])
    })

    it('오늘 사용액이 하루 상한에 닿았으면 실행 기록을 만들지 않고 오류', async () => {
        const { pipelineService, llmUsageRepository, database } = setUp()
        llmUsageRepository.insertUsage({
            runId: null,
            role: 'chat',
            model: 'chat-model',
            usage: { input: 1, cachedInput: 0, output: 1, reasoning: 0 },
            latencyMs: 1,
            costUsd: 0.5
        })

        await expect(pipelineService.runPipeline('manual')).rejects.toThrow('하루 상한')
        expect(database.select().from(runs).all()).toEqual([])
    })

    it('이미 만드는 중이면 오류, 끝난 뒤에는 다시 받는다', async () => {
        const { pipelineService } = setUp({ feedItems: [paper('Alpha agent benchmark results', 'https://feed.test/alpha')] })

        const firstRun = pipelineService.runPipeline('manual')
        expect(pipelineService.isRunning()).toBe(true)
        await expect(pipelineService.runPipeline('manual')).rejects.toThrow('이미 브리핑을 만드는 중입니다.')

        await firstRun
        await expect(pipelineService.runPipeline('manual')).resolves.toMatchObject({ entryCount: 1 })
    })

    it('실을 기사가 없으면 실행 기록에 오류를 남기고 화면에 실패를 알린다', async () => {
        const { pipelineService, database, progressStages } = setUp()

        await expect(pipelineService.runPipeline('manual')).rejects.toThrow('선정할 기사가 없습니다')

        expect(database.select().from(runs).all()).toMatchObject([
            { status: 'error', error: expect.stringContaining('선정할 기사가 없습니다') }
        ])
        expect(progressStages.at(-1)).toBe('error')
        expect(pipelineService.isRunning()).toBe(false)
    })

    it('선별이 모두 실패하면 중단한다', async () => {
        const { pipelineService } = setUp({
            feedItems: [paper('Alpha agent benchmark results', 'https://feed.test/alpha')],
            llm: {
                respondJson: respondWith({
                    triage: () => {
                        throw new Error('LLM 오류')
                    }
                })
            }
        })

        await expect(pipelineService.runPipeline('manual')).rejects.toThrow('LLM 선별이 모두 실패했습니다')
    })
})

describe('끝나지 못한 실행 기록 정리', () => {
    it('"실행 중"으로 남은 실행만 실패로 바꾼다', () => {
        const { pipelineService, runRepository, database } = setUp()
        const finishedRunId = runRepository.insertRun('manual', new Date(0).toISOString())
        runRepository.updateRunFinished(finishedRunId, 'ok', null)
        runRepository.insertRun('timer', new Date(0).toISOString())

        expect(pipelineService.failStaleRuns()).toBe(1)

        expect(database.select().from(runs).all()).toMatchObject([
            { id: finishedRunId, status: 'ok', error: null },
            { status: 'error', error: '앱 종료로 중단됨' }
        ])
    })
})

describe('지난 7일 중복 확인의 구간', () => {
    // daysAgo일 전 브리핑에 기사 하나를 실어 두고 오늘 브리핑을 만든 뒤, 중복 확인 호출에 보낸 메시지를 돌려줌 (호출이 없었으면 null)
    async function runWithDigestPublishedDaysAgo(daysAgo: number): Promise<string | null> {
        const { pipelineService, collectService, fakeLlm, feed } = setUp()
        const publishedDate = new Date()
        publishedDate.setDate(publishedDate.getDate() - daysAgo)
        const previous = collectService.storeRawItem(paper('Gamma launch announced', 'https://feed.test/gamma'))
        pipelineService.publishDigest({
            date: dateKey(publishedDate),
            headline: '지난 호',
            overview: null,
            stats: digestStats,
            entries: [{ itemId: previous.itemId, rank: 1, section: 'top', whyItMatters: null }]
        })

        feed.items = [paper('Delta research preview opens', 'https://feed.test/delta')]
        await pipelineService.runPipeline('manual')
        return fakeLlm.calls.find((llmCall) => llmCall.role === 'recent')?.user ?? null
    }

    it('7일 전 브리핑까지는 중복 확인에 넣는다', async () => {
        expect(await runWithDigestPublishedDaysAgo(7)).toContain('Gamma launch announced')
    })

    it('8일 전 브리핑은 보지 않는다 (지난 브리핑이 없으면 확인을 건너뜀)', async () => {
        expect(await runWithDigestPublishedDaysAgo(8)).toBeNull()
    })
})
