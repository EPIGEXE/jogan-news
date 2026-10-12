// ============================================================================
// 브리핑 생성 서비스
//
// [역할]
// - 수집부터 게시까지 브리핑 한 번을 만드는 전체 순서 진행 (DESIGN.md 9절)
// - 한 번에 하나만 생성 (이미 만드는 중이면 오류)
// - 예산: 오늘 사용액이 하루 상한 이상이면 만들지 않음, 이번 달 사용액이 월 예산 이상이면 절약 모드 (작은 모델 · 최대 15건 · 번역 생략)
// - 수집 구간: 오늘 이전에 성공한 마지막 실행부터 지금까지 (첫 실행 24시간, 최대 72시간)
// - 비용 절감: 규칙 점수 상위 120건만 LLM 선별, 이미 선별 · 요약한 기사는 다시 하지 않음
// - 중복 제거: 같은 소식은 대표 하나로 합치고, 지난 7일 브리핑에 실린 소식은 뺌 (중요한 새 전개는 "후속"으로 실음)
// - 본문이 300자 미만인 기사는 싣지 않고 다음 순위 후보로 채움 (제목만으로 요약하면 내용을 지어내게 됨)
// - 일부 실패는 건너뛰고 계속: 출처 수집 · 선별 배치 일부 · 같은 소식 묶기 · 7일 중복 확인 · 요약 · 번역 · 머리글
// - 중단하는 경우: API 키 없음, 하루 상한 도달, 선별 전부 실패, 실을 기사 없음 (실행 기록에 오류를 남기고 예외를 던짐)
// - 게시: 하루 한 호, 같은 날짜의 브리핑이 이미 있으면 내용을 바꿔 끼움
// - 실행 기록: 시작 · 성공 · 실패를 남기고, 앱이 중간에 꺼져 "실행 중"으로 남은 기록은 Worker가 시작할 때 실패로 정리
// - 요약을 저장하면 검색 색인 갱신
// ============================================================================
import { modelSpecForRole, type AppConfig } from '@config/index'
import { readAppSettings } from '@domain/app-settings'
import { summarizeUsage } from '@domain/usage'
import { runInTransaction, type AppDatabase } from '@data/client'
import type { DigestContent, DigestEntryInput, DigestRepository } from '@data/repositories/digest-repository'
import type { ContentRow, ItemRepository, ItemRow, SummaryValues } from '@data/repositories/item-repository'
import type { LlmUsageRepository } from '@data/repositories/llm-usage-repository'
import type { RunRepository } from '@data/repositories/run-repository'
import type { SearchRepository } from '@data/repositories/search-repository'
import type { SettingsRepository } from '@data/repositories/settings-repository'
import { dateKey, type TriggerReason } from '@shared/schedule'
import { SECTION_LABEL, type DigestStats, type RunProgress } from '@shared/types'
import type { RunResult } from '@shared/worker-protocol'
import type { LlmCaller, LlmSessionSource } from '../llm/service'
import type { WorkerLog } from '../log'
import {
    ClusterJsonSchema,
    ClusterZod,
    DigestJsonSchema,
    DigestZod,
    RecentJsonSchema,
    RecentZod,
    SummaryJsonSchema,
    SummaryZod,
    summaryUserMessage,
    TriageJsonSchema,
    TriageZod
} from '../pipeline/schemas'
import { applyClusters, fillWithContent, finalScore, ruleScore, selectEntries, type TriagedItem } from '../pipeline/select'
import type { CollectReason, MergedRepresentative } from './collect-service'

const TRIAGE_CANDIDATE_LIMIT = 120 // LLM 선별에 보내는 후보 수 상한 (규칙 점수 상위, 건)
const TRIAGE_BATCH_SIZE = 10 // 선별 호출 한 번에 묶어 보내는 기사 수 (건)
const FIRST_RUN_WINDOW_HOURS = 24 // 성공한 실행이 아직 없을 때의 수집 구간 (시간)
const MAX_WINDOW_HOURS = 72 // 수집 구간의 최대 길이 (시간, 오래 비웠어도 이보다 전 글은 모으지 않음)
const SAVE_MODE_DIGEST_SIZE = 15 // 절약 모드에서 브리핑에 싣는 최대 기사 수 (건)
const RECENT_DIGEST_DAYS = 7 // 이 기간(일) 안에 실린 소식은 다시 싣지 않음 (큰 후속 소식은 '후속'으로 실음)
const MIN_BODY_CHARS = 300 // 이보다 본문이 짧으면(제목 · 한 줄 소개뿐) 브리핑에 싣지 않음 (글자 수)
const EXTRACT_ATTEMPT_FACTOR = 2 // 본문 추출을 시도하는 후보 수 상한 = 브리핑 크기 × 이 값
const STALE_RUN_ERROR = '앱 종료로 중단됨' // 끝나지 못하고 "실행 중"으로 남은 실행 기록에 남기는 실패 이유

const HOUR_MS = 3600 * 1000 // 1시간 (밀리초)

