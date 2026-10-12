// ============================================================================
// 기사 서비스
//
// [역할]
// - 읽기 화면의 기사 상세 조회 (번역 상태를 정해서 붙임), 읽음 표시, 저장 · 저장 해제, 메모, 본문 번역 요청
// - 메모 규칙: 메모를 쓰면 기사를 자동으로 저장, 빈 메모(공백뿐)는 메모 삭제, 바뀐 메모로 검색 색인 갱신
// - 번역 상태 규칙: 한국어 기사는 번역 대상이 아님 (소스 언어가 ko이거나 제목 · 소개 글의 한글이 30% 이상)
// - 저장 후 보강: 저장 · 메모 · 하이라이트로 기사가 저장되면 응답을 기다리지 않고 뒤에서 진행
//   (Worker가 본문 추출 · 태그 추천, 여기서 추천 태그를 붙이고 "보강 완료"로 표시한 뒤 화면에 알림)
// - 보강은 저장한 기사이고 아직 보강을 마치지 않았을 때만 시작 (기사마다 한 번)
// - 보강이 끝나면 본문 번역을 이어서 요청 (절약 모드면 하지 않고 읽을 때 번역)
// - 본문 추출 · 태그 추천 · 번역 자체는 Worker가 담당 (여기서는 요청하고 결과를 반영)
// ============================================================================
import { needsTranslation } from '@domain/translation'
import type { ItemDetailDTO } from '@shared/types'
import { summarizeUsage } from '@domain/usage'
import { nowIso, runInTransaction, type AppDatabase } from '@data/client'
import type { ItemRepository, ItemRow } from '@data/repositories/item-repository'
import type { LibraryRepository } from '@data/repositories/library-repository'
import type { LlmUsageRepository } from '@data/repositories/llm-usage-repository'
import type { SearchRepository } from '@data/repositories/search-repository'
import type { SettingsRepository } from '@data/repositories/settings-repository'
import type { LogFn, RendererEvents, WorkerRpc } from './ports'
import type { TagService } from './tag-service'

const MAX_AUTO_TAGS = 3 // 기사 하나에 붙이는 AI 추천 태그 수 (추천 목록의 앞에서 이만큼)

export interface ArticleServiceDeps {
    database: AppDatabase // 여러 쓰기를 한 묶음으로 실행할 때만 사용
    itemRepository: ItemRepository // 기사 상세 조회 (읽기만)
    libraryRepository: LibraryRepository // 저장 · 메모 · 읽음
    searchRepository: SearchRepository // 검색 색인 갱신
    llmUsageRepository: LlmUsageRepository // 절약 모드 판정용 사용액
    settingsRepository: SettingsRepository // 절약 모드 판정용 월 예산
    tags: TagService // 추천 태그 붙이기 (이름 정리 · 하이픈 규칙)
    worker: WorkerRpc // 본문 추출 · 태그 추천 · 번역을 하는 Worker
    events: RendererEvents // 화면으로 보내는 알림
    log: LogFn // 진단 기록
}

/**
 * 기사 한 건에 대한 조회와 사용자 동작
 */
export class ArticleService {
    constructor(private readonly deps: ArticleServiceDeps) {}

    /**
     * 기사 상세 조회 (읽기 화면용)
     *
     * - 번역 상태: 번역이 필요 없는 기사(한국어)면 'not_needed', 번역이 있으면 'done', 아직 없으면 'missing'
     *
     * @param {number} itemId - 기사 번호
     * @returns {ItemDetailDTO | null} 기사 상세 (없는 기사면 null)
     */
    getItemDetail(itemId: number): ItemDetailDTO | null {
        const itemDetailRecord = this.deps.itemRepository.findItemDetail(itemId)
        if (!itemDetailRecord) return null

        const { itemRow, itemDetail } = itemDetailRecord
        return {
            ...itemDetail,
            translation: !needsTranslation(itemRow) ? 'not_needed' : itemDetail.paragraphsKo ? 'done' : 'missing'
        }
    }

    // 읽음 표시 (이미 읽은 기사면 처음 읽은 시각을 그대로 둠)
    markRead(itemId: number): void {
        this.deps.libraryRepository.insertReadIfAbsent(itemId)
    }

    /**
     * 저장 · 저장 해제
     *
     * - 이미 저장한 기사를 다시 저장하면 처음 저장한 시각을 그대로 둠
     * - 저장했으면 본문 추출 · 태그 추천을 뒤에서 진행
     *
     * @param {number} itemId - 기사 번호
     * @param {boolean} isSaved - true면 저장, false면 저장 해제
     */
    setSaved(itemId: number, isSaved: boolean): void {
        // 저장 해제 → 저장 행만 지움 (메모 · 태그 · 하이라이트는 그대로 둠)
        if (!isSaved) {
            this.deps.libraryRepository.deleteSave(itemId)
            return
        }

        // 저장 → 저장 행을 만들고 뒤에서 보강
        this.deps.libraryRepository.insertSaveIfAbsent(itemId)
        this.enrichLater(itemId)
    }

