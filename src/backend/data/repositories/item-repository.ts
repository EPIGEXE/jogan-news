// ============================================================================
// 기사 저장소
//
// [역할]
// - items(수집한 글) · contents(기사 본문과 번역) 테이블을 읽고 씀
// - 두 테이블 모두 Worker가 쓰는 테이블 (Main은 읽기만)
// - 수집한 글 찾기 · 넣기 · 고치기, 브리핑 후보 조회, 선별 · 요약 · 본문 · 번역 결과 저장
// - 화면용 기사 조회: 기사 행에 읽음 · 저장 · 메모 · 태그 · 실린 브리핑 날짜 · 후속 소식 정보를 붙여 돌려줌
//   (다른 테이블은 읽기만, 기사 수와 상관없이 정해진 몇 번의 쿼리로 조회)
// - 하지 않는 일: "같은 글" 판정, 대표 값 고르기(참여도 · 소개 글 · 출처 목록 합치기), 번역이 필요한지 판단,
//   검색 색인 갱신, 트랜잭션 묶기 (모두 서비스가 함)
// ============================================================================
import { and, asc, eq, gte, inArray, isNull, max, ne, notExists } from 'drizzle-orm'
import type { Category, DigestEntryDTO, HighlightDTO, ItemDetailDTO, SourceRef } from '@shared/types'
import { nowIso, type AppDatabase } from '../client'
import { contents, digestEntries, digests, highlights, itemTags, items, notes, reads, saves, tags } from '../schema'

export type ItemRow = typeof items.$inferSelect // items 테이블의 한 행
export type ContentRow = typeof contents.$inferSelect // contents 테이블의 한 행

// 새로 넣을 글 (수집기가 넘긴 값과 정규화한 주소 · 제목)
export type NewItem = Pick<
    typeof items.$inferInsert,
    | 'urlKey'
    | 'url'
    | 'sourceId'
    | 'sourceName'
    | 'kind'
    | 'title'
    | 'titleNorm'
    | 'snippet'
    | 'lang'
    | 'publishedAt'
    | 'engagement'
    | 'engagementLabel'
> & {
    collectedAt?: string // 수집한 시각 (넘기지 않으면 지금)
}

// 같은 소식을 합친 뒤 대표 글에 쓸 값
export interface MergedSourceValues {
    otherSources: SourceRef[] // 합친 뒤의 다른 출처 목록
    engagement: number // 대표 참여도
    engagementLabel: string | null // 대표 참여도의 표시 문구
    snippet?: string // 대표 소개 글 (넘기지 않으면 지금 값을 그대로 둠)
}

// AI 선별 결과
export interface TriageValues {
    category: Category // 분류
    relevance: number // 관련도
    importance: number // 중요도
}

// 한국어 요약 결과
export interface SummaryValues {
    titleKo: string // 한국어 제목
    summaryKo: string // 한국어 요약
    keyPoints: string[] // 핵심 포인트
    whyKo: string // 왜 중요한가
}

// 브리핑 기사 · 검색 결과 · 기사 상세가 함께 쓰는 화면용 공통 항목 (순위 · 섹션 · "왜 중요한가"는 브리핑마다 달라 빠짐)
export type ItemEntryBase = Omit<DigestEntryDTO, 'rank' | 'section' | 'whyItMatters'>

// 화면용으로 읽은 기사 한 건
export interface ItemView {
    itemRow: ItemRow // 기사 행 그대로 (whyKo · lang · snippet 등 서비스가 규칙에 쓰는 값)
    entryBase: ItemEntryBase // 화면용 공통 항목
    savedAt: string | null // 저장한 시각 (저장하지 않았으면 null)
    digestDate: string | null // 가장 최근에 실린 브리핑 날짜 (실린 적 없으면 null)
}

// 기사 상세 (번역 상태는 서비스가 정해서 붙임)
export interface ItemDetailRecord {
    itemRow: ItemRow // 기사 행 그대로 (번역이 필요한지 판단할 때 lang · title · snippet을 씀)
    itemDetail: Omit<ItemDetailDTO, 'translation'> // 번역 상태를 뺀 기사 상세
}

