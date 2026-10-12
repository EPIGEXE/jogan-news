// ============================================================================
// 수집 서비스
//
// [역할]
// - 설정의 모든 출처에서 글을 받아 기사로 쌓음 (LLM을 쓰지 않음, DESIGN.md 9절 ① · ②)
// - 출처 하나가 실패해도 나머지는 계속 진행하고, 출처마다 수집 기록(성공 여부 · 받은 수 · 새 글 수 · 오류)을 남김
// - "같은 글" 규칙: 정규화한 주소가 같거나, 최근 3일 안에 수집한 글과 정규화한 제목(12자 이상)이 같으면 같은 글
// - 같은 글이 다시 오면 새로 만들지 않음: 같은 출처면 오른 참여도 · 비어 있던 소개 글만 채우고,
//   다른 출처면 다른 출처 목록에 올리고 더 큰 참여도 · 더 긴 소개 글을 대표 값으로 고름
// - "같은 소식 합치기" 규칙: 묶인 글의 출처(그 글에 이미 합쳐져 있던 출처 포함)를 대표 글로 옮기고,
//   대표 참여도는 묶인 글 중 가장 큰 값, 나머지 글은 합쳐졌다고 표시해 다음 후보에서 빠지게 함
// - 낮 동안 미리 수집: 최근 24시간 글만 쌓음 (브리핑 생성 중이거나 이미 수집 중이면 건너뜀)
// - 90일이 지난 수집 기록 삭제
// - 처음 보는 글은 검색 색인에 올림
// ============================================================================
import type { AppConfig, SourceConfig, Interest } from '@config/index'
import { runInTransaction, type AppDatabase } from '@data/client'
import type { ItemRepository } from '@data/repositories/item-repository'
import type { SearchRepository } from '@data/repositories/search-repository'
import type { SourceFetchRepository } from '@data/repositories/source-fetch-repository'
import type { RunProgress, SourceRef } from '@shared/types'
import type { RawItem } from '../collectors/types'
import type { WorkerLog } from '../log'
import { normalizeTitle, urlKey } from '../pipeline/normalize'

const HOUR_MS = 3600 * 1000 // 1시간 (밀리초)
const DAY_MS = 24 * HOUR_MS // 하루 (밀리초)
const COLLECT_ONLY_WINDOW_HOURS = 24 // 미리 수집할 때 받는 구간 (시간). 중복은 "같은 글" 규칙으로 거르므로 넉넉하게 둠
const SAME_TITLE_WINDOW_DAYS = 3 // 제목이 같으면 같은 글로 보는 기간 (일, 수집 시각 기준)
const SAME_TITLE_MIN_CHARS = 12 // 정규화한 제목이 이보다 짧으면 제목으로 비교하지 않음 (글자 수, 짧은 제목은 우연히 겹침)
const SOURCE_FETCH_KEEP_DAYS = 90 // 출처별 수집 기록을 남겨 두는 기간 (일)
const FETCH_ERROR_MAX_CHARS = 200 // 수집 기록에 남기는 오류 글자 수 (첫 줄에서 이만큼)

// 수집 기록에 남길 계기 (briefing: 브리핑 생성, collect: 미리 수집)
export type CollectReason = 'briefing' | 'collect'

// 글 한 건을 쌓은 결과
export interface StoredItem {
    itemId: number // 기사 번호 (같은 글이 이미 있었으면 그 글의 번호)
    isNew: boolean // 새로 만들었는지 (이미 있던 글에 합쳤으면 false)
}

// 같은 소식을 합친 뒤 대표 글의 값
export interface MergedRepresentative {
    otherSourceCount: number // 합친 뒤 대표의 다른 출처 수
    engagement: number // 합친 뒤 대표 참여도
}

export interface CollectDeps {
    database: AppDatabase // 여러 쓰기를 한 묶음으로 묶을 때만 사용
    itemRepository: ItemRepository // 수집한 글 찾기 · 넣기 · 고치기
    sourceFetchRepository: SourceFetchRepository // 출처별 수집 기록
    searchRepository: SearchRepository // 새 글을 검색 색인에 올리기
    config: AppConfig // 수집할 출처 · 관심 키워드
    // 출처 하나에서 since 이후의 글 받아 오기 (네트워크, 실패하면 reject)
    collectSource(source: SourceConfig, since: Date, interests: Interest[]): Promise<RawItem[]>
    isBriefingRunning(): boolean // 지금 브리핑을 만드는 중인지 (만드는 중이면 미리 수집을 건너뜀)
    log: WorkerLog // 로그 남기기
}