    /**
     * 메모 저장 (DESIGN.md 6.3절)
     *
     * - 메모를 쓴 기사는 자동으로 저장 처리
     * - 빈 메모(공백뿐)는 메모를 지움 (저장은 그대로 둠)
     * - 저장 뒤 검색 색인 갱신
     *
     * @param {number} itemId - 기사 번호
     * @param {string} memoBody - 메모 내용
     * @returns {{ savedAt: string }} 메모를 저장한 시각
     */
    saveMemo(itemId: number, memoBody: string): { savedAt: string } {
        const { database, libraryRepository, searchRepository } = this.deps
        const memoSavedAt = nowIso() // 메모를 고친 시각이자, 이번에 기사가 저장되면 그 저장 시각
        const hasMemoBody = memoBody.trim() !== ''

        runInTransaction(database, () => {
            if (!hasMemoBody) {
                // 빈 메모 → 메모 삭제
                libraryRepository.deleteNote(itemId)
            } else {
                // 내용 있음 → 메모 저장 (이미 있으면 내용 · 시각 교체), 아직 저장하지 않은 기사면 저장 처리
                libraryRepository.upsertNote(itemId, memoBody, memoSavedAt)
                libraryRepository.insertSaveIfAbsent(itemId, memoSavedAt)
            }

            // 바뀐 메모로 검색 색인 갱신
            searchRepository.reindexItem(itemId)
        })

        // 메모를 쓴 기사는 저장된 상태이므로 뒤에서 보강 (이미 보강한 기사면 아무 일도 없음)
        if (hasMemoBody) this.enrichLater(itemId)
        return { savedAt: memoSavedAt }
    }

    /**
     * 기사 본문 번역 요청 (읽기 화면에서 번역이 없을 때, 저장 후 보강이 끝났을 때)
     *
     * - 번역은 Worker가 함 (API 키가 없거나 하루 상한에 닿았으면 하지 않고 false)
     * - 끝나면 결과와 상관없이 화면에 기사 변경 알림
     *
     * @param {number} itemId - 번역할 기사 번호
     * @returns {Promise<boolean>} 번역을 새로 만들었으면 true
     */
    async translateItem(itemId: number): Promise<boolean> {
        try {
            return await this.deps.worker.call('translateItem', { itemId })
        } finally {
            // 성공 · 실패 모두 화면이 기사를 다시 읽게 함 ("번역 중" 표시를 거두는 용도)
            this.deps.events.itemUpdated(itemId)
        }
    }

    /**
     * 저장한 기사의 본문 추출 · 태그 추천 · 번역을 응답을 기다리지 않고 뒤에서 시작
     *
     * - 저장한 기사가 아니거나 이미 보강을 마쳤으면 아무것도 하지 않음
     * - 실패하면 진단 기록만 남김 (저장 자체에는 영향 없음, 보강 완료로 표시하지 않아 다음 저장 · 메모 때 다시 시도)
     *
     * @param {number} itemId - 방금 저장된 기사 번호
     */
    enrichLater(itemId: number): void {
        // 보강이 아직 남은 저장 기사만 대상
        if (!this.deps.libraryRepository.existsSaveAwaitingEnrichment(itemId)) return

        void this.enrichSavedItem(itemId).catch((enrichError: unknown) =>
            this.deps.log('enrich-failed', `저장 후 처리 실패: ${(enrichError as Error).message}`)
        )
    }

    // 저장한 기사 한 건 보강: Worker의 결과(추천 태그)를 반영하고 화면에 알린 뒤 번역 요청
    private async enrichSavedItem(itemId: number): Promise<void> {
        const { database, libraryRepository, searchRepository, llmUsageRepository, settingsRepository, tags, worker, events, log } =
            this.deps

        // Worker에서 본문 추출 · 태그 추천 (태그를 추천하지 않았거나 실패했으면 빈 목록)
        const { suggestedTags } = await worker.call('enrichItem', { itemId })

        runInTransaction(database, () => {
            // 추천 태그를 앞에서 3개까지 자동 태그로 붙임 (이름 정리 · 하이픈 규칙은 태그 서비스)
            for (const suggestedTag of suggestedTags.slice(0, MAX_AUTO_TAGS)) tags.addTag(itemId, suggestedTag, 'auto')

            // 보강 완료로 표시 (다음부터는 다시 하지 않음), 새로 보관한 본문까지 검색 색인에 반영
            libraryRepository.updateSaveEnrichedAt(itemId)
            searchRepository.reindexItem(itemId)
        })

        // 화면에 기사 변경 알림 ("추천 중" 표시를 거두고 본문 · 태그를 다시 읽게 함)
        events.itemUpdated(itemId)

        // 본문을 새로 뽑았으면 번역이 비었으므로 번역 요청 (절약 모드면 읽을 때 번역)
        if (summarizeUsage(llmUsageRepository, settingsRepository).saveMode) return
        void this.translateItem(itemId).catch((translateError: unknown) =>
            log('translate-failed', `저장 후 번역 실패: ${(translateError as Error).message}`)
        )
    }
}
