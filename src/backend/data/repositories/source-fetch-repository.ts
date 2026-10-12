// ============================================================================
// 출처 수집 기록 저장소
//
// [역할]
// - 출처 하나를 한 번 수집한 기록(source_fetches)을 쓰고 지움 (Worker가 쓰는 테이블)
// - 출처 페이지 통계의 집계 쿼리 제공: 출처별 단계 개수, 최근 수집 기록, 실패 횟수, 최근 실린 기사, 날짜별 수집 · 실린 글 수
// - 집계는 items · digests · digest_entries · saves를 읽기만 함
// - 집계 결과는 출처 ID가 붙은 행 목록 그대로 돌려줌 (출처별로 묶기, 빈 날 0으로 채우기, 합계, 설정의 출처 설명 붙이기는 서비스)
// - 보관 기간 · 통계 기간의 시작 시각 계산은 하지 않음 (서비스가 시각 · 날짜로 넘김)
// ============================================================================
import { asc, count, desc, eq, gte, inArray, isNotNull, lt, lte, and, sql } from 'drizzle-orm'
import type { FunnelCounts, SourceFetchDTO } from '@shared/types'
import type { AppDatabase } from '../client'
import { digestEntries, digests, items, saves, sourceFetches } from '../schema'

export type SourceFetchRow = typeof sourceFetches.$inferSelect // source_fetches 테이블의 한 행

// 기록할 수집 한 번
export interface SourceFetchInput {
    sourceId: string // 출처 ID
    at: string // 수집한 시각
    reason: 'briefing' | 'collect' // briefing: 브리핑 생성, collect: 미리 수집
    ok: boolean // 수집에 성공했는지
    fetched: number // 받은 글 수
    newItems: number // 그중 처음 본 글 수
    error: string | null // 실패 이유 (없으면 null)
}

// 출처 하나의 단계별 개수
export interface SourceFunnelCounts extends FunnelCounts {
    sourceId: string // 출처 ID (설정에서 빠진 옛 출처도 나옴)
}

// 출처 하나의 수집 기록 한 건
export interface SourceFetchRecord extends SourceFetchDTO {
    sourceId: string // 출처 ID
}

// 출처 하나의 수집 실패 횟수
export interface SourceFailureCount {
    sourceId: string // 출처 ID
    failureCount: number // 실패한 수집 횟수 (실패가 없는 출처는 행이 없음)
}

// 출처 하나에서 수집해 브리핑에 실린 기사 한 건
export interface SourcePublishedItem {
    sourceId: string // 그 기사를 처음 수집한 출처 ID
    itemId: number // 기사 번호
    titleKo: string // 한국어 제목 (없으면 원래 제목)
    digestDate: string // 실린 브리핑 날짜 'YYYY-MM-DD'
}

// 하루의 개수
export interface DayCount {
    date: string // 날짜 'YYYY-MM-DD'
    count: number // 그날의 개수 (0인 날은 행이 없음)
}

export interface SourceFetchRepository {
    insertSourceFetch(sourceFetch: SourceFetchInput): void // 수집 한 번의 결과 기록
    deleteSourceFetchesBefore(beforeIso: string): number // beforeIso보다 먼저 수집한 기록 삭제 → 지운 개수
    // 출처마다 최근 수집 기록을 limitPerSource건까지 (출처 ID순, 같은 출처는 최근 것부터)
    listRecentFetchesPerSource(limitPerSource: number): SourceFetchRecord[]
    countFailuresBySource(sinceIso: string | null): SourceFailureCount[] // sinceIso 이후의 출처별 수집 실패 횟수 (null이면 전체 기간)
    // sinceIso 이후에 수집한 글의 출처별 단계 개수: 수집 · 합쳐짐 · 선별 · 브리핑에 실림 · 저장 (null이면 전체 기간)
    // 실림 · 저장 여부는 수집 시각과 무관하게 지금 기준 (그 글이 언제든 실렸거나 지금 저장돼 있으면 셈)
    listFunnelCountsBySource(sinceIso: string | null): SourceFunnelCounts[]
    // 출처마다 최근 브리핑에 실린 기사를 limitPerSource건까지 (출처 ID순, 같은 출처는 최근 날짜 · 순위 순)
    listRecentPublishedPerSource(limitPerSource: number): SourcePublishedItem[]
    listCollectedCountsByDay(fromDate: string): DayCount[] // fromDate 이후 날짜별 수집한 글 수 (수집 시각을 로컬 날짜로 바꿔서 셈)
    listPublishedCountsByDay(fromDate: string): DayCount[] // fromDate 이후 브리핑 날짜별 실린 글 수
}

/**
 * 출처 수집 기록 저장소 생성
 *
 * @param {AppDatabase} database - DB 연결
 * @returns {SourceFetchRepository} 출처 수집 기록 저장소
 */
