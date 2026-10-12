// ============================================================================
// Worker 서비스
//
// [역할]
// - Worker가 제공하는 기능의 구현 (메서드 이름이 곧 Main이 호출하는 기능 이름, 규약은 shared/worker-protocol.ts)
// - 시작할 때 DB · 설정을 열고, 앱이 중간에 꺼져 "실행 중"으로 남은 실행 기록을 정리
// - 브리핑 생성은 한 번에 하나만 (이미 만드는 중이면 오류)
// - 낮 동안 미리 수집: LLM 없이 최근 24시간 글만 쌓음 (브리핑 생성 중이거나 이미 수집 중이면 건너뜀)
// - 저장 · 메모 · 하이라이트로 기사가 저장되면 본문 추출 · 태그 추천 · 번역을 응답을 기다리지 않고 뒤에서 진행
// - 본문 번역은 기사마다 한 번에 하나만, API 키가 없거나 하루 상한에 닿았으면 하지 않음
// - 이번 달 사용액이 월 예산에 도달하면 절약 모드 (저장 후 번역을 미리 하지 않고 읽을 때 번역)
// - Electron에 의존하지 않음 (Worker 프로세스의 메시지 처리는 index.ts)
// ============================================================================
import type Groq from 'groq-sdk'
import { dateKey } from '@shared/schedule'
import type { ChatEvent, ChatScope, SourceStatsDTO, StatsPeriod, UsageSummary } from '@shared/types'
import type { WorkerApi } from '@shared/worker-protocol'
import { describeSource, loadConfig, type AppConfig } from './config'
import { openDb, type Db } from './db/db'
import * as repo from './db/repo'
import { askQuestion } from './knowledge/chat'
import { enrichSavedItem } from './knowledge/enrich'
import { translateItem } from './knowledge/translate'
import { LlmSession } from './llm/service'
import { createGroqClient } from './llm/groq'
import { collectAndStore, runPipeline, type PipelineDeps } from './pipeline/run'

const DAILY_TREND_DAYS = 30 // 출처 페이지의 날마다 추이 기간 (일)

const COLLECT_ONLY_WINDOW_HOURS = 24 // 미리 수집할 때 받는 구간 (시간). 중복은 DB에서 거르므로 넉넉하게 둠

// 규약의 기능을 그대로 구현하되, 결과를 바로 돌려줘도 되고 Promise로 돌려줘도 되게 한 모양
type SyncOrAsyncApi<Api> = {
    [MethodName in keyof Api]: Api[MethodName] extends (...methodArgs: infer MethodArgs) => infer MethodResult
        ? (...methodArgs: MethodArgs) => Promise<Awaited<MethodResult>> | Awaited<MethodResult>
        : never
}

// 서비스를 만들 때 받는 값
export interface WorkerServiceOptions {
    dbPath: string // 열 DB 파일 경로
    configDir: string // 설정 파일(YAML · 프롬프트)이 있는 폴더
    apiKey: string | null // Groq API 키 (없으면 null, LLM을 쓰는 기능은 하지 않음)
    onProgress: PipelineDeps['onProgress'] // 브리핑 생성 진행 상황 알림
    log: PipelineDeps['log'] // 로그 남기기
    onItemUpdated(itemId: number): void // 저장 후 본문 추출 · 태그 추천처럼 뒤에서 끝난 작업으로 기사 정보가 바뀜
    onChatEvent(event: ChatEvent): void // 질문 답변 스트리밍 알림
}

/**
 * Worker가 제공하는 기능의 구현
 *
 * - public 메서드 이름과 인자 모양은 WorkerApi 규약 그대로 (index.ts가 기능 이름으로 메서드를 찾아 호출)
 * - 대부분의 메서드는 DB 조회 · 변경을 그대로 넘기고, 브리핑 생성 · 수집 · 번역만 중복 실행을 막음
 */
export class WorkerService implements SyncOrAsyncApi<WorkerApi> {
    private readonly db: Db
    private readonly config: AppConfig // 시작할 때 한 번 읽은 설정
    private groq: Groq | null // API 키가 없으면 null
    private runningPipeline: Promise<unknown> | null = null // 진행 중인 브리핑 생성 (없으면 null)
    private runningCollect: Promise<unknown> | null = null // 진행 중인 미리 수집 (없으면 null)
    private readonly translationsInProgress = new Map<number, Promise<boolean>>() // 기사 번호별 진행 중인 번역 (같은 기사를 두 번 번역하지 않게)