export interface ItemRepository {
    findItemById(itemId: number): ItemRow | null // 기사 한 행 (없으면 null)
    findItemByUrlKey(urlKey: string): ItemRow | null // 정규화한 주소가 같은 글 (없으면 null)
    // 정규화한 제목이 같고 sinceIso 이후(그 시각 포함)에 수집한 글 한 건 (없으면 null)
    findRecentItemByNormalizedTitle(normalizedTitle: string, sinceIso: string): ItemRow | null
    listItemsByIds(itemIds: number[]): ItemRow[] // 번호로 여러 행 조회 (없는 번호는 빠짐, 순서는 정해져 있지 않음)
    // 브리핑 후보: sinceIso 이후(그 시각 포함)에 수집했고, 다른 글에 합쳐지지 않았고, todayDate가 아닌 날의 브리핑에 실린 적 없는 글
    listBriefingCandidates(sinceIso: string, todayDate: string): ItemRow[]
    insertItem(newItem: NewItem): number // 새 글 넣기 → 새 기사 번호
    updateItemEngagement(itemId: number, engagement: number, engagementLabel: string | null): void // 참여도와 표시 문구 교체
    updateItemSnippet(itemId: number, snippet: string): void // 소개 글 교체
    // 다른 출처 목록 · 대표 참여도(· 소개 글) 교체
    updateItemMergedSources(itemId: number, mergedSourceValues: MergedSourceValues): void
    // 여러 글을 대표 글에 합쳐졌다고 표시 (다음 후보에서 빠짐) → 표시한 개수
    updateItemsMergedInto(memberItemIds: number[], representativeItemId: number): number
    updateItemFollowUpOf(itemId: number, previousItemId: number): void // 지난 브리핑 기사의 후속 소식으로 표시
    updateItemTriage(itemId: number, triageValues: TriageValues, triagedAt?: string): void // 선별 결과와 선별한 시각 저장
    // 요약 결과 · 요약 모델 · 요약한 시각 저장
    updateItemSummary(itemId: number, summaryValues: SummaryValues, summaryModel: string, summarizedAt?: string): void

    findContentByItemId(itemId: number): ContentRow | null // 보관된 본문과 번역 (없으면 null)
    // 본문 넣기 (이미 있으면 새 본문으로 교체하고 번역 · 번역 시각 · 번역 모델을 비움)
    upsertContent(itemId: number, paragraphs: string[], fullText: boolean, extractedAt?: string): void
    // 문단별 번역 · 번역 모델 · 번역한 시각 저장 (보관된 본문이 없으면 아무것도 바뀌지 않음) → 바뀐 행 수
    updateContentTranslation(itemId: number, paragraphsKo: (string | null)[], translateModel: string, translatedAt?: string): number

    // 화면용 기사 여러 건 (넘긴 번호 순서대로, 없는 번호는 빠짐)
    listItemViews(itemIds: number[]): ItemView[]
    // 기사 상세: 화면용 공통 항목 + 본문 문단 · 문단별 번역 · 하이라이트 (없는 기사면 null)
    findItemDetail(itemId: number): ItemDetailRecord | null
}

/**
 * 화면용 기사 여러 건 조회
 *
 * - 기사 수와 상관없이 쿼리 4번 (기사 · 태그 · 지난 기사 제목 · 실린 날짜)
 * - 아직 선별 · 요약하지 않은 기사는 분류 'other', 원래 제목, 소개 글 앞 300자로 채움
 *
 * @param {AppDatabase} database - DB 연결
 * @param {number[]} itemIds - 기사 번호들
 * @returns {ItemView[]} 넘긴 번호 순서대로 (없는 번호는 빠짐)
 */