// 본문 문단들의 글자 수 합
const countBodyChars = (paragraphs: string[]) => paragraphs.reduce((charCount, paragraph) => charCount + paragraph.length, 0)

// 그날 0시 (이 컴퓨터의 시간대 기준)
function startOfLocalDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

// 그 날짜에서 며칠 전의 날짜 ('YYYY-MM-DD', 로컬 날짜)
function dateKeyDaysBefore(dateKeyText: string, days: number): string {
    const earlierDate = new Date(`${dateKeyText}T00:00:00`)
    earlierDate.setDate(earlierDate.getDate() - days)
    return dateKey(earlierDate)
}

// 게시할 브리핑 한 호
export interface DigestToPublish extends DigestContent {
    date: string // 브리핑 날짜 'YYYY-MM-DD'
    entries: DigestEntryInput[] // 실을 기사
}

export interface PipelineDeps {
    database: AppDatabase // 여러 쓰기를 한 묶음으로 묶을 때만 사용
    itemRepository: ItemRepository // 후보 조회, 선별 · 요약 결과 저장
    digestRepository: DigestRepository // 지난 브리핑 조회, 브리핑 게시
    runRepository: RunRepository // 실행 기록
    llmUsageRepository: LlmUsageRepository // 사용액 확인, 이번 실행의 비용 합계
    settingsRepository: SettingsRepository // 월 예산 · 하루 상한 · 브리핑 크기 읽기
    searchRepository: SearchRepository // 요약을 저장한 기사의 검색 색인 갱신
    llmSessions: LlmSessionSource // 이번 실행에 쓸 LLM 세션 (API 키가 없으면 생성하지 않음)
    config: AppConfig // 출처 · 관심 키워드 · 모델 · 프롬프트 설정
    // ① 수집 · ② 저장 · 중복 합치기 → 새로 쌓인 글 수와 실패한 출처 목록
    collectAndStore(
        since: Date,
        reason: CollectReason,
        onProgress: (runProgress: RunProgress) => void
    ): Promise<{ collected: number; failedSources: string[] }>
    // 같은 소식으로 묶인 글들을 대표 글 하나로 합침
    mergeItemsInto(representativeItemId: number, memberItemIds: number[]): MergedRepresentative
    // 기사 본문 확보 (없으면 추출해서 보관)
    ensureContent(itemRow: ItemRow): Promise<ContentRow>
    // 이번 실행의 세션으로 기사 본문 번역 (한국어 기사 · 이미 번역한 기사는 아무것도 하지 않음, 실패하면 reject)
    translateWithSession(llmSession: LlmCaller, itemId: number, saveMode: boolean): Promise<boolean>
    onProgress(runProgress: RunProgress): void // 단계별 진행 상황 알림
    log: WorkerLog // 로그 남기기
}

/**
 * 브리핑을 만드는 서비스
 *
 * - 한 번에 하나만 생성
 * - 실행 기록과 게시(같은 날짜면 내용 교체) 규칙을 가짐
 */
export class PipelineService {
    private runningPipeline: Promise<RunResult> | null = null // 진행 중인 브리핑 생성 (없으면 null)

    constructor(private readonly deps: PipelineDeps) {}

    // 지금 브리핑을 만드는 중인지
    isRunning(): boolean {
        return this.runningPipeline !== null
    }

    /**
     * 끝나지 못한 실행 기록 정리 (Worker가 시작할 때 한 번)
     *
     * - 앱이 중간에 꺼져 "실행 중"으로 남은 실행을 실패로 바꿈
     *
     * @returns {number} 정리한 실행 수
     */
    failStaleRuns(): number {
        return this.deps.runRepository.updateRunningRunsFailed(STALE_RUN_ERROR)
    }

    /**
     * 브리핑 생성 (한 번에 하나만)
     *
     * @param {TriggerReason} reason - 생성을 시작한 계기 (실행 기록에 남김)
     * @returns {Promise<RunResult>} 게시한 브리핑의 번호 · 날짜 · 오늘의 한 줄 · 기사 수 · 이번 실행 비용
     * @throws 이미 만드는 중이거나, API 키가 없거나, 하루 상한에 닿았거나, 생성 도중 중단되면 오류
     */
    async runPipeline(reason: TriggerReason): Promise<RunResult> {
        // 이미 만드는 중이면 거절
        if (this.runningPipeline) throw new Error('이미 브리핑을 만드는 중입니다.')

        // 생성 시작 (진행 중 표시로 잡아 둠)
        const pipelineJob = this.generateBriefing(reason)
        this.runningPipeline = pipelineJob

        try {
            return await pipelineJob
        } finally {
            // 성공 · 실패 모두 다음 생성을 받을 수 있게 되돌림
            this.runningPipeline = null
        }
    }

