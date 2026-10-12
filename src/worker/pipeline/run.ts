// ============================================================================
// 브리핑 생성 파이프라인
//
// [역할]
// - 수집부터 게시까지 브리핑 한 번을 만드는 전체 순서 진행 (Worker 프로세스 안에서 실행, DESIGN.md 9절)
// - 예산: 오늘 사용액이 하루 상한 이상이면 만들지 않음, 이번 달 사용액이 월 예산 이상이면 절약 모드 (작은 모델 · 최대 15건 · 번역 생략)
// - 수집 구간: 오늘 이전에 성공한 마지막 실행부터 지금까지 (첫 실행 24시간, 최대 72시간)
// - 비용 절감: 규칙 점수 상위 120건만 LLM 선별, 이미 선별 · 요약한 기사는 다시 하지 않음
// - 중복 제거: 같은 소식은 대표 하나로 합치고, 지난 7일 브리핑에 실린 소식은 뺌 (중요한 새 전개는 "후속"으로 실음)
// - 본문이 300자 미만인 기사는 싣지 않고 다음 순위 후보로 채움 (제목만으로 요약하면 내용을 지어내게 됨)
// - 일부 실패는 건너뛰고 계속: 소스 수집 · 선별 배치 일부 · 같은 소식 묶기 · 7일 중복 확인 · 요약 · 번역 · 머리글
// - 중단하는 경우: API 키 없음, 하루 상한 도달, 선별 전부 실패, 실을 기사 없음 (실행 기록에 오류를 남기고 예외를 던짐)
// - 낮 동안 미리 수집도 이 파일의 수집 · 저장 단계를 사용 (LLM 호출 없음)
// ============================================================================
import type Groq from 'groq-sdk'
import { dateKey, type TriggerReason } from '@shared/schedule'
import { SECTION_LABEL, type DigestStats, type RunProgress } from '@shared/types'
import type { RunResult } from '@shared/worker-protocol'
import { collectSource } from '../collectors'
import type { RawItem } from '../collectors/types'
import { modelSpecForRole, type AppConfig } from '../config'
import { runInTransaction, type Db } from '../db/db'
import * as repo from '../db/repo'
import { ensureContent } from '../knowledge/content'
import { translateItem } from '../knowledge/translate'
import { LlmSession } from '../llm/service'
import { applyClusters, fillWithContent, finalScore, ruleScore, selectEntries, type TriagedItem } from './select'
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
} from './schemas'

const TRIAGE_CANDIDATE_LIMIT = 120 // LLM 선별에 보내는 후보 수 상한 (규칙 점수 상위, 건)
const TRIAGE_BATCH_SIZE = 10 // 선별 호출 한 번에 묶어 보내는 기사 수 (건)
const FIRST_RUN_WINDOW_HOURS = 24 // 성공한 실행이 아직 없을 때의 수집 구간 (시간)
const MAX_WINDOW_HOURS = 72 // 수집 구간의 최대 길이 (시간, 오래 비웠어도 이보다 전 글은 모으지 않음)
const SAVE_MODE_DIGEST_SIZE = 15 // 절약 모드에서 브리핑에 싣는 최대 기사 수 (건)
const RECENT_DIGEST_DAYS = 7 // 이 기간(일) 안에 실린 소식은 다시 싣지 않음 (큰 후속 소식은 '후속'으로 실음)
const SOURCE_FETCH_KEEP_DAYS = 90 // 출처별 수집 기록을 남겨 두는 기간 (일)
const MIN_BODY_CHARS = 300 // 이보다 본문이 짧으면(제목 · 한 줄 소개뿐) 브리핑에 싣지 않음 (글자 수)
const EXTRACT_ATTEMPT_FACTOR = 2 // 본문 추출을 시도하는 후보 수 상한 = 브리핑 크기 × 이 값

// 본문 문단들의 글자 수 합
const countBodyChars = (paragraphs: string[]) => paragraphs.reduce((charCount, paragraph) => charCount + paragraph.length, 0)

// 파이프라인이 쓰는 바깥 자원
export interface PipelineDeps {
    db: Db // 기사 · 브리핑 · 실행 기록을 읽고 쓰는 DB
    config: AppConfig // 수집 소스 · 관심 키워드 · 모델 · 단가 · 프롬프트 설정
    groq: Groq | null // LLM 클라이언트 (API 키가 없으면 null)
    onProgress(runProgress: RunProgress): void // 단계별 진행 상황을 화면으로 보낼 때 호출
    log(level: 'info' | 'warn' | 'error', message: string): void // 로그 기록
}

