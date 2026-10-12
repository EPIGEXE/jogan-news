// ============================================================================
// 검색 저장소
//
// [역할]
// - 전문 검색 색인(search_fts)을 다시 쓰고, 그 색인으로 기사를 찾아 목록용 모양으로 반환
// - 색인 행 하나가 기사 하나 (행 번호 rowid = 기사 번호), 열은 title · body · memo 세 개
// - 색인은 Worker가 쓰는 내용(제목 · 요약 · 본문 · 번역)과 Main이 쓰는 내용(메모 · 하이라이트)을 함께 담음
//   (어느 쪽이 바뀌든 그 내용을 바꾼 서비스가 reindexItem을 호출해야 검색에 반영됨)
// - search_fts는 FTS5 가상 테이블이라 스키마에 없어, 이 파일에서만 테이블 이름을 직접 씀 (그 밖의 테이블 · 컬럼은 스키마 객체)
// - 검색어를 조건으로 바꾸는 방법(3글자 이상은 FTS, 그보다 짧으면 LIKE)은 조회 방법이라 여기에 둠
// - 언제 색인을 다시 쓰는지는 정하지 않음 (내용을 바꾼 서비스가 정함), 다른 저장소를 호출하지 않음
// ============================================================================
import { and, desc, eq, exists, inArray, isNotNull, max, sql, type SQL } from 'drizzle-orm'
import type { Category, LibraryItemDTO, SearchParams } from '@shared/types'
import { runInTransaction, type AppDatabase } from '../client'
import { contents, digestEntries, digests, highlights, items, itemTags, notes, saves, tags } from '../schema'

export interface SearchRepository {
    // 기사 한 건의 색인 행을 지금 내용(기사 · 본문 · 메모 · 하이라이트)으로 다시 씀
    // 없는 기사 번호면 색인 행만 지워짐
    reindexItem(itemId: number): void
    // 범위와 조건(검색어 · 태그 · 메모 있는 기사만)을 모두 만족하는 기사 → 최대 200건
    // saved: 저장한 기사, 최근에 저장한 순 / published: 브리핑에 실린 기사, 최근 브리핑 순
    searchItems(searchParams: SearchParams): LibraryItemDTO[]
}

const TRIGRAM_MIN_LENGTH = 3 // trigram 색인으로 찾을 수 있는 가장 짧은 낱말 길이 (글자 수)
const SEARCH_LIMIT = 200 // 검색 결과 최대 건수

// LIKE 패턴에서 특별한 뜻이 있는 글자(% · _)와 이스케이프 글자(!) 앞에 !를 붙임
function escapeLike(searchWord: string): string {
    return searchWord.replace(/[!%_]/g, (specialChar) => `!${specialChar}`)
}

// 검색어를 기사에 거는 조건 목록으로 변환 (모두 AND로 묶어 씀, 낱말이 없으면 빈 목록)
// - 3글자 이상 낱말은 FTS(trigram) MATCH로 찾음
// - 2글자 이하 낱말(예: "모델")은 trigram으로 찾을 수 없어 LIKE로 찾음
function buildQueryConditions(query: string): SQL[] {
    // 공백으로 낱말 나누기
    const searchWords = query.trim().split(/\s+/).filter(Boolean)

    // 낱말을 길이로 나누기 (한글 · 이모지도 한 글자로 세도록 코드 포인트 단위로 셈)
    const longWords = searchWords.filter((searchWord) => [...searchWord].length >= TRIGRAM_MIN_LENGTH)
    const shortWords = searchWords.filter((searchWord) => [...searchWord].length < TRIGRAM_MIN_LENGTH)

    const queryConditions: SQL[] = [] // AND로 묶을 조건

    // 긴 낱말은 MATCH 조건 하나로 묶음 (낱말마다 큰따옴표로 감싸 FTS 문법이 아닌 글자 그대로 찾음)
    if (longWords.length) {
        const matchExpression = longWords.map((longWord) => `"${longWord.replaceAll('"', '""')}"`).join(' AND ')
        queryConditions.push(sql`${items.id} IN (SELECT rowid FROM search_fts WHERE search_fts MATCH ${matchExpression})`)
    }

    // 짧은 낱말은 낱말마다 LIKE 조건 (제목 · 본문 · 메모 중 어디든 포함)
    for (const shortWord of shortWords) {
        const likePattern = `%${escapeLike(shortWord)}%`
        queryConditions.push(
            sql`${items.id} IN (SELECT rowid FROM search_fts WHERE title LIKE ${likePattern} ESCAPE '!' OR body LIKE ${likePattern} ESCAPE '!' OR memo LIKE ${likePattern} ESCAPE '!')`
        )
    }
    return queryConditions
}