    /**
     * 브리핑 게시
     *
     * - 같은 날짜의 브리핑이 이미 있으면 내용을 바꿔 끼움 (수동 새로고침)
     * - 없으면 새 호 생성
     *
     * @param {DigestToPublish} digestToPublish - 날짜 · 오늘의 한 줄 · 흐름 · 통계 · 실을 기사
     * @returns {number} 브리핑 번호
     */
    publishDigest(digestToPublish: DigestToPublish): number {
        const { database, digestRepository } = this.deps
        const digestContent: DigestContent = {
            headline: digestToPublish.headline,
            overview: digestToPublish.overview,
            stats: digestToPublish.stats
        }

        return runInTransaction(database, () => {
            // 같은 날짜의 브리핑이 있는지 확인
            let digestId = digestRepository.findDigestIdByDate(digestToPublish.date)

            if (digestId !== null) {
                // 이미 있음 → 실린 기사를 모두 지우고 오늘의 한 줄 · 흐름 · 통계 · 만든 시각을 새로 씀
                digestRepository.deleteEntriesByDigestId(digestId)
                digestRepository.updateDigestContent(digestId, digestContent)
            } else {
                // 없음 → 새 호 생성
                digestId = digestRepository.insertDigest(digestToPublish.date, digestContent)
            }

            // 실을 기사를 순위 · 섹션과 함께 저장
            digestRepository.insertEntries(digestId, digestToPublish.entries)
            return digestId
        })
    }

    // 수집 구간의 시작 시각 결정
    // - 오늘 이전에 성공한 마지막 실행의 시작 시각부터 (최대 72시간 전까지, 첫 실행이면 24시간 전)
    // - 같은 날 다시 만들 때도 오늘 아침 실행이 아니라 어제 실행을 기준으로 해서 후보가 줄지 않게 함
    private collectionSince(now: Date): Date {
        const earliestAllowedStart = new Date(now.getTime() - MAX_WINDOW_HOURS * HOUR_MS) // 구간이 이보다 앞에서 시작할 수 없음

        // 오늘 0시 이전에 시작해 성공한 마지막 실행
        const lastRunStartedAt = this.deps.runRepository.findLastSuccessfulRunStartedAt(startOfLocalDay(now).toISOString())

        // 성공한 실행이 없음(첫 실행) → 최근 24시간
        if (!lastRunStartedAt) return new Date(now.getTime() - FIRST_RUN_WINDOW_HOURS * HOUR_MS)

        // 마지막 실행이 72시간보다 오래됨 → 72시간 전부터, 아니면 마지막 실행 시각부터
        const lastRunStart = new Date(lastRunStartedAt)
        return lastRunStart < earliestAllowedStart ? earliestAllowedStart : lastRunStart
    }

    // 한국어 요약 저장 + 검색 색인 갱신 (제목 · 요약이 검색됨)
    private storeSummary(itemId: number, summaryValues: SummaryValues, summaryModel: string): void {
        const { database, itemRepository, searchRepository } = this.deps
        runInTransaction(database, () => {
            itemRepository.updateItemSummary(itemId, summaryValues, summaryModel)
            searchRepository.reindexItem(itemId)
        })
    }