const HOUR_MS = 3600 * 1000 // 1시간 (밀리초)

// 그날 0시 (이 컴퓨터의 시간대 기준)
function startOfLocalDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

// 수집 구간의 시작 시각 결정
// - 오늘 이전에 성공한 마지막 실행의 시작 시각부터 (최대 72시간 전까지, 첫 실행이면 24시간 전)
// - 같은 날 다시 만들 때도 오늘 아침 실행이 아니라 어제 실행을 기준으로 해서 후보가 줄지 않게 함
function collectionSince(db: Db, now: Date): Date {
    const earliestAllowedStart = new Date(now.getTime() - MAX_WINDOW_HOURS * HOUR_MS) // 구간이 이보다 앞에서 시작할 수 없음

    // 오늘 0시 이전에 시작해 성공한 마지막 실행
    const lastRunStartedAt = repo.lastSuccessfulRunStartedAt(db, startOfLocalDay(now).toISOString())

    // 성공한 실행이 없음(첫 실행) → 최근 24시간
    if (!lastRunStartedAt) return new Date(now.getTime() - FIRST_RUN_WINDOW_HOURS * HOUR_MS)

    // 마지막 실행이 72시간보다 오래됨 → 72시간 전부터, 아니면 마지막 실행 시각부터
    const lastRunStart = new Date(lastRunStartedAt)
    return lastRunStart < earliestAllowedStart ? earliestAllowedStart : lastRunStart
}

/**
 * ① 수집 · ② 저장 · 중복 합치기
 * - 낮 동안 미리 수집(collectOnly)도 이 함수를 사용
 * - 소스 하나가 실패해도 나머지는 계속 진행
 * - 출처마다 수집 기록(성공 여부 · 가져온 수 · 새 글 수 · 오류)을 남김
 *
 * @param deps - DB · 설정 · 로그 (onProgress는 없으면 진행 상황을 보내지 않음)
 * @param {Date} since - 이 시각 이후의 글만 수집
 * @param reason - 수집 기록에 남길 계기 (브리핑 생성 'briefing', 미리 수집 'collect')
 * @returns 새로 쌓인 글 수(collected)와 실패한 소스 목록(failedSources, "이름 (오류)" 모양)
 */
export async function collectAndStore(
    deps: Pick<PipelineDeps, 'db' | 'config' | 'log'> & { onProgress?: PipelineDeps['onProgress'] },
    since: Date,
    reason: 'briefing' | 'collect' = 'briefing'
): Promise<{ collected: number; failedSources: string[] }> {
    const { db, config, log } = deps
    const onProgress = deps.onProgress ?? (() => {})
    const failedSources: string[] = [] // 브리핑 통계에 실을 실패 소스 ("이름 (오류)")
    const fetchErrorBySourceId = new Map<string, string>() // 출처별 수집 기록에 남길 오류 (출처 페이지의 상태 · 실패 기록용)
    let finishedSourceCount = 0 // 수집이 끝난 소스 수 (진행 표시용, 실패 포함)

    // 모든 소스에서 동시에 수집 (결과 순서는 config.sources와 같음)
    onProgress({ stage: 'collect', message: '소스에서 새 글을 가져오는 중', current: 0, total: config.sources.length })
    const rawItemsBySource = await Promise.all(
        config.sources.map(async (source): Promise<RawItem[]> => {
            try {
                return await collectSource(source, since, config.interests)
            } catch (collectError) {
                // 이 소스만 실패 → 빈 결과로 두고 나머지는 계속
                // 수집 기록에는 오류의 첫 줄만 200자까지 남김
                failedSources.push(`${source.name} (${(collectError as Error).message})`)
                fetchErrorBySourceId.set(source.id, (collectError as Error).message.split('\n')[0]!.slice(0, 200))
                log('warn', `수집 실패: ${source.name}: ${(collectError as Error).message}`)
                return []
            } finally {
                onProgress({
                    stage: 'collect',
                    message: '소스에서 새 글을 가져오는 중',
                    current: ++finishedSourceCount,
                    total: config.sources.length
                })
            }
        })
    )

    // 수집한 글 저장 (모든 소스를 한 트랜잭션으로)
    onProgress({ stage: 'dedup', message: '중복을 합치는 중' })
    let collectedCount = 0 // 새로 쌓인 글 수 (이미 있던 글에 합쳐진 것은 세지 않음)
    const fetchedAt = new Date().toISOString() // 이번 수집 기록에 공통으로 남길 시각
    runInTransaction(db, () => {
        config.sources.forEach((source, sourceIndex) => {
            // 글 하나씩 저장 (URL이 같거나 최근 3일 안에 제목이 같은 글이 있으면 그 글에 출처만 합침)
            const sourceRawItems = rawItemsBySource[sourceIndex]!
            let newItemCount = 0 // 이 소스에서 새로 쌓인 글 수
            for (const rawItem of sourceRawItems) if (repo.upsertRawItem(db, rawItem).isNew) newItemCount++
            collectedCount += newItemCount

            // 이 출처의 수집 기록 남기기
            repo.recordSourceFetch(db, {
                sourceId: source.id,
                at: fetchedAt,
                reason,
                ok: !fetchErrorBySourceId.has(source.id),
                fetched: sourceRawItems.length,
                newItems: newItemCount,
                error: fetchErrorBySourceId.get(source.id) ?? null
            })
        })

        // 90일이 지난 수집 기록 삭제
        repo.pruneSourceFetches(db, SOURCE_FETCH_KEEP_DAYS)
    })
    return { collected: collectedCount, failedSources }
}

