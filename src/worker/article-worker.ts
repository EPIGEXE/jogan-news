// ============================================================================
// 기사 Worker
//
// [역할]
// - Worker가 제공하는 기능의 구현 (메서드 이름이 곧 Main이 호출하는 기능 이름, 규약은 shared/worker-protocol.ts)
// - Worker의 조립: DB · 설정을 열고, 저장소와 서비스를 만들어 서로 연결
// - 시작할 때 앱이 중간에 꺼져 "실행 중"으로 남은 실행 기록을 정리
// - 기능마다 맡은 서비스의 메서드 하나를 부르고 결과를 그대로 돌려줌 (규칙은 서비스에 있음)
// - DB는 열기만 함 (스키마 변경 적용은 Main이 Worker를 띄우기 전에 끝냄)
// - Electron에 의존하지 않음 (Worker 프로세스의 메시지 처리는 index.ts)
// ============================================================================
import { loadConfig } from '@config/index'
import { closeDatabase, openDatabase, type AppDatabase } from '@data/client'
import { createDigestRepository } from '@data/repositories/digest-repository'
import { createItemRepository } from '@data/repositories/item-repository'
import { createLlmUsageRepository } from '@data/repositories/llm-usage-repository'
import { createRunRepository } from '@data/repositories/run-repository'
import { createSearchRepository } from '@data/repositories/search-repository'
import { createSettingsRepository } from '@data/repositories/settings-repository'
import { createSourceFetchRepository } from '@data/repositories/source-fetch-repository'
import { createTagRepository } from '@data/repositories/tag-repository'
import type { RunProgress } from '@shared/types'
import type { WorkerApi, WorkerParams } from '@shared/worker-protocol'
import { collectSource } from './collectors'
import { extractArticle } from './knowledge/extract'
import { LlmSessionFactory } from './llm/service'
import type { WorkerLog } from './log'
import { ChatAnswerService } from './services/chat-answer-service'
import { CollectService } from './services/collect-service'
import { EnrichmentService } from './services/enrichment-service'
import { PipelineService } from './services/pipeline-service'
import { TranslationService } from './services/translation-service'

// 규약의 기능을 그대로 구현하되, 결과를 바로 돌려줘도 되고 Promise로 돌려줘도 되게 한 모양
type SyncOrAsyncApi<Api> = {
    [MethodName in keyof Api]: Api[MethodName] extends (...methodArgs: infer MethodArgs) => infer MethodResult
        ? (...methodArgs: MethodArgs) => Promise<Awaited<MethodResult>> | Awaited<MethodResult>
        : never
}

// 기사 Worker를 만들 때 받는 값
export interface ArticleWorkerOptions {
    dbPath: string // 열 DB 파일 경로
    configDir: string // 설정 파일(YAML · 프롬프트)이 있는 폴더
    apiKey: string | null // Groq API 키 (없으면 null, LLM을 쓰는 기능은 하지 않음)
    onProgress(runProgress: RunProgress): void // 브리핑 생성 진행 상황 알림
    onChatDelta(requestId: string, deltaText: string): void // 답변 조각 알림
    log: WorkerLog // 로그 남기기
}

/**
 * Worker가 제공하는 기능의 구현
 *
 * - public 메서드 이름과 인자 모양은 WorkerApi 규약 그대로 (index.ts가 기능 이름으로 메서드를 찾아 호출)
 * - 만들 때 DB · 설정을 열고 저장소 · 서비스를 조립
 */
export class ArticleWorker implements SyncOrAsyncApi<WorkerApi> {
    private readonly database: AppDatabase // 이 Worker가 연 DB 연결
    private readonly llmSessions: LlmSessionFactory // 지금의 API 키로 LLM 세션을 열어 주는 곳
    private readonly collectService: CollectService // 수집
    private readonly pipelineService: PipelineService // 브리핑 생성
    private readonly enrichmentService: EnrichmentService // 본문 확보 · 저장한 기사 보강
    private readonly translationService: TranslationService // 본문 번역
    private readonly chatAnswerService: ChatAnswerService // 질문 답변