    constructor(private readonly options: WorkerServiceOptions) {
        // DB를 열고, 앱이 중간에 꺼져 "실행 중"으로 남은 실행 기록을 오류로 정리
        this.db = openDb(options.dbPath)
        repo.abandonStaleRuns(this.db)

        // 설정 읽기, API 키가 있으면 Groq 클라이언트 준비
        this.config = loadConfig(options.configDir)
        this.groq = options.apiKey ? createGroqClient(options.apiKey) : null
    }

    // 바뀐 API 키 반영 (키를 지웠으면 LLM을 쓰지 않는 상태로)
    setApiKey(apiKey: string | null): void {
        this.groq = apiKey ? createGroqClient(apiKey) : null
    }

    // 가장 최근 브리핑
    getLatestDigest() {
        return repo.getLatestDigest(this.db)
    }

    // 마지막 브리핑 날짜
    getLastDigestDate() {
        return repo.lastDigestDate(this.db)
    }

    /**
     * 브리핑 생성 (수집 · 선별 · 요약)
     *
     * - 한 번에 하나만 생성 (이미 만드는 중이면 오류)
     *
     * @param params - reason: 생성을 시작한 계기
     * @returns 만든 브리핑의 번호 · 날짜 · 오늘의 한 줄 · 기사 수 · 비용
     */
    async runPipeline({ reason }: Parameters<WorkerApi['runPipeline']>[0]) {
        // 이미 만드는 중이면 거절
        if (this.runningPipeline) throw new Error('이미 브리핑을 만드는 중입니다.')

        // 생성 시작 (진행 중 표시로 잡아 둠)
        const pipelineJob = runPipeline(
            { db: this.db, config: this.config, groq: this.groq, onProgress: this.options.onProgress, log: this.options.log },
            reason
        )
        this.runningPipeline = pipelineJob

        try {
            return await pipelineJob
        } finally {
            // 성공 · 실패 모두 다음 생성을 받을 수 있게 되돌림
            this.runningPipeline = null
        }
    }

    /**
     * 낮 동안 미리 수집 (DESIGN.md 4.3절)
     *
     * - LLM은 부르지 않고 최근 24시간 글을 받아 쌓기만 함
     * - 아침 브리핑은 지난 실행 이후 쌓인 글을 후보로 쓰므로, 피드에서 금방 밀려나는 글(인기글 · 릴리스)도 놓치지 않음
     * - 브리핑을 만드는 중이거나 이미 수집 중이면 건너뜀
     *
     * @returns 새로 쌓인 글 수(collected)와 건너뛰었는지(skipped)
     */
    async collectOnly() {
        // 브리핑 생성 중(생성이 직접 수집함)이거나 이미 수집 중이면 건너뜀
        if (this.runningPipeline || this.runningCollect) return { collected: 0, skipped: true }

        // 최근 24시간 글 수집 시작 (수집 기록에는 "미리 수집"으로 남김)
        const collectJob = collectAndStore(
            { db: this.db, config: this.config, log: this.options.log },
            new Date(Date.now() - COLLECT_ONLY_WINDOW_HOURS * 3600_000),
            'collect'
        )
        this.runningCollect = collectJob

        try {
            // 끝나면 새로 쌓인 글 수와 실패한 출처 수를 로그로 남김
            const { collected, failedSources } = await collectJob
            this.options.log('info', `미리 수집: 새 글 ${collected}건${failedSources.length ? `, 실패 ${failedSources.length}곳` : ''}`)
            return { collected, skipped: false }
        } finally {
            // 성공 · 실패 모두 다음 수집을 받을 수 있게 되돌림
            this.runningCollect = null
        }
    }

    // 읽음 표시
    markRead({ itemId }: { itemId: number }) {
        repo.markRead(this.db, itemId)
    }

    // 저장 · 저장 해제 (저장했으면 본문 추출 · 태그 추천을 뒤에서 진행)
    setSaved({ itemId, saved }: { itemId: number; saved: boolean }) {
        repo.setSaved(this.db, itemId, saved)
        if (saved) this.enrichLater(itemId)
    }

    // 메모 저장 → 저장한 시각 (빈 메모는 삭제. 메모를 쓴 기사는 자동 저장되므로 뒤에서 보강)
    saveMemo({ itemId, body }: { itemId: number; body: string }) {
        const savedAt = repo.saveMemo(this.db, itemId, body)
        if (body.trim()) this.enrichLater(itemId)
        return { savedAt }
    }

