// ============================================================================
// 태그 저장소
//
// [역할]
// - 태그(tags)와 기사에 붙은 태그(item_tags)를 읽고 씀 (둘 다 Main이 쓰는 테이블)
// - 태그 이름은 대소문자를 가리지 않고 비교 (컬럼 설정, 'MCP'와 'mcp'는 같은 태그)
// - 하이픈만 다른 태그를 찾는 조회 제공 (찾은 표기를 쓸지는 서비스가 정함)
// - 태그 목록 집계: 저장한 기사에 붙은 태그만, 많이 쓴 순
// - 규칙은 넣지 않음 (이름 정리, 하이픈만 다른 이름을 같은 태그로 보기, 떼고 난 뒤 안 쓰는 태그 지우기의 순서는 서비스)
// ============================================================================
import { and, asc, count, desc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import type { TagCount } from '@shared/types'
import type { AppDatabase } from '@data/client'
import { itemTags, saves, tags } from '@data/schema'

export type TagRow = typeof tags.$inferSelect // 태그 한 행 (번호 · 이름)
export type TagSource = 'auto' | 'user' // 태그를 붙인 쪽 (auto: AI 추천, user: 직접 입력)

export interface TagRepository {
    listTagNamesByItemId(itemId: number): string[] // 그 기사에 붙은 태그 이름 (이름순)
    findTagByName(tagName: string): TagRow | null // 이름이 같은 태그 (대소문자 무시, 없으면 null)
    // 하이픈을 모두 뺀 이름이 같은 태그 (openweight로 open-weight를 찾음, 없으면 null)
    // 넘기는 이름도 하이픈을 뺀 것이어야 하고, 이 비교는 대소문자를 가림
    findTagByNameWithoutHyphens(tagNameWithoutHyphens: string): TagRow | null
    insertTagIfAbsent(tagName: string): void // 태그 생성 (같은 이름이 있으면 그대로 둠)
    insertItemTagIfAbsent(itemId: number, tagId: number, tagSource: TagSource): void // 기사에 태그 연결 (이미 붙어 있으면 붙인 쪽도 그대로 둠)
    deleteItemTagByTagName(itemId: number, tagName: string): void // 기사에서 그 이름의 태그 떼기 (없는 태그 · 안 붙은 태그면 아무 일도 없음)
    deleteUnusedTags(): number // 어떤 기사에도 붙어 있지 않은 태그 삭제 → 지운 개수
    listTagCountsOnSavedItems(): TagCount[] // 저장한 기사에 붙은 태그와 그 기사 수 (많이 쓴 순, 같으면 이름순)
}

/**
 * 태그 저장소 생성
 *
 * @param {AppDatabase} database - DB 연결
 * @returns {TagRepository} 태그 저장소
 */
export function createTagRepository(database: AppDatabase): TagRepository {
    return {
        listTagNamesByItemId(itemId) {
            return database
                .select({ name: tags.name })
                .from(itemTags)
                .innerJoin(tags, eq(tags.id, itemTags.tagId))
                .where(eq(itemTags.itemId, itemId))
                .orderBy(asc(tags.name))
                .all()
                .map((tagNameRow) => tagNameRow.name)
        },

        findTagByName(tagName) {
            return database.select().from(tags).where(eq(tags.name, tagName)).get() ?? null
        },

        findTagByNameWithoutHyphens(tagNameWithoutHyphens) {
            // 저장된 이름에서 하이픈을 뺀 글자와 비교 (여럿이면 그중 하나)
            return (
                database
                    .select()
                    .from(tags)
                    .where(sql`replace(${tags.name}, '-', '') = ${tagNameWithoutHyphens}`)
                    .limit(1)
                    .get() ?? null
            )
        },

        insertTagIfAbsent(tagName) {
            database.insert(tags).values({ name: tagName }).onConflictDoNothing().run()
        },

        insertItemTagIfAbsent(itemId, tagId, tagSource) {
            database.insert(itemTags).values({ itemId, tagId, source: tagSource }).onConflictDoNothing().run()
        },

        deleteItemTagByTagName(itemId, tagName) {
            // 그 이름의 태그 번호를 찾아 그 기사와의 연결만 삭제 (태그 자체는 남김)
            const tagIdsWithName = database.select({ id: tags.id }).from(tags).where(eq(tags.name, tagName))
            database
                .delete(itemTags)
                .where(and(eq(itemTags.itemId, itemId), inArray(itemTags.tagId, tagIdsWithName)))
                .run()
        },

        deleteUnusedTags() {
            // 연결 테이블에 한 번도 나오지 않는 태그만 삭제
            const tagIdsInUse = database.select({ tagId: itemTags.tagId }).from(itemTags)
            return database.delete(tags).where(notInArray(tags.id, tagIdsInUse)).run().changes
        },

        listTagCountsOnSavedItems() {
            // 저장한 기사와의 연결만 남겨 태그별로 셈 (저장하지 않은 기사에만 붙은 태그는 목록에 없음)
            return database
                .select({ name: tags.name, count: count() })
                .from(itemTags)
                .innerJoin(tags, eq(tags.id, itemTags.tagId))
                .innerJoin(saves, eq(saves.itemId, itemTags.itemId))
                .groupBy(tags.id)
                .orderBy(desc(count()), asc(tags.name))
                .all()
        }
    }
}