    constructor(options: ArticleWorkerOptions) {
        const { log } = options

        // DB 열기 (스키마 변경은 Main이 이미 적용함), 설정 읽기
        const database = openDatabase(options.dbPath)
        const config = loadConfig(options.configDir)
        this.database = database

        // 저장소 생성 (같은 DB 연결을 나눠 씀)
        const itemRepository = createItemRepository(database)
        const digestRepository = createDigestRepository(database)
        const runRepository = createRunRepository(database)
        const llmUsageRepository = createLlmUsageRepository(database)
        const sourceFetchRepository = createSourceFetchRepository(database)
        const settingsRepository = createSettingsRepository(database)
        const tagRepository = createTagRepository(database)
        const searchRepository = createSearchRepository(database)

        // LLM 세션을 여는 곳 (API 키가 있으면 Groq 클라이언트 준비)
        const llmSessions = new LlmSessionFactory(llmUsageRepository, config.pricing, options.apiKey)
        this.llmSessions = llmSessions

        // 서비스 생성 (다른 서비스의 기능이 필요한 곳은 함수로 이어 줌)
        this.collectService = new CollectService({
            database,
            itemRepository,
            sourceFetchRepository,
            searchRepository,
            config,
            collectSource,
            isBriefingRunning: () => this.pipelineService.isRunning(),
            log
        })
        this.enrichmentService = new EnrichmentService({
            database,
            itemRepository,
            tagRepository,
            searchRepository,
            llmSessions,
            config,
            extractArticle,
            log
        })
        this.translationService = new TranslationService({
            database,
            itemRepository,
            llmUsageRepository,
            settingsRepository,
            searchRepository,
            llmSessions,
            config,
            ensureContent: (itemRow) => this.enrichmentService.ensureContent(itemRow),
            log
        })
        this.pipelineService = new PipelineService({
            database,
            itemRepository,
            digestRepository,
            runRepository,
            llmUsageRepository,
            settingsRepository,
            searchRepository,
            llmSessions,
            config,
            collectAndStore: (since, reason, onProgress) => this.collectService.collectAndStore(since, reason, onProgress),
            mergeItemsInto: (representativeItemId, memberItemIds) =>
                this.collectService.mergeItemsInto(representativeItemId, memberItemIds),
            ensureContent: (itemRow) => this.enrichmentService.ensureContent(itemRow),
            translateWithSession: (llmSession, itemId, saveMode) =>
                this.translationService.translateWithSession(llmSession, itemId, saveMode),
            onProgress: options.onProgress,
            log
        })
        this.chatAnswerService = new ChatAnswerService({
            itemRepository,
            digestRepository,
            llmUsageRepository,
            settingsRepository,
            llmSessions,
            config,
            onChatDelta: options.onChatDelta,
            log
        })

        // 앱이 중간에 꺼져 "실행 중"으로 남은 실행 기록을 실패로 정리
        this.pipelineService.failStaleRuns()
    }

    // 바뀐 API 키 반영 (키를 지웠으면 LLM을 쓰지 않는 상태로)
    setApiKey(apiKey: string | null): void {
        this.llmSessions.setApiKey(apiKey)
    }

    // 브리핑 생성 (수집 · 선별 · 요약 · 게시)
    runPipeline({ reason }: WorkerParams<'runPipeline'>) {
        return this.pipelineService.runPipeline(reason)
    }

    // 낮 동안 수집만 (LLM 없음)
    collectOnly() {
        return this.collectService.collectOnly()
    }

    // 저장한 기사 보강 (본문 보관 + 태그 추천)
    enrichItem({ itemId }: WorkerParams<'enrichItem'>) {
        return this.enrichmentService.enrichItem(itemId)
    }

    // 본문 번역
    translateItem({ itemId }: WorkerParams<'translateItem'>) {
        return this.translationService.translateItem(itemId)
    }

    // 질문에 대한 답변 생성 (조각은 onChatDelta 알림으로 보냄)
    answerQuestion(answerRequest: WorkerParams<'answerQuestion'>) {
        return this.chatAnswerService.answerQuestion(answerRequest)
    }

    // DB 닫기
    close(): void {
        closeDatabase(this.database)
    }
}