    // 저장한 기사의 본문 추출 · 태그 추천 · 번역을 응답을 기다리지 않고 뒤에서 진행
    private enrichLater(itemId: number): void {
        void enrichSavedItem({ db: this.db, config: this.config, groq: this.groq, log: this.options.log }, itemId)
            .then((wasEnriched) => {
                // 보강을 했으면 화면에 기사 변경 알림 (이미 보강한 기사 등 할 일이 없었으면 알리지 않음)
                if (wasEnriched) this.options.onItemUpdated(itemId)

                // 본문을 새로 뽑았으면 번역이 비었으므로 다시 번역 (절약 모드면 읽을 때 번역)
                if (wasEnriched && !this.getUsage().saveMode) void this.translateItem({ itemId })
            })
            .catch((enrichError: unknown) => this.options.log('warn', `저장 후 처리 실패: ${(enrichError as Error).message}`))
    }

    /**
     * 기사 본문 번역 (읽기 화면에서 번역이 없을 때 요청)
     *
     * - 끝나면 item-updated로 알림
     * - 하루 상한에 닿았거나 키가 없으면 하지 않음
     * - 같은 기사를 번역하는 중이면 새로 시작하지 않고 진행 중인 번역의 결과를 돌려줌
     *
     * @param params - itemId: 번역할 기사 번호
     * @returns {Promise<boolean>} 번역을 새로 만들었으면 true (하지 않았거나 실패하면 false)
     */
    translateItem({ itemId }: { itemId: number }): Promise<boolean> {
        // 이 기사를 이미 번역하는 중이면 그 번역을 그대로 돌려줌
        const pendingTranslation = this.translationsInProgress.get(itemId)
        if (pendingTranslation) return pendingTranslation

        // API 키가 없거나 오늘 사용액이 하루 상한에 닿았으면 번역하지 않음
        const usageSummary = this.getUsage()
        if (!this.groq || usageSummary.todayUsd >= usageSummary.dailyCapUsd) return Promise.resolve(false)

        // 번역 시작 (브리핑 생성 밖의 호출이라 실행 번호 없이 사용량 기록, 절약 모드면 절약 모드 모델)
        const llmSession = new LlmSession(this.groq, this.db, this.config.pricing, null)
        const translationJob = translateItem(
            { db: this.db, config: this.config, llm: llmSession, saveMode: usageSummary.saveMode, log: this.options.log },
            itemId
        )
            .catch((translateError: unknown) => {
                // 실패 → 로그만 남기고 "번역하지 않음"으로 끝냄 (호출한 쪽에 오류를 던지지 않음)
                this.options.log('warn', `번역 실패: ${(translateError as Error).message}`)
                return false
            })
            .finally(() => {
                // 성공 · 실패 모두 진행 중 목록에서 빼고 화면에 기사 변경 알림
                this.translationsInProgress.delete(itemId)
                this.options.onItemUpdated(itemId)
            })

        // 끝날 때까지 진행 중 목록에 올려 둠
        this.translationsInProgress.set(itemId, translationJob)
        return translationJob
    }

    // 하이라이트 긋기 → 그 기사의 하이라이트 목록 (그어서 기사가 새로 저장됐으면 뒤에서 보강)
    addHighlights({ itemId, ranges }: Parameters<WorkerApi['addHighlights']>[0]) {
        const addResult = repo.addHighlights(this.db, itemId, ranges)
        if (addResult.newlySaved) this.enrichLater(itemId)
        return addResult.highlights
    }

    // 하이라이트 메모 수정 → 그 기사의 하이라이트 목록
    updateHighlightNote({ highlightId, note }: { highlightId: number; note: string }) {
        return repo.updateHighlightNote(this.db, highlightId, note)
    }

    // 하이라이트 지우기 → 그 기사의 남은 하이라이트 목록
    removeHighlight({ highlightId }: { highlightId: number }) {
        return repo.removeHighlight(this.db, highlightId)
    }