/**
 * 브리핑 한 번 생성 (수집 → 선별 → 중복 제거 → 선정 → 요약 → 번역 → 머리글 → 게시)
 * - API 키가 없거나 오늘 사용액이 하루 상한 이상이면 실행 기록을 만들기 전에 예외
 * - 그 뒤 단계에서 난 예외는 실행 기록에 오류로 남기고 화면에 실패를 알린 뒤 다시 던짐
 *
 * @param {PipelineDeps} deps - DB · 설정 · LLM 클라이언트 · 진행 알림 · 로그
 * @param {TriggerReason} reason - 생성을 시작한 계기 (실행 기록에 남김)
 * @returns {Promise<RunResult>} 게시한 브리핑의 번호 · 날짜 · 오늘의 한 줄 · 기사 수 · 이번 실행 비용
 */
export async function runPipeline(deps: PipelineDeps, reason: TriggerReason): Promise<RunResult> {
    const { db, config, onProgress, log } = deps

    // API 키가 없으면 LLM을 부를 수 없으므로 시작하지 않음
    if (!deps.groq) throw new Error('Groq API 키가 없습니다. 설정에서 키를 입력하세요.')
    const groq = deps.groq
    const now = new Date()
    const todayDateKey = dateKey(now) // 오늘 날짜 (브리핑 날짜로 사용)

    // =============================== 예산 확인 ===================================
    // 이번 달 1일부터 · 오늘 0시부터 쓴 LLM 비용 합산 (DESIGN.md 7.5절 ⑤)
    const appSettings = repo.getSettings(db)
    const monthStartIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthCostUsd = repo.sumCostSince(db, monthStartIso)
    const todayCostUsd = repo.sumCostSince(db, startOfLocalDay(now).toISOString())

    // 오늘 사용액이 하루 상한 이상 → 생성 중단
    if (todayCostUsd >= appSettings.dailyCapUsd) {
        throw new Error(
            `오늘 LLM 사용액($${todayCostUsd.toFixed(2)})이 하루 상한($${appSettings.dailyCapUsd})에 도달해 생성을 중단했습니다.`
        )
    }

    // 이번 달 사용액이 월 예산 이상 → 절약 모드 (모든 역할을 절약 모드 모델로, 브리핑 최대 15건, 본문 번역 생략)
    const saveMode = monthCostUsd >= appSettings.budgetUsd
    if (saveMode) log('warn', `월 예산 $${appSettings.budgetUsd} 도달 → 절약 모드로 실행`)

    // 수집 구간을 정하고 실행 기록 시작 (이 실행의 LLM 사용량은 실행 번호와 함께 기록됨)
    const since = collectionSince(db, now)
    const runId = repo.createRun(db, reason, since.toISOString())
    const llmSession = new LlmSession(groq, db, config.pricing, runId)

    try {
        // =============================== ① 수집 · ② 저장 · 중복 합치기 ===================================
        const { collected: collectedCount, failedSources } = await collectAndStore(deps, since)

        // =============================== ③ 규칙 점수로 1차 거르기 ===================================
        // 후보: 수집 구간 안에 들어왔고, 다른 기사에 합쳐지지 않았고, 오늘이 아닌 날의 브리핑에 실린 적 없는 기사
        const weightBySourceId = new Map(config.sources.map((source) => [source.id, source.weight])) // 소스별 신뢰도 가중치
        const candidateRows = repo.getBriefingCandidates(db, since.toISOString(), todayDateKey)

        // LLM 비용을 줄이려고 규칙 점수를 먼저 매겨 상위 120건만 선별 단계로 넘김
        const scoredCandidates = candidateRows
            .map((candidateRow) => {
                const otherSourceCount = (JSON.parse(candidateRow.other_sources) as unknown[]).length // 같은 소식을 다룬 다른 출처 수
                const referenceTimeMs = Date.parse(candidateRow.published_at ?? candidateRow.collected_at) // 최신성 기준 시각 (게시 시각, 없으면 수집 시각)
                return {
                    itemRow: candidateRow,
                    otherSourceCount,
                    ruleScore: ruleScore(
                        {
                            id: candidateRow.id,
                            title: candidateRow.title,
                            snippet: candidateRow.snippet,
                            sourceWeight: weightBySourceId.get(candidateRow.source_id) ?? 1, // 꺼 두었거나 목록에서 뺀 소스의 글은 가중치 1
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
        const untriagedCandidates = scoredCandidates.filter((scoredCandidate) => scoredCandidate.itemRow.triage_category === null)
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
                            source: scoredCandidate.itemRow.source_name,
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
                        repo.saveTriage(db, triageResult.id, triageResult)
                        const triagedCandidate = triageBatch.find((batchCandidate) => batchCandidate.itemRow.id === triageResult.id)!
                        triagedCandidate.itemRow.triage_category = triageResult.category
                        triagedCandidate.itemRow.triage_relevance = triageResult.relevance
                        triagedCandidate.itemRow.triage_importance = triageResult.importance
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
            .filter((scoredCandidate) => scoredCandidate.itemRow.triage_category !== null)
            .map((scoredCandidate) => ({
                id: scoredCandidate.itemRow.id,
                category: scoredCandidate.itemRow.triage_category!,
                relevance: scoredCandidate.itemRow.triage_relevance ?? 0,
                importance: scoredCandidate.itemRow.triage_importance ?? 1,
                ruleScore: scoredCandidate.ruleScore,
                engagement: scoredCandidate.itemRow.engagement,
                otherSourceCount: scoredCandidate.otherSourceCount
            }))

        // 브리핑에 실을 기사 수 (설정값, 절약 모드에서는 최대 15건)
        const digestSize = saveMode ? Math.min(appSettings.digestSize, SAVE_MODE_DIGEST_SIZE) : appSettings.digestSize

        const itemRowById = new Map(scoredCandidates.map((scoredCandidate) => [scoredCandidate.itemRow.id, scoredCandidate.itemRow])) // 기사 번호로 찾는 후보 행 (선별 · 요약 결과가 여기에 채워짐)

        // 같은 소식을 LLM에게 묶게 하고 대표 하나로 합침 (실패하면 묶지 않고 진행)
        // 판단이 까다로워 요약용 큰 모델을 사용 (호출 한 번이라 비용은 미미함)
        const clusterAndMerge = async (itemsToCluster: TriagedItem[], describeItem: (itemId: number) => object): Promise<TriagedItem[]> => {
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
                    repo.mergeItemsInto(db, representativeId, mergedMemberIds)
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
            return { source: itemRow.source_name, title: itemRow.title, snippet: itemRow.snippet.slice(0, 160) }
        })

        // =============================== ⑥ 지난 7일 중복 확인 ===================================
        // 지난 7일 브리핑에 실린 기사 (오늘 브리핑 제외)
        const recentEntries = repo.listRecentPublished(db, todayDateKey, RECENT_DIGEST_DAYS)
        const alreadySentIds = new Set<number>() // 이미 보낸 소식이라 후보에서 뺄 기사 번호

        // 지난 브리핑이 없거나 후보가 없으면 확인할 것 없음
        if (recentEntries.length > 0 && mergedPool.length > 0) {
            try {
                // 지난 브리핑 목록과 1차로 묶은 상위 후보를 함께 보내 같은 발표 · 사건끼리 짝짓게 함
                const recentUserMessage = [
                    '지난 브리핑:',
                    ...recentEntries.map((recentEntry) =>
                        JSON.stringify({ id: recentEntry.id, date: recentEntry.date, title: recentEntry.title })
                    ),
                    '',
                    '오늘 후보:',
                    ...mergedPool.map((triagedItem) => {
                        const itemRow = itemRowById.get(triagedItem.id)!
                        return JSON.stringify({
                            id: itemRow.id,
                            source: itemRow.source_name,
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
                const recentEntryIds = new Set(recentEntries.map((recentEntry) => recentEntry.id)) // 지난 브리핑에 실린 기사 번호
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
                        repo.markFollowUp(db, recentMatch.id, recentMatch.previous_id)
                        followUpCount++
                    } else {
                        // 이미 보낸 소식 → 지난 기사에 출처로 붙이고 후보에서 뺌
                        repo.mergeItemsInto(db, recentMatch.previous_id, [recentMatch.id])
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
            const itemContent = await ensureContent(db, itemRowById.get(itemId)!, log)
            const hasEnoughBody = countBodyChars(itemContent.paragraphs) >= MIN_BODY_CHARS // 본문이 300자 이상인지

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
                if (!itemRow.summary_ko) {
                    const itemContent = repo.getContent(db, itemRow.id)! // 바로 앞 단계에서 확보한 본문
                    try {
                        const summary = await llmSession.completeJson(
                            'summary',
                            summaryModelSpec,
                            {
                                system: config.prompts.summary,
                                user: summaryUserMessage({
                                    sourceName: itemRow.source_name,
                                    kind: itemRow.kind,
                                    title: itemRow.title,
                                    paragraphs: itemContent.paragraphs,
                                    fullText: itemContent.fullText
                                })
                            },
                            { name: 'article_summary', jsonSchema: SummaryJsonSchema, zod: SummaryZod }
                        )

                        // 요약을 DB에 저장하고, 뒤 단계(2차 묶기 · 머리글 · 게시)가 쓰도록 메모리의 행에도 반영
                        repo.saveSummary(
                            db,
                            itemRow.id,
                            {
                                titleKo: summary.title_ko,
                                summaryKo: summary.summary_ko,
                                keyPoints: summary.key_points,
                                whyKo: summary.why_it_matters
                            },
                            summaryModelSpec.model
                        )
                        itemRow.title_ko = summary.title_ko
                        itemRow.summary_ko = summary.summary_ko
                        itemRow.why_ko = summary.why_it_matters
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
                return { title: itemRow.title_ko ?? itemRow.title, summary: (itemRow.summary_ko ?? itemRow.snippet).slice(0, 160) }
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
                        // 한국어 기사이거나 이미 번역한 기사는 translateItem이 아무것도 하지 않음
                        await translateItem({ db, config, llm: llmSession, saveMode, log }, selectedEntry.id)
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
        let headline = topItemRow.title_ko ?? topItemRow.title // 오늘의 한 줄
        let overview: string | null = null // 오늘의 흐름 요약
        try {
            // 선정된 기사의 섹션 · 한국어 제목 · 요약만 보냄 (본문 제외, 요약이 없으면 수집한 첫 300자)
            const digestUserMessage = selectedEntries
                .map((selectedEntry) => {
                    const itemRow = itemRowById.get(selectedEntry.id)!
                    return JSON.stringify({
                        id: itemRow.id,
                        section: SECTION_LABEL[selectedEntry.section],
                        title: itemRow.title_ko ?? itemRow.title,
                        summary: itemRow.summary_ko ?? itemRow.snippet.slice(0, 300)
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
            costUsd: repo.sumCostForRun(db, runId),
            failedSources,
            saveMode
        }

        // 오늘 날짜의 브리핑으로 저장 (같은 날짜가 이미 있으면 내용을 바꿔 끼움)
        const digestId = repo.publishDigest(db, {
            date: todayDateKey,
            headline,
            overview,
            stats: digestStats,
            entries: selectedEntries.map((selectedEntry) => ({
                itemId: selectedEntry.id,
                rank: selectedEntry.rank,
                section: selectedEntry.section,
                whyItMatters: itemRowById.get(selectedEntry.id)!.why_ko
            }))
        })

        // 실행 기록을 성공으로 닫고 결과 반환
        repo.finishRun(db, runId, 'ok', { ...digestStats, tokens: llmSession.tokensUsed })
        onProgress({ stage: 'done', message: '완료' })
        return { digestId, date: todayDateKey, headline, entryCount: selectedEntries.length, costUsd: digestStats.costUsd }
    } catch (pipelineError) {
        // 어느 단계에서든 실패 → 실행 기록에 오류와 쓴 토큰을 남기고 화면에 알린 뒤, 부른 쪽이 알 수 있게 다시 던짐
        const failureMessage = (pipelineError as Error).message
        repo.finishRun(db, runId, 'error', { tokens: llmSession.tokensUsed }, failureMessage)
        onProgress({ stage: 'error', message: failureMessage })
        throw pipelineError
    }
}