/**
 * 출처에서 글을 받아 기사로 쌓는 서비스
 *
 * - 미리 수집은 한 번에 하나만
 * - 같은 글 · 같은 소식을 한 기사로 합치는 규칙을 가짐
 */
export class CollectService {
    private runningCollect: Promise<unknown> | null = null // 진행 중인 미리 수집 (없으면 null)

    constructor(private readonly deps: CollectDeps) {}

    /**
     * 낮 동안 미리 수집 (DESIGN.md 4.3절)
     *
     * - LLM은 부르지 않고 최근 24시간 글을 받아 쌓기만 함
     * - 아침 브리핑은 지난 실행 이후 쌓인 글을 후보로 쓰므로, 피드에서 금방 밀려나는 글(인기글 · 릴리스)도 놓치지 않음
     * - 브리핑을 만드는 중이거나 이미 수집 중이면 건너뜀
     *
     * @returns 새로 쌓인 글 수(collected)와 건너뛰었는지(skipped)
     */
    async collectOnly(): Promise<{ collected: number; skipped: boolean }> {
        // 브리핑 생성 중(생성이 직접 수집함)이거나 이미 수집 중이면 건너뜀
        if (this.deps.isBriefingRunning() || this.runningCollect) return { collected: 0, skipped: true }

        // 최근 24시간 글 수집 시작 (수집 기록에는 "미리 수집"으로 남김)
        const collectJob = this.collectAndStore(new Date(Date.now() - COLLECT_ONLY_WINDOW_HOURS * HOUR_MS), 'collect')
        this.runningCollect = collectJob

        try {
            // 끝나면 새로 쌓인 글 수와 실패한 출처 수를 로그로 남김
            const { collected, failedSources } = await collectJob
            this.deps.log('info', `미리 수집: 새 글 ${collected}건${failedSources.length ? `, 실패 ${failedSources.length}곳` : ''}`)
            return { collected, skipped: false }
        } finally {
            // 성공 · 실패 모두 다음 수집을 받을 수 있게 되돌림
            this.runningCollect = null
        }
    }

