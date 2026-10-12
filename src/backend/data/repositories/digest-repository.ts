// ============================================================================
// 브리핑 저장소
//
// [역할]
// - 브리핑 한 호(digests)와 그 호에 실린 기사(digest_entries)를 읽고 씀 (Worker가 쓰는 테이블, Main은 읽기만)
// - 화면용 브리핑 조회: 실린 기사에 읽음 · 저장 · 메모 · 태그 · 후속 소식의 지난 기사를 붙여 DigestDTO로 돌려줌
// - 한 호를 읽는 쿼리 수는 실린 기사 수와 무관하게 고정 (호 · 실린 기사 · 태그 · 후속 소식의 지난 기사)
// - 브리핑 목록(실린 기사 수 · 저장한 기사 수), 날짜 구간 안에 실린 기사 조회
// - 게시에 쓰는 쓰기 조각만 제공 ("같은 날짜면 내용 교체" 판단과 트랜잭션은 서비스)
// - 아직 선별 · 요약하지 않은 기사는 분류 'other' · 원래 제목 · 소개 글 앞 300자로 채워서 돌려줌
// ============================================================================
import { asc, count, desc, eq, gte, lt, and, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { Category, DigestDTO, DigestEntryDTO, DigestStats, DigestSummaryDTO, Section } from '@shared/types'
import { nowIso, type AppDatabase } from '../client'
import { digestEntries, digests, items, itemTags, notes, reads, saves, tags } from '../schema'

export type DigestRow = typeof digests.$inferSelect // digests 테이블의 한 행
export type DigestEntryRow = typeof digestEntries.$inferSelect // digest_entries 테이블의 한 행

// 브리핑 한 호의 내용 (날짜 · 번호를 뺀, 다시 게시할 때 바뀌는 부분)
export interface DigestContent {
    headline: string // 오늘의 한 줄
    overview: string | null // 오늘의 흐름 (없으면 null)
    stats: DigestStats // 만들 때의 수치
}

// 브리핑에 실을 기사 하나
export interface DigestEntryInput {
    itemId: number // 기사 번호
    rank: number // 브리핑 안에서의 순위 (1부터)
    section: Section // 실을 섹션
    whyItMatters: string | null // 이 브리핑에 적는 "왜 중요한가" (null이면 조회할 때 기사 요약의 것을 씀)
}

// 브리핑에 실린 기사 하나의 참조 (지난 며칠 중복 확인용)
export interface PublishedItemRef {
    itemId: number // 기사 번호
    digestDate: string // 실린 브리핑 날짜 'YYYY-MM-DD'
    title: string // 한국어 제목 (없으면 원래 제목)
}

export interface DigestRepository {
    findDigestIdByDate(digestDate: string): number | null // 그 날짜 브리핑의 번호 (없으면 null)
    findLatestDigestDate(): string | null // 가장 최근 브리핑의 날짜 (브리핑이 하나도 없으면 null)
    findLatestDigest(): DigestDTO | null // 날짜가 가장 늦은 브리핑과 실린 기사 (하나도 없으면 null)
    findDigestByDate(digestDate: string): DigestDTO | null // 그 날짜의 브리핑과 실린 기사 (없으면 null)
    listDigestSummaries(): DigestSummaryDTO[] // 모든 브리핑의 날짜 · 한 줄 · 실린 기사 수 · 그중 저장한 기사 수 (최근 날짜부터)
    // fromDate 이상 beforeDate 미만 날짜의 브리핑에 실린 기사 (최근 날짜부터, 같은 날짜는 순위 순)
    listPublishedItemsBetween(fromDate: string, beforeDate: string): PublishedItemRef[]
    insertDigest(digestDate: string, digestContent: DigestContent): number // 새 호 생성 (만든 시각은 지금) → 브리핑 번호
    updateDigestContent(digestId: number, digestContent: DigestContent): void // 한 줄 · 흐름 · 수치를 바꾸고 만든 시각을 지금으로
    deleteDigestById(digestId: number): void // 호 삭제 (실린 기사도 함께 지워짐)
    insertEntries(digestId: number, entries: DigestEntryInput[]): void // 실을 기사를 한 번에 저장 (빈 목록이면 아무것도 안 함)
    deleteEntriesByDigestId(digestId: number): number // 그 호에 실린 기사 모두 삭제 → 지운 개수
}

const SUMMARY_FALLBACK_LENGTH = 300 // 요약이 없을 때 소개 글에서 잘라 쓰는 글자 수

/**
 * 브리핑 저장소 생성
 *
 * @param {AppDatabase} database - DB 연결
 * @returns {DigestRepository} 브리핑 저장소
 */
export function createDigestRepository(database: AppDatabase): DigestRepository {
    // 후속 소식 조회에서 "지난 기사" 쪽으로 한 번 더 엮는 테이블 (실린 기사 쪽과 구분)
    const previousItems = alias(items, 'previous_items')
    const previousEntries = alias(digestEntries, 'previous_entries')
    const previousDigests = alias(digests, 'previous_digests')

    // 그 호에 실린 기사의 태그 이름을 기사 번호별로 묶음 (이름순, 태그가 없는 기사는 들어 있지 않음)
    const listTagNamesByItem = (digestId: number): Map<number, string[]> => {
        const tagRows = database
            .select({ itemId: itemTags.itemId, tagName: tags.name })
            .from(digestEntries)
            .innerJoin(itemTags, eq(itemTags.itemId, digestEntries.itemId))
            .innerJoin(tags, eq(tags.id, itemTags.tagId))
            .where(eq(digestEntries.digestId, digestId))
            .all()

        const tagNamesByItem = new Map<number, string[]>()
        for (const tagRow of tagRows) {
            const tagNamesOfItem = tagNamesByItem.get(tagRow.itemId) ?? []
            tagNamesOfItem.push(tagRow.tagName)
            tagNamesByItem.set(tagRow.itemId, tagNamesOfItem)
        }
        for (const tagNamesOfItem of tagNamesByItem.values()) tagNamesOfItem.sort((leftTag, rightTag) => leftTag.localeCompare(rightTag))
        return tagNamesByItem
    }

    // 그 호에 실린 기사가 가리키는 "지난 기사"를 지난 기사 번호별로 조회
    // 제목은 한국어 제목(없으면 원래 제목), 날짜는 지난 기사가 실린 브리핑 중 가장 늦은 날짜(실린 적 없으면 null)
    const listFollowUpTargets = (digestId: number): Map<number, { title: string; digestDate: string | null }> => {
        const followUpRows = database
            .select({
                previousItemId: previousItems.id,
                title: sql<string>`coalesce(${previousItems.titleKo}, ${previousItems.title})`,
                digestDate: sql<string | null>`max(${previousDigests.date})`
            })
            .from(digestEntries)
            .innerJoin(items, eq(items.id, digestEntries.itemId))
            .innerJoin(previousItems, eq(previousItems.id, items.followUpOf))
            .leftJoin(previousEntries, eq(previousEntries.itemId, previousItems.id))
            .leftJoin(previousDigests, eq(previousDigests.id, previousEntries.digestId))
            .where(eq(digestEntries.digestId, digestId))
            .groupBy(previousItems.id)
            .all()

        return new Map(
            followUpRows.map((followUpRow) => [
                followUpRow.previousItemId,
                { title: followUpRow.title, digestDate: followUpRow.digestDate }
            ])
        )
    }

    // 브리핑 행에 실린 기사를 붙여 화면용 브리핑으로 변환 (행이 없으면 null)
    const toDigestDTO = (digestRow: DigestRow | undefined): DigestDTO | null => {
        if (!digestRow) return null

        // 그 호에 실린 기사를 순위 순으로 조회 (읽음 · 저장 · 메모는 없어도 기사는 나옴)
        const entryRows = database
            .select({
                item: items,
                rank: digestEntries.rank,
                section: digestEntries.section,
                whyItMatters: digestEntries.whyItMatters,
                readAt: reads.readAt,
                savedAt: saves.savedAt,
                memo: notes.body
            })
            .from(digestEntries)
            .innerJoin(items, eq(items.id, digestEntries.itemId))
            .leftJoin(reads, eq(reads.itemId, items.id))
            .leftJoin(saves, eq(saves.itemId, items.id))
            .leftJoin(notes, eq(notes.itemId, items.id))
            .where(eq(digestEntries.digestId, digestRow.id))
            .orderBy(asc(digestEntries.rank))
            .all()

        // 실린 기사 전체의 태그와 후속 소식의 지난 기사를 각각 한 번에 조회
        const tagNamesByItem = listTagNamesByItem(digestRow.id)
        const followUpTargets = listFollowUpTargets(digestRow.id)

        const entries: DigestEntryDTO[] = entryRows.map((entryRow) => {
            const itemRow = entryRow.item
            // 후속 소식 표시는 지난 기사를 찾았을 때만
            const followUpTarget = itemRow.followUpOf !== null ? followUpTargets.get(itemRow.followUpOf) : undefined
            return {
                itemId: itemRow.id,
                rank: entryRow.rank,
                section: entryRow.section as Section,
                category: (itemRow.triageCategory ?? 'other') as Category,
                titleKo: itemRow.titleKo ?? itemRow.title,
                originalTitle: itemRow.title,
                summaryKo: itemRow.summaryKo ?? itemRow.snippet.slice(0, SUMMARY_FALLBACK_LENGTH),
                keyPoints: itemRow.keyPoints ?? [],
                // 브리핑에 따로 적은 "왜 중요한가"가 없으면 기사 요약 때 만든 것
                whyItMatters: entryRow.whyItMatters ?? itemRow.whyKo,
                url: itemRow.url,
                sourceName: itemRow.sourceName,
                engagementLabel: itemRow.engagementLabel,
                otherSources: itemRow.otherSources,
                publishedAt: itemRow.publishedAt,
                isRead: entryRow.readAt !== null,
                isSaved: entryRow.savedAt !== null,
                memo: entryRow.memo ?? '',
                tags: tagNamesByItem.get(itemRow.id) ?? [],
                followUpOf:
                    itemRow.followUpOf !== null && followUpTarget
                        ? { itemId: itemRow.followUpOf, titleKo: followUpTarget.title, digestDate: followUpTarget.digestDate }
                        : null
            }
        })

        return {
            id: digestRow.id,
            date: digestRow.date,
            headline: digestRow.headline,
            overview: digestRow.overview,
            createdAt: digestRow.createdAt,
            stats: digestRow.stats,
            entries
        }
    }

    return {
        findDigestIdByDate(digestDate) {
            return database.select({ id: digests.id }).from(digests).where(eq(digests.date, digestDate)).get()?.id ?? null
        },

        findLatestDigestDate() {
            return database.select({ date: digests.date }).from(digests).orderBy(desc(digests.date)).limit(1).get()?.date ?? null
        },

        findLatestDigest() {
            return toDigestDTO(database.select().from(digests).orderBy(desc(digests.date)).limit(1).get())
        },

        findDigestByDate(digestDate) {
            return toDigestDTO(database.select().from(digests).where(eq(digests.date, digestDate)).get())
        },

        listDigestSummaries() {
            // 호마다 실린 기사와 그 기사의 저장 기록을 엮어서 셈 (실린 기사가 없는 호도 0으로 나옴)
            // 저장 기록은 기사마다 많아야 하나라 실린 기사 수가 부풀지 않음
            return database
                .select({
                    id: digests.id,
                    date: digests.date,
                    headline: digests.headline,
                    entryCount: count(digestEntries.itemId),
                    savedCount: count(saves.itemId)
                })
                .from(digests)
                .leftJoin(digestEntries, eq(digestEntries.digestId, digests.id))
                .leftJoin(saves, eq(saves.itemId, digestEntries.itemId))
                .groupBy(digests.id)
                .orderBy(desc(digests.date))
                .all()
        },

        listPublishedItemsBetween(fromDate, beforeDate) {
            return database
                .select({
                    itemId: items.id,
                    digestDate: digests.date,
                    title: sql<string>`coalesce(${items.titleKo}, ${items.title})`
                })
                .from(digestEntries)
                .innerJoin(digests, eq(digests.id, digestEntries.digestId))
                .innerJoin(items, eq(items.id, digestEntries.itemId))
                .where(and(gte(digests.date, fromDate), lt(digests.date, beforeDate)))
                .orderBy(desc(digests.date), asc(digestEntries.rank))
                .all()
        },

        insertDigest(digestDate, digestContent) {
            return database
                .insert(digests)
                .values({
                    date: digestDate,
                    headline: digestContent.headline,
                    overview: digestContent.overview,
                    stats: digestContent.stats,
                    createdAt: nowIso()
                })
                .returning({ id: digests.id })
                .get().id
        },

        updateDigestContent(digestId, digestContent) {
            database
                .update(digests)
                .set({
                    headline: digestContent.headline,
                    overview: digestContent.overview,
                    stats: digestContent.stats,
                    createdAt: nowIso()
                })
                .where(eq(digests.id, digestId))
                .run()
        },

        deleteDigestById(digestId) {
            database.delete(digests).where(eq(digests.id, digestId)).run()
        },

        insertEntries(digestId, entries) {
            // 실을 기사가 없으면 쿼리를 만들지 않음 (값이 없는 INSERT는 실행할 수 없음)
            if (entries.length === 0) return
            database
                .insert(digestEntries)
                .values(
                    entries.map((entry) => ({
                        digestId,
                        itemId: entry.itemId,
                        rank: entry.rank,
                        section: entry.section,
                        whyItMatters: entry.whyItMatters
                    }))
                )
                .run()
        },

        deleteEntriesByDigestId(digestId) {
            return database.delete(digestEntries).where(eq(digestEntries.digestId, digestId)).run().changes
        }
    }
}