    /**
     * 브리핑 한 번 생성 (수집 → 선별 → 중복 제거 → 선정 → 요약 → 번역 → 머리글 → 게시)
     * - API 키가 없거나 오늘 사용액이 하루 상한 이상이면 실행 기록을 만들기 전에 예외
     * - 그 뒤 단계에서 난 예외는 실행 기록에 오류로 남기고 화면에 실패를 알린 뒤 다시 던짐
     */
    private async generateBriefing(reason: TriggerReason): Promise<RunResult> {
        const { itemRepository, digestRepository, runRepository, llmUsageRepository, settingsRepository, config, onProgress, log } =
            this.deps
        const now = new Date()
        const todayDateKey = dateKey(now) // 오늘 날짜 (브리핑 날짜로 사용)

        // API 키가 없으면 LLM을 부를 수 없으므로 시작하지 않음
        if (!this.deps.llmSessions.hasApiKey()) throw new Error('Groq API 키가 없습니다. 설정에서 키를 입력하세요.')

        // =============================== 예산 확인 ===================================
        // 이번 달 1일부터 · 오늘 0시부터 쓴 LLM 비용 합산 (DESIGN.md 7.5절 ⑤)
        const appSettings = readAppSettings(settingsRepository)
        const usageSummary = summarizeUsage(llmUsageRepository, settingsRepository, now)

        // 오늘 사용액이 하루 상한 이상 → 생성 중단
        if (usageSummary.todayUsd >= usageSummary.dailyCapUsd) {
            throw new Error(
                `오늘 LLM 사용액($${usageSummary.todayUsd.toFixed(2)})이 하루 상한($${usageSummary.dailyCapUsd})에 도달해 생성을 중단했습니다.`
            )
        }

        // 이번 달 사용액이 월 예산 이상 → 절약 모드 (모든 역할을 절약 모드 모델로, 브리핑 최대 15건, 본문 번역 생략)
        const saveMode = usageSummary.saveMode
        if (saveMode) log('warn', `월 예산 $${usageSummary.budgetUsd} 도달 → 절약 모드로 실행`)

        // 수집 구간을 정하고 실행 기록 시작 (이 실행의 LLM 사용량은 실행 번호와 함께 기록됨)
        const since = this.collectionSince(now)
        const runId = runRepository.insertRun(reason, since.toISOString())
        const llmSession = this.deps.llmSessions.openSession(runId)! // 바로 위에서 API 키가 있음을 확인함

        try {
            // =============================== ① 수집 · ② 저장 · 중복 합치기 ===================================
            const { collected: collectedCount, failedSources } = await this.deps.collectAndStore(since, 'briefing', onProgress)

            // =============================== ③ 규칙 점수로 1차 거르기 ===================================
            // 후보: 수집 구간 안에 들어왔고, 다른 기사에 합쳐지지 않았고, 오늘이 아닌 날의 브리핑에 실린 적 없는 기사
            const weightBySourceId = new Map(config.sources.map((source) => [source.id, source.weight])) // 출처별 신뢰도 가중치
            const candidateRows = itemRepository.listBriefingCandidates(since.toISOString(), todayDateKey)

            // LLM 비용을 줄이려고 규칙 점수를 먼저 매겨 상위 120건만 선별 단계로 넘김
            const scoredCandidates = candidateRows
                .map((candidateRow) => {
                    const otherSourceCount = candidateRow.otherSources.length // 같은 소식을 다룬 다른 출처 수
                    const referenceTimeMs = Date.parse(candidateRow.publishedAt ?? candidateRow.collectedAt) // 최신성 기준 시각 (게시 시각, 없으면 수집 시각)
                    return {
                        itemRow: candidateRow,
                        otherSourceCount,
                        ruleScore: ruleScore(
                            {
                                id: candidateRow.id,
                                title: candidateRow.title,
                                snippet: candidateRow.snippet,
                                sourceWeight: weightBySourceId.get(candidateRow.sourceId) ?? 1, // 꺼 두었거나 목록에서 뺀 출처의 글은 가중치 1
                                engagement: candidateRow.engagement,
                                otherSourceCount,
                                ageHours: Number.isNaN(referenceTimeMs) ? 0 : (now.getTime() - referenceTimeMs) / HOUR_MS // 시각을 읽지 못하면 방금 나온 글로 취급
                            },
                            config.interests
                        )
                    }
                })
                .sort((leftCandidate, rightCandidate) => rightCandidate.ruleScore - leftCandidate.ruleScore)
                .slice(0, TRIAGE_CANDIDATE_LIMIT)
            log('info', `후보 ${candidateRows.length}건 중 ${scoredCandidates.length}건을 선별 단계로`)

            // =============================== ④ LLM 선별 ===================================
            // 아직 선별하지 않은 기사만 10건씩 묶어 보냄 (한 번 매긴 결과는 DB에 남아 다시 호출하지 않음)
            const untriagedCandidates = scoredCandidates.filter((scoredCandidate) => scoredCandidate.itemRow.triageCategory === null)
            const triageModelSpec = modelSpecForRole(config.models, 'triage', saveMode)
            const triageBatches: (typeof untriagedCandidates)[] = []
            for (let batchStartIndex = 0; batchStartIndex < untriagedCandidates.length; batchStartIndex += TRIAGE_BATCH_SIZE)
                triageBatches.push(untriagedCandidates.slice(batchStartIndex, batchStartIndex + TRIAGE_BATCH_SIZE))
            let finishedTriageBatchCount = 0 // 끝난 배치 수 (진행 표시용, 실패 포함)
            let failedTriageBatchCount = 0 // 실패한 배치 수 (전부 실패했는지 판단용)

            // 배치를 동시에 선별 (분류 · 관련도 0~1 · 중요도 1~5)
            onProgress({ stage: 'triage', message: '관련도와 중요도를 매기는 중', current: 0, total: triageBatches.length })
            await Promise.all(
                triageBatches.map(async (triageBatch) => {
                    // 입력을 작게 유지하려고 출처 · 제목 · 첫 200자만 한 줄씩 보냄
                    const triageUserMessage = triageBatch
                        .map((scoredCandidate) =>
                            JSON.stringify({
                                id: scoredCandidate.itemRow.id,
                                source: scoredCandidate.itemRow.sourceName,
                                title: scoredCandidate.itemRow.title,
                                snippet: scoredCandidate.itemRow.snippet.slice(0, 200)
                            })
                        )
                        .join('\n')
                    try {
                        const triageResponse = await llmSession.completeJson(
                            'triage',
                            triageModelSpec,
                            { system: config.prompts.triage, user: triageUserMessage },
                            {
                                name: 'triage',
                                jsonSchema: TriageJsonSchema,
                                zod: TriageZod
                            }
                        )

                        // 결과를 DB와 메모리의 후보 행에 반영
                        // 응답에 빠진 기사는 선별되지 않은 채 남아 이번 선정에서 빠짐
                        const batchItemIds = new Set(triageBatch.map((scoredCandidate) => scoredCandidate.itemRow.id)) // 이 배치로 보낸 기사 번호
                        for (const triageResult of triageResponse.results) {
                            // 보내지 않은 번호를 답한 결과는 무시
                            if (!batchItemIds.has(triageResult.id)) continue
                            itemRepository.updateItemTriage(triageResult.id, {
                                category: triageResult.category,
                                relevance: triageResult.relevance,
                                importance: triageResult.importance
                            })
                            const triagedCandidate = triageBatch.find((batchCandidate) => batchCandidate.itemRow.id === triageResult.id)!
                            triagedCandidate.itemRow.triageCategory = triageResult.category
                            triagedCandidate.itemRow.triageRelevance = triageResult.relevance
                            triagedCandidate.itemRow.triageImportance = triageResult.importance
                        }
                    } catch (triageError) {
                        // 이 배치만 실패 → 나머지 배치로 진행 (이 배치의 기사는 이번 선정에서 빠짐)
                        failedTriageBatchCount++
                        log('warn', `선별 배치 실패: ${(triageError as Error).message}`)
                    } finally {
                        onProgress({
                            stage: 'triage',
                            message: '관련도와 중요도를 매기는 중',
                            current: ++finishedTriageBatchCount,
                            total: triageBatches.length
                        })
                    }
                })
            )

            // 모든 배치가 실패(키 · 네트워크 문제) → 생성 중단
            if (triageBatches.length > 0 && failedTriageBatchCount === triageBatches.length) {
                throw new Error('LLM 선별이 모두 실패했습니다. API 키와 네트워크를 확인하세요.')
            }

            // 선별된 기사만 선정 후보로 (이전 실행에서 선별해 둔 기사 포함)
            const triagedItems: TriagedItem[] = scoredCandidates
                .filter((scoredCandidate) => scoredCandidate.itemRow.triageCategory !== null)
                .map((scoredCandidate) => ({
                    id: scoredCandidate.itemRow.id,
                    category: scoredCandidate.itemRow.triageCategory!,
                    relevance: scoredCandidate.itemRow.triageRelevance ?? 0,
                    importance: scoredCandidate.itemRow.triageImportance ?? 1,
                    ruleScore: scoredCandidate.ruleScore,
                    engagement: scoredCandidate.itemRow.engagement,
                    otherSourceCount: scoredCandidate.otherSourceCount
                }))

            // 브리핑에 실을 기사 수 (설정값, 절약 모드에서는 최대 15건)
            const digestSize = saveMode ? Math.min(appSettings.digestSize, SAVE_MODE_DIGEST_SIZE) : appSettings.digestSize

            const itemRowById = new Map(scoredCandidates.map((scoredCandidate) => [scoredCandidate.itemRow.id, scoredCandidate.itemRow])) // 기사 번호로 찾는 후보 행 (선별 · 요약 결과가 여기에 채워짐)

            // 같은 소식을 LLM에게 묶게 하고 대표 하나로 합침 (실패하면 묶지 않고 진행)
            // 판단이 까다로워 요약용 큰 모델을 사용 (호출 한 번이라 비용은 미미함)
            const clusterAndMerge = async (
                itemsToCluster: TriagedItem[],
                describeItem: (itemId: number) => object
            ): Promise<TriagedItem[]> => {
                // 하나뿐이면 묶을 것 없음
                if (itemsToCluster.length < 2) return itemsToCluster
                try {
                    // 기사마다 번호와 설명(describeItem이 고른 제목 · 첫 부분 등)을 한 줄씩 보냄
                    const clusterUserMessage = itemsToCluster
                        .map((triagedItem) => JSON.stringify({ id: triagedItem.id, ...describeItem(triagedItem.id) }))
                        .join('\n')
                    const { groups } = await llmSession.completeJson(
                        'cluster',
                        modelSpecForRole(config.models, 'summary', saveMode),
                        { system: config.prompts.cluster, user: clusterUserMessage },
                        {
                            name: 'clusters',
                            jsonSchema: ClusterJsonSchema,
                            zod: ClusterZod
                        }
                    )

                    // 묶음마다 대표만 남기고, DB에서도 나머지를 대표에 합침 (나머지의 출처는 대표의 다른 출처로 옮겨짐)
                    const clusterResult = applyClusters(itemsToCluster, groups)
                    for (const [representativeId, mergedMemberIds] of clusterResult.merges)
                        this.deps.mergeItemsInto(representativeId, mergedMemberIds)
                    if (clusterResult.merges.size) log('info', `같은 소식 ${clusterResult.merges.size}묶음을 합침`)
                    return clusterResult.items
                } catch (clusterError) {
                    // 묶기 실패 → 받은 목록 그대로 진행
                    log('warn', `같은 소식 묶기 실패, 묶지 않고 진행: ${(clusterError as Error).message}`)
                    return itemsToCluster
                }
            }

            // =============================== ⑤ 같은 소식 묶기 1차 ===================================
            // 실릴 가능성이 있는 상위 후보끼리만 묶음: 관련도 0.4 이상이거나 중요도 5, 최종 점수 순으로 브리핑 크기의 2배까지
            onProgress({ stage: 'triage', message: '같은 소식을 묶는 중' })
            const clusterPool = triagedItems
                .filter((triagedItem) => triagedItem.relevance >= 0.4 || triagedItem.importance >= 5)
                .sort((leftItem, rightItem) => finalScore(rightItem) - finalScore(leftItem))
                .slice(0, digestSize * 2)
            const clusterPoolIds = new Set(clusterPool.map((triagedItem) => triagedItem.id)) // 1차 묶기에 들어간 기사 번호 (합쳐져 빠진 것 포함)

            // 아직 요약 전이라 출처 · 원제 · 첫 160자로 비교
            const mergedPool = await clusterAndMerge(clusterPool, (itemId) => {
                const itemRow = itemRowById.get(itemId)!
                return { source: itemRow.sourceName, title: itemRow.title, snippet: itemRow.snippet.slice(0, 160) }
            })

            // =============================== ⑥ 지난 7일 중복 확인 ===================================
            // 지난 7일 브리핑에 실린 기사 (7일 전 날짜부터 어제까지, 오늘 브리핑 제외)
            const recentEntries = digestRepository.listPublishedItemsBetween(
                dateKeyDaysBefore(todayDateKey, RECENT_DIGEST_DAYS),
                todayDateKey
            )
            const alreadySentIds = new Set<number>() // 이미 보낸 소식이라 후보에서 뺄 기사 번호

            // 지난 브리핑이 없거나 후보가 없으면 확인할 것 없음
            if (recentEntries.length > 0 && mergedPool.length > 0) {
                try {
                    // 지난 브리핑 목록과 1차로 묶은 상위 후보를 함께 보내 같은 발표 · 사건끼리 짝짓게 함
                    const recentUserMessage = [
                        '지난 브리핑:',
                        ...recentEntries.map((recentEntry) =>
                            JSON.stringify({ id: recentEntry.itemId, date: recentEntry.digestDate, title: recentEntry.title })
                        ),
                        '',
                        '오늘 후보:',
                        ...mergedPool.map((triagedItem) => {
                            const itemRow = itemRowById.get(triagedItem.id)!
                            return JSON.stringify({
                                id: itemRow.id,
                                source: itemRow.sourceName,
                                title: itemRow.title,
                                snippet: itemRow.snippet.slice(0, 160)
                            })
                        })
                    ].join('\n')
                    const { matches } = await llmSession.completeJson(
                        'recent',
                        modelSpecForRole(config.models, 'summary', saveMode),
                        { system: config.prompts.recent, user: recentUserMessage },
                        {
                            name: 'recent_matches',
                            jsonSchema: RecentJsonSchema,
                            zod: RecentZod
                        }
                    )

                    // 짝지어진 후보 처리
                    const recentEntryIds = new Set(recentEntries.map((recentEntry) => recentEntry.itemId)) // 지난 브리핑에 실린 기사 번호
                    let followUpCount = 0 // 후속 소식으로 표시한 수 (로그용)
                    for (const recentMatch of matches) {
                        // 보내지 않은 번호를 답했거나 이미 뺀 후보면 무시
                        if (
                            !clusterPoolIds.has(recentMatch.id) ||
                            !recentEntryIds.has(recentMatch.previous_id) ||
                            alreadySentIds.has(recentMatch.id)
                        )
                            continue
                        if (recentMatch.follow_up) {
                            // 같은 소식이지만 중요한 새 전개 → 후속 소식으로 표시하고 실음
                            itemRepository.updateItemFollowUpOf(recentMatch.id, recentMatch.previous_id)
                            followUpCount++
                        } else {
                            // 이미 보낸 소식 → 지난 기사에 출처로 붙이고 후보에서 뺌
                            this.deps.mergeItemsInto(recentMatch.previous_id, [recentMatch.id])
                            alreadySentIds.add(recentMatch.id)
                        }
                    }
                    if (matches.length)
                        log('info', `지난 ${RECENT_DIGEST_DAYS}일 중복 ${alreadySentIds.size}건 제외, 후속 소식 ${followUpCount}건`)
                } catch (recentCheckError) {
                    // 확인 실패 → 중복 확인 없이 진행
                    log('warn', `지난 브리핑 중복 확인 실패, 확인 없이 진행: ${(recentCheckError as Error).message}`)
                }
            }

            // =============================== ⑦ 선정과 본문 확인 ===================================
            // 선정 후보: 묶고 남은 상위 후보(이미 보낸 소식 제외) + 1차 묶기에 들지 않은 나머지
            const dedupedItems = [
                ...mergedPool.filter((triagedItem) => !alreadySentIds.has(triagedItem.id)),
                ...triagedItems.filter((triagedItem) => !clusterPoolIds.has(triagedItem.id))
            ]

            // 실을 만한 기사가 하나도 없음(관련도가 모두 낮음 등) → 생성 중단
            let selectedEntries = selectEntries(dedupedItems, digestSize)
            if (selectedEntries.length === 0) throw new Error('선정할 기사가 없습니다. 수집된 글이 없거나 모두 관련도가 낮습니다.')

            // 순위대로 고르며 본문 확보: 본문을 못 가져온(제목뿐인) 기사는 빼고 다음 순위 후보로 채움
            // 제목만으로 요약하면 내용을 지어내게 되므로 싣지 않음. 추출 시도는 브리핑 크기의 2배까지만 함
            let itemsWithBodyCount = 0 // 본문이 충분하다고 확인된 기사 수 (진행 표시용)
            onProgress({ stage: 'extract', message: '본문을 가져오는 중', current: 0, total: digestSize })
            const fillResult = await fillWithContent(dedupedItems, digestSize, digestSize * EXTRACT_ATTEMPT_FACTOR, async (itemId) => {
                // 본문이 없으면 원문에서 추출 (추출할 수 없거나 실패하면 수집한 첫 부분이 본문이 됨)
                const contentRow = await this.deps.ensureContent(itemRowById.get(itemId)!)
                const hasEnoughBody = countBodyChars(contentRow.paragraphs) >= MIN_BODY_CHARS // 본문이 300자 이상인지

                // 다음 후보로 채우다 보면 확인된 수가 브리핑 크기를 넘을 수 있어 표시는 크기까지만
                if (hasEnoughBody)
                    onProgress({
                        stage: 'extract',
                        message: '본문을 가져오는 중',
                        current: Math.min(++itemsWithBodyCount, digestSize),
                        total: digestSize
                    })
                return hasEnoughBody
            })
            selectedEntries = fillResult.selected
            if (fillResult.excluded.length) log('info', `본문을 가져오지 못한 ${fillResult.excluded.length}건을 빼고 다음 후보로 채움`)

            // 본문이 있는 기사가 하나도 없음 → 생성 중단
            if (selectedEntries.length === 0) throw new Error('본문을 가져올 수 있는 기사가 없습니다.')

            // =============================== ⑧ 한국어 요약 ===================================
            // 선정된 기사를 한 건씩 동시에 요약 (한국어 제목 · 요약 · 핵심 포인트 · 왜 중요한가)
            const summaryModelSpec = modelSpecForRole(config.models, 'summary', saveMode)
            let summarizedCount = 0 // 처리가 끝난 기사 수 (진행 표시용, 건너뛴 것 · 실패 포함)
            onProgress({ stage: 'summarize', message: '한국어로 요약하는 중', current: 0, total: selectedEntries.length })
            await Promise.all(
                selectedEntries.map(async (selectedEntry) => {
                    const itemRow = itemRowById.get(selectedEntry.id)!

                    // 이미 요약한 기사는 건너뜀 (같은 기사로 비용이 두 번 들지 않게)
                    if (!itemRow.summaryKo) {
                        const contentRow = itemRepository.findContentByItemId(itemRow.id)! // 바로 앞 단계에서 확보한 본문
                        try {
                            const summary = await llmSession.completeJson(
                                'summary',
                                summaryModelSpec,
                                {
                                    system: config.prompts.summary,
                                    user: summaryUserMessage({
                                        sourceName: itemRow.sourceName,
                                        kind: itemRow.kind,
                                        title: itemRow.title,
                                        paragraphs: contentRow.paragraphs,
                                        fullText: contentRow.fullText
                                    })
                                },
                                { name: 'article_summary', jsonSchema: SummaryJsonSchema, zod: SummaryZod }
                            )

                            // 요약을 DB에 저장하고, 뒤 단계(2차 묶기 · 머리글 · 게시)가 쓰도록 메모리의 행에도 반영
                            this.storeSummary(
                                itemRow.id,
                                {
                                    titleKo: summary.title_ko,
                                    summaryKo: summary.summary_ko,
                                    keyPoints: summary.key_points,
                                    whyKo: summary.why_it_matters
                                },
                                summaryModelSpec.model
                            )
                            itemRow.titleKo = summary.title_ko
                            itemRow.summaryKo = summary.summary_ko
                            itemRow.whyKo = summary.why_it_matters
                        } catch (summaryError) {
                            // 요약 실패 → 그 기사는 요약 없이 그대로 실음 (뒤 단계는 원제와 수집한 첫 부분을 대신 사용)
                            log('warn', `요약 실패(${itemRow.title.slice(0, 40)}): ${(summaryError as Error).message}`)
                        }
                    }
                    onProgress({
                        stage: 'summarize',
                        message: '한국어로 요약하는 중',
                        current: ++summarizedCount,
                        total: selectedEntries.length
                    })
                })
            )

            // =============================== ⑨ 같은 소식 묶기 2차 ===================================
            // 한국어 제목 · 요약(160자)끼리 비교해 1차에서 언어가 달라 놓친 중복을 잡음
            const triagedItemById = new Map(dedupedItems.map((triagedItem) => [triagedItem.id, triagedItem])) // 선정된 기사의 점수 정보를 번호로 찾기
            const secondClusteredItems = await clusterAndMerge(
                selectedEntries.map((selectedEntry) => triagedItemById.get(selectedEntry.id)!),
                (itemId) => {
                    const itemRow = itemRowById.get(itemId)!
                    return { title: itemRow.titleKo ?? itemRow.title, summary: (itemRow.summaryKo ?? itemRow.snippet).slice(0, 160) }
                }
            )

            // 합쳐져 줄었으면 빠진 자리는 채우지 않고, 남은 기사로 순위 · 섹션만 다시 매김
            if (secondClusteredItems.length < selectedEntries.length)
                selectedEntries = selectEntries(secondClusteredItems, secondClusteredItems.length)

            // =============================== ⑩ 본문 번역 ===================================
            // 절약 모드에서는 미리 번역하지 않음 (기사를 읽을 때 번역)
            if (!saveMode) {
                let translatedCount = 0 // 처리가 끝난 기사 수 (진행 표시용, 번역하지 않은 것 · 실패 포함)
                onProgress({ stage: 'translate', message: '본문을 한국어로 옮기는 중', current: 0, total: selectedEntries.length })
                await Promise.all(
                    selectedEntries.map(async (selectedEntry) => {
                        try {
                            // 한국어 기사이거나 이미 번역한 기사는 아무것도 하지 않음
                            await this.deps.translateWithSession(llmSession, selectedEntry.id, saveMode)
                        } catch (translateError) {
                            // 번역 실패 → 그 기사는 번역 없이 게시
                            log(
                                'warn',
                                `번역 실패(${itemRowById.get(selectedEntry.id)!.title.slice(0, 40)}): ${(translateError as Error).message}`
                            )
                        }
                        onProgress({
                            stage: 'translate',
                            message: '본문을 한국어로 옮기는 중',
                            current: ++translatedCount,
                            total: selectedEntries.length
                        })
                    })
                )
            }

            // =============================== ⑪ 머리글 ===================================
            // 기본값: 1위 기사의 제목 (머리글 생성에 실패하면 이 값으로 게시, 흐름 요약은 없음)
            onProgress({ stage: 'digest', message: '오늘의 한 줄을 쓰는 중' })
            const topItemRow = itemRowById.get(selectedEntries[0]!.id)!
            let headline = topItemRow.titleKo ?? topItemRow.title // 오늘의 한 줄
            let overview: string | null = null // 오늘의 흐름 요약
            try {
                // 선정된 기사의 섹션 · 한국어 제목 · 요약만 보냄 (본문 제외, 요약이 없으면 수집한 첫 300자)
                const digestUserMessage = selectedEntries
                    .map((selectedEntry) => {
                        const itemRow = itemRowById.get(selectedEntry.id)!
                        return JSON.stringify({
                            id: itemRow.id,
                            section: SECTION_LABEL[selectedEntry.section],
                            title: itemRow.titleKo ?? itemRow.title,
                            summary: itemRow.summaryKo ?? itemRow.snippet.slice(0, 300)
                        })
                    })
                    .join('\n')

                // 날짜는 매번 바뀌는 값이라 시스템 프롬프트가 아닌 사용자 메시지에 넣음 (DESIGN.md 7.5절 ④)
                const digestResponse = await llmSession.completeJson(
                    'digest',
                    modelSpecForRole(config.models, 'digest', saveMode),
                    { system: config.prompts.digest, user: `날짜: ${todayDateKey}\n\n${digestUserMessage}` },
                    {
                        name: 'digest',
                        jsonSchema: DigestJsonSchema,
                        zod: DigestZod
                    }
                )
                headline = digestResponse.headline
                overview = digestResponse.overview
            } catch (digestError) {
                log('warn', `머리글 생성 실패, 1위 기사 제목으로 대신함: ${(digestError as Error).message}`)
            }

            // =============================== ⑫ 게시 ===================================
            // 브리핑과 함께 저장하는 이번 실행의 통계
            onProgress({ stage: 'publish', message: '브리핑을 저장하는 중' })
            const digestStats: DigestStats = {
                sources: config.sources.length,
                collected: collectedCount,
                candidates: candidateRows.length,
                selected: selectedEntries.length,
                costUsd: llmUsageRepository.sumCostForRun(runId),
                failedSources,
                saveMode
            }

            // 오늘 날짜의 브리핑으로 저장 (같은 날짜가 이미 있으면 내용을 바꿔 끼움)
            const digestId = this.publishDigest({
                date: todayDateKey,
                headline,
                overview,
                stats: digestStats,
                entries: selectedEntries.map((selectedEntry) => ({
                    itemId: selectedEntry.id,
                    rank: selectedEntry.rank,
                    section: selectedEntry.section,
                    whyItMatters: itemRowById.get(selectedEntry.id)!.whyKo
                }))
            })

            // 실행 기록을 성공으로 닫고 결과 반환
            runRepository.updateRunFinished(runId, 'ok', { ...digestStats, tokens: llmSession.tokensUsed })
            onProgress({ stage: 'done', message: '완료' })
            return { digestId, date: todayDateKey, headline, entryCount: selectedEntries.length, costUsd: digestStats.costUsd }
        } catch (pipelineError) {
            // 어느 단계에서든 실패 → 실행 기록에 오류와 쓴 토큰을 남기고 화면에 알린 뒤, 부른 쪽이 알 수 있게 다시 던짐
            const failureMessage = (pipelineError as Error).message
            runRepository.updateRunFinished(runId, 'error', { tokens: llmSession.tokensUsed }, failureMessage)
            onProgress({ stage: 'error', message: failureMessage })
            throw pipelineError
        }
    }
}