/**
 * 검색 저장소 생성
 *
 * @param {AppDatabase} database - DB 연결
 * @returns {SearchRepository} 검색 저장소
 */
export function createSearchRepository(database: AppDatabase): SearchRepository {
    return {
        reindexItem(itemId) {
            // 색인에 넣을 내용을 기사 한 건에서 뽑는 조회
            // title 열: 원래 제목 · 한국어 제목
            // body 열: 요약 · 핵심 포인트(저장된 JSON 글자 그대로) · 소개 글 · 본문 문단 · 번역 문단(번역하지 않은 문단은 뺌)
            // memo 열: 메모 · 하이라이트 글자와 하이라이트 메모
            const indexContentQuery = database
                .select({
                    itemId: items.id,
                    title: sql`${items.title} || ' ' || coalesce(${items.titleKo}, '')`,
                    body: sql`coalesce(${items.summaryKo}, '') || ' ' || coalesce(${items.keyPoints}, '') || ' ' || coalesce(${items.snippet}, '') || ' ' ||
                        coalesce((SELECT group_concat(value, ' ') FROM json_each(${contents.paragraphs})), '') || ' ' ||
                        coalesce((SELECT group_concat(value, ' ') FROM json_each(${contents.paragraphsKo}) WHERE value IS NOT NULL), '')`,
                    memo: sql`coalesce(${notes.body}, '') || ' ' ||
                        coalesce((SELECT group_concat(${highlights.text} || ' ' || ${highlights.note}, ' ') FROM ${highlights} WHERE ${highlights.itemId} = ${items.id}), '')`
                })
                .from(items)
                .leftJoin(contents, eq(contents.itemId, items.id))
                .leftJoin(notes, eq(notes.itemId, items.id))
                .where(eq(items.id, itemId))

            // 이전 색인 행을 지우고 새로 넣기 (둘 사이에 색인이 비어 보이지 않게 한 묶음으로)
            // 조회를 getSQL()로 넣어 괄호 없이 이어 붙임 (INSERT … (SELECT …)는 SQLite 문법 오류)
            runInTransaction(database, () => {
                database.run(sql`DELETE FROM search_fts WHERE rowid = ${itemId}`)
                database.run(sql`INSERT INTO search_fts (rowid, title, body, memo) ${indexContentQuery.getSQL()}`)
            })
        },

        searchItems(searchParams) {
            const whereConditions: SQL[] = [] // AND로 묶을 조건

            // 범위 조건: 저장한 기사만 / 브리핑에 실린 적 있는 기사만
            if (searchParams.scope === 'saved') {
                whereConditions.push(isNotNull(saves.savedAt))
            } else {
                whereConditions.push(
                    exists(
                        database
                            .select({ found: sql`1` })
                            .from(digestEntries)
                            .where(eq(digestEntries.itemId, items.id))
                    )
                )
            }

            // 메모가 있는 기사만
            if (searchParams.memoOnly) whereConditions.push(isNotNull(notes.body))

            // 이 태그가 붙은 기사만 (태그 이름 컬럼이 대소문자를 가리지 않음)
            if (searchParams.tag) {
                whereConditions.push(
                    exists(
                        database
                            .select({ found: sql`1` })
                            .from(itemTags)
                            .innerJoin(tags, eq(tags.id, itemTags.tagId))
                            .where(and(eq(itemTags.itemId, items.id), eq(tags.name, searchParams.tag)))
                    )
                )
            }

            // 검색어의 낱말을 모두 포함한 기사만 (낱말이 없으면 조건을 붙이지 않음)
            if (searchParams.query) whereConditions.push(...buildQueryConditions(searchParams.query))

            // 이 기사가 가장 최근에 실린 브리핑 날짜 (실린 적 없으면 null)
            const latestDigestDate = sql<string | null>`(${database
                .select({ latestDate: max(digests.date) })
                .from(digestEntries)
                .innerJoin(digests, eq(digests.id, digestEntries.digestId))
                .where(eq(digestEntries.itemId, items.id))})`.as('digest_date')

            // 조건에 맞는 기사를 저장 시각 · 메모와 함께 조회
            // 정렬: 저장한 기사는 최근에 저장한 순, 실린 기사는 최근 브리핑 순 (같은 날은 기사 번호가 큰 순)
            const foundRows = database
                .select({
                    itemId: items.id,
                    title: items.title,
                    titleKo: items.titleKo,
                    summaryKo: items.summaryKo,
                    snippet: items.snippet,
                    triageCategory: items.triageCategory,
                    sourceName: items.sourceName,
                    url: items.url,
                    savedAt: saves.savedAt,
                    memo: notes.body,
                    digestDate: latestDigestDate
                })
                .from(items)
                .leftJoin(saves, eq(saves.itemId, items.id))
                .leftJoin(notes, eq(notes.itemId, items.id))
                .where(and(...whereConditions))
                .orderBy(...(searchParams.scope === 'saved' ? [desc(saves.savedAt)] : [desc(latestDigestDate), desc(items.id)]))
                .limit(SEARCH_LIMIT)
                .all()

            // 결과가 없으면 태그를 조회할 것 없음
            if (foundRows.length === 0) return []

            // 찾은 기사에 붙은 태그를 한 번에 조회해 기사별로 묶기
            const tagRows = database
                .select({ itemId: itemTags.itemId, tagName: tags.name })
                .from(itemTags)
                .innerJoin(tags, eq(tags.id, itemTags.tagId))
                .where(
                    inArray(
                        itemTags.itemId,
                        foundRows.map((foundRow) => foundRow.itemId)
                    )
                )
                .all()
            const tagNamesByItemId = new Map<number, string[]>() // 기사 번호별 태그 이름
            for (const tagRow of tagRows) {
                const tagNames = tagNamesByItemId.get(tagRow.itemId)
                if (tagNames) tagNames.push(tagRow.tagName)
                else tagNamesByItemId.set(tagRow.itemId, [tagRow.tagName])
            }

            // 목록에 필요한 항목만 골라 화면용 모양으로 변환
            // 아직 선별 · 요약하지 않은 기사는 분류 'other', 원래 제목, 소개 글 앞 300자로 채움
            return foundRows.map((foundRow) => ({
                itemId: foundRow.itemId,
                titleKo: foundRow.titleKo ?? foundRow.title,
                originalTitle: foundRow.title,
                summaryKo: foundRow.summaryKo ?? foundRow.snippet.slice(0, 300),
                category: (foundRow.triageCategory as Category | null) ?? 'other',
                sourceName: foundRow.sourceName,
                url: foundRow.url,
                isSaved: foundRow.savedAt !== null,
                savedAt: foundRow.savedAt,
                digestDate: foundRow.digestDate,
                memo: foundRow.memo ?? '',
                tags: (tagNamesByItemId.get(foundRow.itemId) ?? []).sort((leftTag, rightTag) => leftTag.localeCompare(rightTag))
            }))
        }
    }
}