    /**
     * 모든 출처에서 수집해 쌓기 (① 수집 · ② 저장 · 중복 합치기)
     *
     * - 브리핑 생성과 미리 수집이 함께 사용
     * - 출처 하나가 실패해도 나머지는 계속 진행
     * - 출처마다 수집 기록(성공 여부 · 받은 수 · 새 글 수 · 오류)을 남김
     *
     * @param {Date} since - 이 시각 이후의 글만 수집
     * @param {CollectReason} reason - 수집 기록에 남길 계기
     * @param onProgress - 진행 상황을 받을 함수 (넘기지 않으면 보내지 않음)
     * @returns 새로 쌓인 글 수(collected)와 실패한 출처 목록(failedSources, "이름 (오류)" 모양)
     */
    async collectAndStore(
        since: Date,
        reason: CollectReason,
        onProgress: (runProgress: RunProgress) => void = () => {}
    ): Promise<{ collected: number; failedSources: string[] }> {
        const { database, sourceFetchRepository, config, log } = this.deps
        const failedSources: string[] = [] // 브리핑 통계에 실을 실패 출처 ("이름 (오류)")
        const fetchErrorBySourceId = new Map<string, string>() // 출처별 수집 기록에 남길 오류 (출처 페이지의 상태 · 실패 기록용)
        let finishedSourceCount = 0 // 수집이 끝난 출처 수 (진행 표시용, 실패 포함)

        // 모든 출처에서 동시에 수집 (결과 순서는 config.sources와 같음)
        onProgress({ stage: 'collect', message: '소스에서 새 글을 가져오는 중', current: 0, total: config.sources.length })
        const rawItemsBySource = await Promise.all(
            config.sources.map(async (source): Promise<RawItem[]> => {
                try {
                    return await this.deps.collectSource(source, since, config.interests)
                } catch (collectError) {
                    // 이 출처만 실패 → 빈 결과로 두고 나머지는 계속
                    // 수집 기록에는 오류의 첫 줄만 200자까지 남김
                    failedSources.push(`${source.name} (${(collectError as Error).message})`)
                    fetchErrorBySourceId.set(source.id, (collectError as Error).message.split('\n')[0]!.slice(0, FETCH_ERROR_MAX_CHARS))
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

        // 수집한 글 저장 (출처 하나의 글과 그 출처의 수집 기록을 한 묶음으로)
        onProgress({ stage: 'dedup', message: '중복을 합치는 중' })
        let collectedCount = 0 // 새로 쌓인 글 수 (이미 있던 글에 합쳐진 것은 세지 않음)
        const fetchedAt = new Date().toISOString() // 이번 수집 기록에 공통으로 남길 시각
        config.sources.forEach((source, sourceIndex) => {
            const sourceRawItems = rawItemsBySource[sourceIndex]!
            runInTransaction(database, () => {
                // 글 하나씩 저장 (같은 글이 이미 있으면 그 글에 출처 · 참여도만 합침)
                let newItemCount = 0 // 이 출처에서 새로 쌓인 글 수
                for (const rawItem of sourceRawItems) if (this.storeRawItem(rawItem).isNew) newItemCount++
                collectedCount += newItemCount

                // 이 출처의 수집 기록 남기기
                sourceFetchRepository.insertSourceFetch({
                    sourceId: source.id,
                    at: fetchedAt,
                    reason,
                    ok: !fetchErrorBySourceId.has(source.id),
                    fetched: sourceRawItems.length,
                    newItems: newItemCount,
                    error: fetchErrorBySourceId.get(source.id) ?? null
                })
            })
        })

        // 90일이 지난 수집 기록 삭제
        sourceFetchRepository.deleteSourceFetchesBefore(new Date(Date.now() - SOURCE_FETCH_KEEP_DAYS * DAY_MS).toISOString())
        return { collected: collectedCount, failedSources }
    }

    /**
     * 수집한 글 한 건 쌓기 (DESIGN.md 9절 ③)
     *
     * - 같은 글이 이미 있으면(주소가 같거나 최근 3일 안에 제목이 같음) 새로 만들지 않고 출처 목록 · 참여도만 합침
     * - 처음 보는 글이면 새 기사로 넣고 검색 색인에 올림
     *
     * @param {RawItem} rawItem - 수집기가 넘긴 글
     * @returns {StoredItem} 기사 번호와 새로 만들었는지
     */
    storeRawItem(rawItem: RawItem): StoredItem {
        const { database, itemRepository, searchRepository } = this.deps

        // 중복 판정 기준 준비 (정규화한 주소 · 정규화한 제목 · 제목을 비교할 구간의 시작)
        const rawUrlKey = urlKey(rawItem.url)
        const normalizedTitle = normalizeTitle(rawItem.title)
        const sameTitleSinceIso = new Date(Date.now() - SAME_TITLE_WINDOW_DAYS * DAY_MS).toISOString() // 제목 비교 구간의 시작 (3일 전)

        return runInTransaction(database, () => {
            // 같은 글 찾기: 정규화한 주소가 같은 글, 없으면 최근 3일 안에 수집했고 정규화한 제목이 같은 글
            // 제목 비교는 정규화한 제목이 12자 이상일 때만
            const existingItemRow =
                itemRepository.findItemByUrlKey(rawUrlKey) ??
                (normalizedTitle.length >= SAME_TITLE_MIN_CHARS
                    ? itemRepository.findRecentItemByNormalizedTitle(normalizedTitle, sameTitleSinceIso)
                    : null)

            // 처음 보는 글 → 새 기사로 넣고 검색 색인에 올림
            if (!existingItemRow) {
                const newItemId = itemRepository.insertItem({
                    urlKey: rawUrlKey,
                    url: rawItem.url,
                    sourceId: rawItem.sourceId,
                    sourceName: rawItem.sourceName,
                    kind: rawItem.kind,
                    title: rawItem.title,
                    titleNorm: normalizedTitle,
                    snippet: rawItem.snippet,
                    lang: rawItem.lang,
                    publishedAt: rawItem.publishedAt,
                    engagement: rawItem.engagement,
                    engagementLabel: rawItem.engagementLabel
                })
                searchRepository.reindexItem(newItemId)
                return { itemId: newItemId, isNew: true }
            }

            // 같은 출처에서 다시 들어온 글 → 참여도가 올랐으면 갱신, 비어 있던 소개 글은 채움
            if (existingItemRow.sourceId === rawItem.sourceId) {
                if (rawItem.engagement > existingItemRow.engagement) {
                    itemRepository.updateItemEngagement(existingItemRow.id, rawItem.engagement, rawItem.engagementLabel)
                }
                if (!existingItemRow.snippet && rawItem.snippet) {
                    itemRepository.updateItemSnippet(existingItemRow.id, rawItem.snippet)
                }
                return { itemId: existingItemRow.id, isNew: false }
            }

            // 다른 출처에서 들어온 같은 글 → 그 출처를 다른 출처 목록에 추가 (이미 있는 출처 이름이면 그대로)
            const otherSources: SourceRef[] = [...existingItemRow.otherSources]
            if (!otherSources.some((otherSource) => otherSource.sourceName === rawItem.sourceName)) {
                otherSources.push({ sourceName: rawItem.sourceName, url: rawItem.url, engagementLabel: rawItem.engagementLabel })
            }

            // 대표 참여도 · 소개 글 고르기
            // 참여도가 더 큰 출처(예: HN 점수)를 대표 참여도로 씀
            // 소개 글은 더 긴 쪽을 씀 (논문은 HF 초록이 더 길면 그것)
            const isRawItemMoreEngaged = rawItem.engagement > existingItemRow.engagement
            itemRepository.updateItemMergedSources(existingItemRow.id, {
                otherSources,
                engagement: Math.max(existingItemRow.engagement, rawItem.engagement),
                engagementLabel: isRawItemMoreEngaged ? rawItem.engagementLabel : existingItemRow.engagementLabel,
                snippet: rawItem.snippet.length > existingItemRow.snippet.length ? rawItem.snippet : existingItemRow.snippet
            })
            return { itemId: existingItemRow.id, isNew: false }
        })
    }

    /**
     * 같은 소식으로 묶인 글들을 대표 글 하나로 합침
     *
     * - 나머지 글의 출처(그 글에 이미 합쳐져 있던 출처 포함)를 대표의 다른 출처 목록으로 옮김
     * - 나머지 글은 대표에 합쳐졌다고 표시해 다음 후보에서 빠지게 함
     * - 대표 참여도는 묶인 글 중 가장 큰 값
     *
     * @param {number} representativeItemId - 대표 기사 번호
     * @param {number[]} memberItemIds - 같은 소식으로 묶인 기사 번호들 (대표가 들어 있거나 없는 번호면 건너뜀)
     * @returns {MergedRepresentative} 합친 뒤 대표의 다른 출처 수와 참여도
     * @throws 대표 기사가 없으면 오류
     */
    mergeItemsInto(representativeItemId: number, memberItemIds: number[]): MergedRepresentative {
        const { database, itemRepository } = this.deps

        return runInTransaction(database, () => {
            // 대표 글의 현재 출처 목록 · 참여도에서 시작
            const representativeRow = itemRepository.findItemById(representativeItemId)
            if (!representativeRow) throw new Error(`대표 기사(${representativeItemId})를 찾을 수 없습니다.`)
            const mergedOtherSources: SourceRef[] = [...representativeRow.otherSources] // 합친 뒤 대표의 다른 출처 목록
            let mergedEngagement = representativeRow.engagement // 묶인 글 중 가장 큰 참여도
            let mergedEngagementLabel = representativeRow.engagementLabel // 그 참여도의 표시 문구

            // 다른 출처 목록에 출처 하나 추가
            // 대표 글 자신의 출처이거나 이미 목록에 있는 출처(이름 · 주소가 같음)면 넣지 않음
            const addOtherSource = (sourceRef: SourceRef) => {
                if (sourceRef.sourceName === representativeRow.sourceName && sourceRef.url === representativeRow.url) return
                if (
                    !mergedOtherSources.some((knownRef) => knownRef.sourceName === sourceRef.sourceName && knownRef.url === sourceRef.url)
                ) {
                    mergedOtherSources.push(sourceRef)
                }
            }

            // 묶인 글마다 출처 · 참여도를 대표로 옮김
            const mergedMemberIds: number[] = [] // 대표에 합쳐졌다고 표시할 기사 번호
            for (const memberItemId of memberItemIds) {
                const memberRow = itemRepository.findItemById(memberItemId)

                // 없는 글이거나 대표 자신이면 건너뜀
                if (!memberRow || memberRow.id === representativeItemId) continue

                // 그 글의 출처와, 그 글에 이미 합쳐져 있던 다른 출처를 옮김
                addOtherSource({ sourceName: memberRow.sourceName, url: memberRow.url, engagementLabel: memberRow.engagementLabel })
                for (const memberOtherSource of memberRow.otherSources) addOtherSource(memberOtherSource)

                // 참여도가 더 크면 그 글의 참여도를 대표 참여도로
                if (memberRow.engagement > mergedEngagement) {
                    mergedEngagement = memberRow.engagement
                    mergedEngagementLabel = memberRow.engagementLabel
                }
                mergedMemberIds.push(memberRow.id)
            }

            // 나머지 글을 대표에 합쳐졌다고 표시 (다음 후보에서 빠짐)
            itemRepository.updateItemsMergedInto(mergedMemberIds, representativeItemId)

            // 대표 글에 합친 출처 목록 · 참여도 저장 (소개 글은 그대로 둠)
            itemRepository.updateItemMergedSources(representativeItemId, {
                otherSources: mergedOtherSources,
                engagement: mergedEngagement,
                engagementLabel: mergedEngagementLabel
            })
            return { otherSourceCount: mergedOtherSources.length, engagement: mergedEngagement }
        })
    }
}