function readItemViews(database: AppDatabase, itemIds: number[]): ItemView[] {
    if (itemIds.length === 0) return []

    // 기사 행과 읽은 시각 · 저장한 시각 · 메모 (읽음 · 저장 · 메모가 없어도 기사는 조회됨)
    const itemStateRows = database
        .select({ itemRow: items, readAt: reads.readAt, savedAt: saves.savedAt, memo: notes.body })
        .from(items)
        .leftJoin(reads, eq(reads.itemId, items.id))
        .leftJoin(saves, eq(saves.itemId, items.id))
        .leftJoin(notes, eq(notes.itemId, items.id))
        .where(inArray(items.id, itemIds))
        .all()
    if (itemStateRows.length === 0) return []

    // 기사마다 붙은 태그 이름
    const tagRows = database
        .select({ itemId: itemTags.itemId, tagName: tags.name })
        .from(itemTags)
        .innerJoin(tags, eq(tags.id, itemTags.tagId))
        .where(inArray(itemTags.itemId, itemIds))
        .all()
    const tagNamesByItemId = new Map<number, string[]>()
    for (const tagRow of tagRows) {
        const tagNamesOfItem = tagNamesByItemId.get(tagRow.itemId) ?? []
        tagNamesOfItem.push(tagRow.tagName)
        tagNamesByItemId.set(tagRow.itemId, tagNamesOfItem)
    }

    // 후속 소식인 기사가 가리키는 지난 기사의 제목 (한국어 제목이 없으면 원래 제목)
    const previousItemIds = [
        ...new Set(itemStateRows.map((itemStateRow) => itemStateRow.itemRow.followUpOf).filter((previousItemId) => previousItemId !== null))
    ]
    const previousTitleByItemId = new Map<number, string>()
    if (previousItemIds.length > 0) {
        const previousItemRows = database
            .select({ itemId: items.id, title: items.title, titleKo: items.titleKo })
            .from(items)
            .where(inArray(items.id, previousItemIds))
            .all()
        for (const previousItemRow of previousItemRows) {
            previousTitleByItemId.set(previousItemRow.itemId, previousItemRow.titleKo ?? previousItemRow.title)
        }
    }

    // 기사와 지난 기사가 가장 최근에 실린 브리핑 날짜
    const latestDigestDateRows = database
        .select({ itemId: digestEntries.itemId, latestDigestDate: max(digests.date) })
        .from(digestEntries)
        .innerJoin(digests, eq(digests.id, digestEntries.digestId))
        .where(inArray(digestEntries.itemId, [...itemIds, ...previousItemIds]))
        .groupBy(digestEntries.itemId)
        .all()
    const latestDigestDateByItemId = new Map(
        latestDigestDateRows.map((latestDigestDateRow) => [latestDigestDateRow.itemId, latestDigestDateRow.latestDigestDate])
    )

    // 화면용 모양으로 조립
    const itemViewById = new Map<number, ItemView>()
    for (const { itemRow, readAt, savedAt, memo } of itemStateRows) {
        const previousItemTitle = itemRow.followUpOf === null ? undefined : previousTitleByItemId.get(itemRow.followUpOf)
        itemViewById.set(itemRow.id, {
            itemRow,
            entryBase: {
                itemId: itemRow.id,
                category: (itemRow.triageCategory ?? 'other') as Category,
                titleKo: itemRow.titleKo ?? itemRow.title,
                originalTitle: itemRow.title,
                summaryKo: itemRow.summaryKo ?? itemRow.snippet.slice(0, 300),
                keyPoints: itemRow.keyPoints ?? [],
                url: itemRow.url,
                sourceName: itemRow.sourceName,
                engagementLabel: itemRow.engagementLabel,
                otherSources: itemRow.otherSources,
                publishedAt: itemRow.publishedAt,
                isRead: readAt !== null,
                isSaved: savedAt !== null,
                memo: memo ?? '',
                tags: (tagNamesByItemId.get(itemRow.id) ?? []).sort((leftTagName, rightTagName) => leftTagName.localeCompare(rightTagName)),
                // 후속 소식 표시는 지난 기사의 제목을 찾았을 때만
                followUpOf:
                    itemRow.followUpOf !== null && previousItemTitle !== undefined
                        ? {
                              itemId: itemRow.followUpOf,
                              titleKo: previousItemTitle,
                              digestDate: latestDigestDateByItemId.get(itemRow.followUpOf) ?? null
                          }
                        : null
            },
            savedAt,
            digestDate: latestDigestDateByItemId.get(itemRow.id) ?? null
        })
    }

    // 넘긴 번호 순서대로 (없는 번호는 빠짐)
    return itemIds.map((itemId) => itemViewById.get(itemId)).filter((itemView) => itemView !== undefined)
}

/**
 * 기사 저장소 생성
 *
 * @param {AppDatabase} database - DB 연결
 * @returns {ItemRepository} 기사 저장소
 */