export function createSourceFetchRepository(database: AppDatabase): SourceFetchRepository {
    return {
        insertSourceFetch(sourceFetch) {
            database
                .insert(sourceFetches)
                .values({
                    sourceId: sourceFetch.sourceId,
                    at: sourceFetch.at,
                    reason: sourceFetch.reason,
                    ok: sourceFetch.ok,
                    fetched: sourceFetch.fetched,
                    newItems: sourceFetch.newItems,
                    error: sourceFetch.error
                })
                .run()
        },

        deleteSourceFetchesBefore(beforeIso) {
            return database.delete(sourceFetches).where(lt(sourceFetches.at, beforeIso)).run().changes
        },

        listRecentFetchesPerSource(limitPerSource) {
            // 출처 안에서 최근 것부터 순번을 매김 (1이 가장 최근)
            const rankedFetches = database
                .select({
                    sourceId: sourceFetches.sourceId,
                    at: sourceFetches.at,
                    reason: sourceFetches.reason,
                    ok: sourceFetches.ok,
                    fetched: sourceFetches.fetched,
                    newItems: sourceFetches.newItems,
                    error: sourceFetches.error,
                    recencyRank:
                        sql<number>`row_number() over (partition by ${sourceFetches.sourceId} order by ${sourceFetches.at} desc)`.as(
                            'recency_rank'
                        )
                })
                .from(sourceFetches)
                .as('ranked_fetches')

            // 순번이 limitPerSource 이하인 기록만 남김
            const recentFetchRows = database
                .select()
                .from(rankedFetches)
                .where(lte(rankedFetches.recencyRank, limitPerSource))
                .orderBy(asc(rankedFetches.sourceId), desc(rankedFetches.at))
                .all()

            return recentFetchRows.map((recentFetchRow) => ({
                sourceId: recentFetchRow.sourceId,
                fetchedAt: recentFetchRow.at,
                reason: recentFetchRow.reason as SourceFetchDTO['reason'],
                ok: recentFetchRow.ok,
                fetchedCount: recentFetchRow.fetched,
                newItems: recentFetchRow.newItems,
                error: recentFetchRow.error
            }))
        },

        countFailuresBySource(sinceIso) {
            return database
                .select({ sourceId: sourceFetches.sourceId, failureCount: count() })
                .from(sourceFetches)
                .where(and(eq(sourceFetches.ok, false), sinceIso === null ? undefined : gte(sourceFetches.at, sinceIso)))
                .groupBy(sourceFetches.sourceId)
                .all()
        },

        listFunnelCountsBySource(sinceIso) {
            const publishedItemIds = database.select({ itemId: digestEntries.itemId }).from(digestEntries) // 브리핑에 한 번이라도 실린 기사
            const savedItemIds = database.select({ itemId: saves.itemId }).from(saves) // 지금 저장돼 있는 기사

            // 출처마다 수집한 글 수와, 그중 조건에 맞는 글 수 (조건식은 맞으면 1 · 아니면 0이라 더하면 개수)
            return database
                .select({
                    sourceId: items.sourceId,
                    collected: count(),
                    merged: sql<number>`sum(${isNotNull(items.mergedInto)})`,
                    triaged: sql<number>`sum(${isNotNull(items.triagedAt)})`,
                    published: sql<number>`sum(${inArray(items.id, publishedItemIds)})`,
                    saved: sql<number>`sum(${inArray(items.id, savedItemIds)})`
                })
                .from(items)
                .where(sinceIso === null ? undefined : gte(items.collectedAt, sinceIso))
                .groupBy(items.sourceId)
                .all()
        },

        listRecentPublishedPerSource(limitPerSource) {
            // 출처 안에서 최근 브리핑 날짜 · 순위 순으로 순번을 매김 (1이 가장 최근)
            const rankedPublished = database
                .select({
                    sourceId: items.sourceId,
                    itemId: items.id,
                    titleKo: sql<string>`coalesce(${items.titleKo}, ${items.title})`.as('display_title'),
                    digestDate: digests.date,
                    recencyRank:
                        sql<number>`row_number() over (partition by ${items.sourceId} order by ${digests.date} desc, ${digestEntries.rank})`.as(
                            'recency_rank'
                        )
                })
                .from(digestEntries)
                .innerJoin(digests, eq(digests.id, digestEntries.digestId))
                .innerJoin(items, eq(items.id, digestEntries.itemId))
                .as('ranked_published')

            // 순번이 limitPerSource 이하인 기사만 남김
            return database
                .select({
                    sourceId: rankedPublished.sourceId,
                    itemId: rankedPublished.itemId,
                    titleKo: rankedPublished.titleKo,
                    digestDate: rankedPublished.digestDate
                })
                .from(rankedPublished)
                .where(lte(rankedPublished.recencyRank, limitPerSource))
                .orderBy(asc(rankedPublished.sourceId), asc(rankedPublished.recencyRank))
                .all()
        },

        listCollectedCountsByDay(fromDate) {
            const collectedLocalDate = sql<string>`date(${items.collectedAt}, 'localtime')` // 수집 시각(UTC)을 이 컴퓨터의 날짜로 바꾼 값
            return database
                .select({ date: collectedLocalDate, count: count() })
                .from(items)
                .where(gte(collectedLocalDate, fromDate))
                .groupBy(collectedLocalDate)
                .all()
        },

        listPublishedCountsByDay(fromDate) {
            return database
                .select({ date: digests.date, count: count() })
                .from(digestEntries)
                .innerJoin(digests, eq(digests.id, digestEntries.digestId))
                .where(gte(digests.date, fromDate))
                .groupBy(digests.date)
                .all()
        }
    }
}