    /**
     * 출처 페이지의 통계
     *
     * - 설정의 모든 출처(꺼진 것 포함)에 통계를 붙임
     * - 전체 흐름은 설정에서 빠진 옛 출처까지 합함
     *
     * @param params - period: 통계를 볼 기간 (일 수 또는 'all')
     * @returns {SourceStatsDTO} 출처별 통계와 전체 흐름 · 비용 · 날마다 추이
     */
    getSourceStats({ period }: { period: StatsPeriod }): SourceStatsDTO {
        // 고른 기간의 시작 시각 (전체 기간이면 제한 없음)
        const periodStartIso = period === 'all' ? null : new Date(Date.now() - period * 24 * 3600_000).toISOString()

        // DB에서 출처 ID별 통계 조회 (출처 이름 · 설명은 들어 있지 않음)
        const rawStats = repo.getSourceStats(this.db, periodStartIso, DAILY_TREND_DAYS)

        // 설정의 출처마다 이름 · 수집 방식 · 조건을 붙이고, 기록이 없는 출처는 빈 값으로 채움
        const sourceStats = this.config.allSources.map((sourceConfig) => {
            const sourceDescription = describeSource(sourceConfig)
            return {
                id: sourceConfig.id,
                name: sourceConfig.name,
                method: sourceDescription.method,
                enabled: sourceConfig.enabled,
                weight: sourceConfig.weight,
                rules: sourceDescription.rules,
                url: sourceDescription.url,
                period: rawStats.period.get(sourceConfig.id) ?? repo.createEmptyFunnel(),
                total: rawStats.total.get(sourceConfig.id) ?? repo.createEmptyFunnel(),
                lastFetch: rawStats.lastFetch.get(sourceConfig.id) ?? null,
                failures: rawStats.failures.get(sourceConfig.id) ?? 0,
                recentFetches: rawStats.recentFetches.get(sourceConfig.id) ?? [],
                recentPublished: rawStats.recentPublished.get(sourceConfig.id) ?? []
            }
        })

        // 전체 흐름은 DB에 있는 모든 출처를 합함 (설정에서 빠진 옛 출처 포함)
        return {
            period,
            funnel: { period: repo.sumFunnels([...rawStats.period.values()]), total: repo.sumFunnels([...rawStats.total.values()]) },
            cost: rawStats.cost,
            daily: rawStats.daily,
            sources: sourceStats
        }
    }

    // 저장한 기사 또는 브리핑에 실린 기사 검색
    search(searchParams: Parameters<WorkerApi['search']>[0]) {
        return repo.searchItems(this.db, searchParams)
    }

    // 태그와 개수
    listTags() {
        return repo.listTags(this.db)
    }

    // 기사 하나의 전체 정보
    getItem({ itemId }: { itemId: number }) {
        return repo.getItemDetail(this.db, itemId)
    }

    // 태그 붙이기 → 그 기사의 태그 목록 (사용자가 직접 붙인 태그로 기록)
    addTag({ itemId, name }: { itemId: number; name: string }) {
        return repo.addTag(this.db, itemId, name, 'user')
    }

    // 태그 떼기 → 그 기사의 남은 태그 목록
    removeTag({ itemId, name }: { itemId: number; name: string }) {
        return repo.removeTag(this.db, itemId, name)
    }

    // 지난 브리핑 목록
    listDigests() {
        return repo.listDigests(this.db)
    }

    // 그 날짜의 브리핑
    getDigest({ date }: { date: string }) {
        return repo.getDigestByDate(this.db, date)
    }

    // 그 범위에서 나눈 대화
    getChat({ scope }: { scope: ChatScope }) {
        return repo.listChatMessages(this.db, scope)
    }

    // 질문하기 (답변은 onChatEvent 알림으로 흘려보냄)
    ask({ requestId, scope, question }: { requestId: string; scope: ChatScope; question: string }) {
        return askQuestion(
            { db: this.db, config: this.config, groq: this.groq, emit: this.options.onChatEvent, log: this.options.log },
            requestId,
            scope,
            question
        )
    }

    // 그 범위의 대화 삭제
    clearChat({ scope }: { scope: ChatScope }) {
        repo.clearChat(this.db, scope)
    }

    // 설정 파일에 정해 둔 빠른 질문 목록
    getQuickActions() {
        return this.config.quickActions
    }

    /**
     * LLM 비용 사용량과 한도
     *
     * @returns {UsageSummary} 이번 달 · 오늘 사용액, 월 예산 · 하루 상한, 절약 모드 여부
     */
    getUsage(): UsageSummary {
        const now = new Date()
        const appSettings = repo.getSettings(this.db) // 월 예산 · 하루 상한을 꺼낼 사용자 설정

        // 이번 달 1일 0시 · 오늘 0시(로컬 시간)부터 쓴 금액
        const monthUsd = repo.sumCostSince(this.db, new Date(now.getFullYear(), now.getMonth(), 1).toISOString())
        const todayUsd = repo.sumCostSince(this.db, new Date(`${dateKey(now)}T00:00:00`).toISOString())

        // 이번 달 사용액이 월 예산에 도달했으면 절약 모드
        return {
            monthUsd,
            todayUsd,
            budgetUsd: appSettings.budgetUsd,
            dailyCapUsd: appSettings.dailyCapUsd,
            saveMode: monthUsd >= appSettings.budgetUsd
        }
    }

    // 사용자 설정
    getSettings() {
        return repo.getSettings(this.db)
    }

    // 준 항목만 변경 → 바뀐 뒤의 전체 설정
    updateSettings(settingsPatch: Parameters<WorkerApi['updateSettings']>[0]) {
        return repo.updateSettings(this.db, settingsPatch)
    }

    // DB 닫기
    close(): void {
        this.db.close()
    }
}