export function createItemRepository(database: AppDatabase): ItemRepository {
    return {
        findItemById(itemId) {
            return database.select().from(items).where(eq(items.id, itemId)).get() ?? null
        },

        findItemByUrlKey(urlKey) {
            return database.select().from(items).where(eq(items.urlKey, urlKey)).get() ?? null
        },

        findRecentItemByNormalizedTitle(normalizedTitle, sinceIso) {
            return (
                database
                    .select()
                    .from(items)
                    .where(and(eq(items.titleNorm, normalizedTitle), gte(items.collectedAt, sinceIso)))
                    .get() ?? null
            )
        },

        listItemsByIds(itemIds) {
            if (itemIds.length === 0) return []
            return database.select().from(items).where(inArray(items.id, itemIds)).all()
        },

        listBriefingCandidates(sinceIso, todayDate) {
            // 이 글이 오늘이 아닌 날의 브리핑에 실린 기록
            // 오늘 브리핑에 실린 글은 후보에 남김 (같은 날 다시 만들면 내용을 바꿔 끼우므로)
            const publishedOnOtherDay = database
                .select({ itemId: digestEntries.itemId })
                .from(digestEntries)
                .innerJoin(digests, eq(digests.id, digestEntries.digestId))
                .where(and(eq(digestEntries.itemId, items.id), ne(digests.date, todayDate)))

            return database
                .select()
                .from(items)
                .where(and(gte(items.collectedAt, sinceIso), isNull(items.mergedInto), notExists(publishedOnOtherDay)))
                .all()
        },

        insertItem(newItem) {
            const insertedItem = database
                .insert(items)
                .values({ ...newItem, collectedAt: newItem.collectedAt ?? nowIso() })
                .returning({ itemId: items.id })
                .get()
            return insertedItem.itemId
        },

        updateItemEngagement(itemId, engagement, engagementLabel) {
            database.update(items).set({ engagement, engagementLabel }).where(eq(items.id, itemId)).run()
        },

        updateItemSnippet(itemId, snippet) {
            database.update(items).set({ snippet }).where(eq(items.id, itemId)).run()
        },

        updateItemMergedSources(itemId, mergedSourceValues) {
            // snippet을 넘기지 않으면(undefined) 그 컬럼은 건드리지 않음
            database
                .update(items)
                .set({
                    otherSources: mergedSourceValues.otherSources,
                    engagement: mergedSourceValues.engagement,
                    engagementLabel: mergedSourceValues.engagementLabel,
                    snippet: mergedSourceValues.snippet
                })
                .where(eq(items.id, itemId))
                .run()
        },

        updateItemsMergedInto(memberItemIds, representativeItemId) {
            if (memberItemIds.length === 0) return 0
            return database.update(items).set({ mergedInto: representativeItemId }).where(inArray(items.id, memberItemIds)).run().changes
        },

        updateItemFollowUpOf(itemId, previousItemId) {
            database.update(items).set({ followUpOf: previousItemId }).where(eq(items.id, itemId)).run()
        },

        updateItemTriage(itemId, triageValues, triagedAt) {
            database
                .update(items)
                .set({
                    triageCategory: triageValues.category,
                    triageRelevance: triageValues.relevance,
                    triageImportance: triageValues.importance,
                    triagedAt: triagedAt ?? nowIso()
                })
                .where(eq(items.id, itemId))
                .run()
        },

        updateItemSummary(itemId, summaryValues, summaryModel, summarizedAt) {
            database
                .update(items)
                .set({
                    titleKo: summaryValues.titleKo,
                    summaryKo: summaryValues.summaryKo,
                    keyPoints: summaryValues.keyPoints,
                    whyKo: summaryValues.whyKo,
                    summaryModel,
                    summarizedAt: summarizedAt ?? nowIso()
                })
                .where(eq(items.id, itemId))
                .run()
        },

        findContentByItemId(itemId) {
            return database.select().from(contents).where(eq(contents.itemId, itemId)).get() ?? null
        },

        upsertContent(itemId, paragraphs, fullText, extractedAt) {
            const extractedAtIso = extractedAt ?? nowIso()
            database
                .insert(contents)
                .values({ itemId, paragraphs, fullText, extractedAt: extractedAtIso })
                .onConflictDoUpdate({
                    target: contents.itemId,
                    // 본문이 바뀌면 이전 번역은 문단이 맞지 않으므로 비움
                    set: { paragraphs, fullText, extractedAt: extractedAtIso, paragraphsKo: null, translatedAt: null, translateModel: null }
                })
                .run()
        },

        updateContentTranslation(itemId, paragraphsKo, translateModel, translatedAt) {
            return database
                .update(contents)
                .set({ paragraphsKo, translatedAt: translatedAt ?? nowIso(), translateModel })
                .where(eq(contents.itemId, itemId))
                .run().changes
        },

        listItemViews(itemIds) {
            return readItemViews(database, itemIds)
        },

        findItemDetail(itemId) {
            // 기사 한 건을 화면용 공통 항목으로 조회
            const itemView = readItemViews(database, [itemId])[0]
            if (!itemView) return null

            // 보관된 본문 (없을 수 있음)
            const contentRow = database.select().from(contents).where(eq(contents.itemId, itemId)).get()

            // 이 기사에 그은 하이라이트 (문단 · 시작 위치 순)
            const highlightRows = database
                .select()
                .from(highlights)
                .where(eq(highlights.itemId, itemId))
                .orderBy(asc(highlights.paragraph), asc(highlights.startOffset))
                .all()

            const { itemRow, entryBase, savedAt, digestDate } = itemView
            return {
                itemRow,
                itemDetail: {
                    ...entryBase,
                    whyItMatters: itemRow.whyKo,
                    savedAt,
                    digestDate,
                    // 보관된 본문이 없으면 수집할 때 받은 소개 글을 문단 하나로
                    paragraphs: contentRow?.paragraphs ?? (itemRow.snippet ? [itemRow.snippet] : []),
                    hasFullText: contentRow?.fullText ?? false,
                    paragraphsKo: contentRow?.paragraphsKo ?? null,
                    highlights: highlightRows.map((highlightRow) => ({
                        id: highlightRow.id,
                        paragraph: highlightRow.paragraph,
                        variant: highlightRow.variant as HighlightDTO['variant'],
                        start: highlightRow.startOffset,
                        end: highlightRow.endOffset,
                        text: highlightRow.text,
                        note: highlightRow.note,
                        createdAt: highlightRow.createdAt
                    }))
                }
            }
        }
    }
}
