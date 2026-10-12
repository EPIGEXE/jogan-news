// ============================================================================
// 번역 서비스
//
// [역할]
// - 기사 본문을 문단 단위로 한국어로 옮겨 보관 (DESIGN.md 13.5절)
// - 번역하지 않는 기사: 한국어 기사, 이미 번역한 기사, 본문이 빈 기사
// - 본문이 아직 없으면 먼저 확보 (원문에서 추출하거나 수집한 글로 대신)
// - 요청받은 번역은 기사마다 한 번에 하나만 (같은 기사를 번역하는 중이면 진행 중인 번역의 결과를 돌려줌)
// - API 키가 없거나 오늘 사용액이 하루 상한에 닿았으면 번역하지 않음
// - 이번 달 사용액이 월 예산에 도달했으면 절약 모드 모델로 번역
// - 요청받은 번역이 실패하면 로그만 남기고 "번역하지 않음"으로 끝냄 (번역은 보관되지 않아 나중에 다시 시도)
// - 번역을 보관하면 검색 색인 갱신 (번역문도 검색됨)
// ============================================================================
import { modelSpecForRole, type AppConfig } from '@config/index'
import { summarizeUsage } from '@domain/usage'
import { runInTransaction, type AppDatabase } from '@data/client'
import type { ContentRow, ItemRepository, ItemRow } from '@data/repositories/item-repository'
import type { LlmUsageRepository } from '@data/repositories/llm-usage-repository'
import type { SearchRepository } from '@data/repositories/search-repository'
import type { SettingsRepository } from '@data/repositories/settings-repository'
import { needsTranslation } from '@domain/translation'
import { translateParagraphs } from '../knowledge/translate'
import type { LlmCaller, LlmSessionSource } from '../llm/service'
import type { WorkerLog } from '../log'

export interface TranslationDeps {
    database: AppDatabase // 여러 쓰기를 한 묶음으로 묶을 때만 사용
    itemRepository: ItemRepository // 기사 · 보관된 본문과 번역
    llmUsageRepository: LlmUsageRepository // 오늘 · 이번 달 사용액 확인
    settingsRepository: SettingsRepository // 하루 상한 · 월 예산 읽기
    searchRepository: SearchRepository // 번역을 보관한 기사의 검색 색인 갱신
    llmSessions: LlmSessionSource // 번역에 쓸 LLM 세션 (API 키가 없으면 번역하지 않음)
    config: AppConfig // 프롬프트 · 모델 설정
    // 기사 본문 확보 (없으면 추출해서 보관)
    ensureContent(itemRow: Pick<ItemRow, 'id' | 'url' | 'kind' | 'title' | 'snippet' | 'sourceName'>): Promise<ContentRow>
    log: WorkerLog // 로그 남기기
}

/**
 * 기사 본문을 번역해 보관하는 서비스
 */
export class TranslationService {
    private readonly translationsInProgress = new Map<number, Promise<boolean>>() // 기사 번호별 진행 중인 번역 (같은 기사를 두 번 번역하지 않게)

    constructor(private readonly deps: TranslationDeps) {}

    /**
     * 기사 본문 번역 요청 (읽기 화면에서 번역이 없을 때, 저장 후 보강 뒤)
     *
     * - 하루 상한에 닿았거나 키가 없으면 하지 않음
     * - 같은 기사를 번역하는 중이면 새로 시작하지 않고 진행 중인 번역의 결과를 돌려줌
     * - 실패해도 예외를 던지지 않음
     *
     * @param {number} itemId - 번역할 기사 번호
     * @returns {Promise<boolean>} 번역을 새로 만들었으면 true (하지 않았거나 실패하면 false)
     */
    translateItem(itemId: number): Promise<boolean> {
        const { llmUsageRepository, settingsRepository, llmSessions, log } = this.deps

        // 이 기사를 이미 번역하는 중이면 그 번역을 그대로 돌려줌
        const pendingTranslation = this.translationsInProgress.get(itemId)
        if (pendingTranslation) return pendingTranslation

        // API 키가 없거나 오늘 사용액이 하루 상한에 닿았으면 번역하지 않음
        // 브리핑 생성 밖의 호출이라 실행 번호 없이 사용량 기록
        const usageSummary = summarizeUsage(llmUsageRepository, settingsRepository)
        const llmSession = llmSessions.openSession(null)
        if (!llmSession || usageSummary.todayUsd >= usageSummary.dailyCapUsd) return Promise.resolve(false)

        // 번역 시작 (절약 모드면 절약 모드 모델)
        const translationJob = this.translateWithSession(llmSession, itemId, usageSummary.saveMode)
            .catch((translateError: unknown) => {
                // 실패 → 로그만 남기고 "번역하지 않음"으로 끝냄 (호출한 쪽에 오류를 던지지 않음)
                log('warn', `번역 실패: ${(translateError as Error).message}`)
                return false
            })
            .finally(() => {
                // 성공 · 실패 모두 진행 중 목록에서 뺌
                this.translationsInProgress.delete(itemId)
            })

        // 끝날 때까지 진행 중 목록에 올려 둠
        this.translationsInProgress.set(itemId, translationJob)
        return translationJob
    }

    /**
     * 주어진 LLM 세션으로 기사 한 건의 본문을 번역해 보관
     *
     * - 브리핑 생성이 자기 실행의 세션으로 부름 (사용량이 그 실행에 기록됨, 한도 확인은 부르는 쪽이 이미 함)
     * - 한국어 기사이거나 이미 번역했으면 아무것도 하지 않음
     * - 본문이 아직 없으면 먼저 확보
     *
     * @param {LlmCaller} llmSession - LLM 호출 세션
     * @param {number} itemId - 기사 번호
     * @param {boolean} saveMode - 절약 모드 여부 (켜져 있으면 절약 모드 모델로 번역)
     * @returns {Promise<boolean>} 번역을 새로 보관했으면 true
     * @throws 번역 요청이 끝내 실패하면 오류 (번역은 보관되지 않음)
     */
    async translateWithSession(llmSession: LlmCaller, itemId: number, saveMode: boolean): Promise<boolean> {
        const { database, itemRepository, searchRepository, config } = this.deps

        // 기사가 없거나 한국어 기사면 번역하지 않음
        const itemRow = itemRepository.findItemById(itemId)
        if (!itemRow || !needsTranslation(itemRow)) return false

        // 본문 확보 (없으면 추출해서 보관)
        // 이미 번역이 있거나 본문이 비었으면 할 일 없음
        const contentRow = await this.deps.ensureContent(itemRow)
        if (contentRow.paragraphsKo || contentRow.paragraphs.length === 0) return false

        // 번역 역할의 모델로 문단별 번역 (절약 모드면 절약 모드 모델)
        const modelSpec = modelSpecForRole(config.models, 'translate', saveMode)
        const paragraphsKo = await translateParagraphs(llmSession, modelSpec, config.prompts.translate, {
            title: itemRow.title,
            sourceName: itemRow.sourceName,
            paragraphs: contentRow.paragraphs
        })

        // 번역과 번역에 쓴 모델 이름 보관, 검색 색인 갱신
        runInTransaction(database, () => {
            itemRepository.updateContentTranslation(itemId, paragraphsKo, modelSpec.model)
            searchRepository.reindexItem(itemId)
        })
        return true
    }
}
