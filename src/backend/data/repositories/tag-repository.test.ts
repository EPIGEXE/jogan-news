// ============================================================================
// 태그 저장소 테스트
//
// [역할]
// - 메모리 DB에 실제 쿼리를 돌려 태그 생성 · 연결 · 떼기 · 정리 · 집계 확인
// - 이름 비교(대소문자 무시), 하이픈만 다른 태그 찾기, 저장한 기사만 세는 목록의 정렬
// ============================================================================
import { describe, expect, it } from 'vitest'
import type { AppDatabase } from '@data/client'
import { items, itemTags, saves } from '@data/schema'
import { openTestDatabase } from '@data/testing'
import { createTagRepository, type TagRepository, type TagSource } from './tag-repository'

// 외래 키를 채울 기사 한 건 넣기 → 기사 번호
function insertItem(database: AppDatabase, urlKey: string): number {
    const itemInsertResult = database
        .insert(items)
        .values({
            urlKey,
            url: `https://${urlKey}`,
            sourceId: 'hn',
            sourceName: 'Hacker News',
            kind: 'community',
            title: 'Mistral Large 4 released',
            titleNorm: 'mistral large 4 released',
            collectedAt: '2026-10-07T00:00:00.000Z'
        })
        .run()
    return Number(itemInsertResult.lastInsertRowid)
}

// 기사를 저장한 것으로 표시
function insertSave(database: AppDatabase, itemId: number): void {
    database.insert(saves).values({ itemId, savedAt: '2026-10-07T01:00:00.000Z' }).run()
}

// 태그를 만들고 기사에 연결 (서비스가 하는 조합 순서와 같음)
function attachTag(tagRepository: TagRepository, itemId: number, tagName: string, tagSource: TagSource = 'user'): void {
    tagRepository.insertTagIfAbsent(tagName)
    tagRepository.insertItemTagIfAbsent(itemId, tagRepository.findTagByName(tagName)!.id, tagSource)
}

describe('tag-repository', () => {
    it('태그 생성: 같은 이름은 한 번만 만들고, 대소문자만 다른 이름도 같은 태그로 본다', () => {
        const database = openTestDatabase()
        const tagRepository = createTagRepository(database)

        expect(tagRepository.findTagByName('mcp')).toBeNull()
        tagRepository.insertTagIfAbsent('mcp')
        tagRepository.insertTagIfAbsent('mcp')
        tagRepository.insertTagIfAbsent('MCP')
        const tagRow = tagRepository.findTagByName('mcp')!
        expect(tagRow.name).toBe('mcp')
        expect(tagRepository.findTagByName('MCP')).toEqual(tagRow)

        // 다른 이름은 다른 번호
        tagRepository.insertTagIfAbsent('agents')
        expect(tagRepository.findTagByName('agents')!.id).not.toBe(tagRow.id)
    })

    it('하이픈만 다른 태그 찾기: 하이픈을 뺀 이름이 같으면 찾고, 없으면 null', () => {
        const database = openTestDatabase()
        const tagRepository = createTagRepository(database)
        tagRepository.insertTagIfAbsent('open-weight')

        expect(tagRepository.findTagByNameWithoutHyphens('openweight')?.name).toBe('open-weight')
        expect(tagRepository.findTagByNameWithoutHyphens('closedweight')).toBeNull()
        // 넘기는 이름에 하이픈이 남아 있으면 찾지 못함 (빼고 넘기는 것은 서비스의 일)
        expect(tagRepository.findTagByNameWithoutHyphens('open-weight')).toBeNull()
        // 이 비교는 대소문자를 가림 (서비스가 소문자로 정리한 이름을 넘김)
        expect(tagRepository.findTagByNameWithoutHyphens('OpenWeight')).toBeNull()

        // 하이픈이 없는 태그는 자기 이름으로 찾음
        tagRepository.insertTagIfAbsent('mcp')
        expect(tagRepository.findTagByNameWithoutHyphens('mcp')?.name).toBe('mcp')
    })

    it('기사의 태그: 이름순으로 돌려주고, 다른 기사의 태그는 섞이지 않는다', () => {
        const database = openTestDatabase()
        const tagRepository = createTagRepository(database)
        const firstItemId = insertItem(database, 'a.com/1')
        const secondItemId = insertItem(database, 'a.com/2')

        expect(tagRepository.listTagNamesByItemId(firstItemId)).toEqual([])
        attachTag(tagRepository, firstItemId, 'open-weight')
        attachTag(tagRepository, firstItemId, 'mcp')
        attachTag(tagRepository, secondItemId, 'agents')
        expect(tagRepository.listTagNamesByItemId(firstItemId)).toEqual(['mcp', 'open-weight'])
        expect(tagRepository.listTagNamesByItemId(secondItemId)).toEqual(['agents'])
    })

    it('태그 연결: 이미 붙어 있으면 다시 붙이지 않고, 처음 붙인 쪽을 그대로 둔다', () => {
        const database = openTestDatabase()
        const tagRepository = createTagRepository(database)
        const itemId = insertItem(database, 'a.com/1')

        attachTag(tagRepository, itemId, 'mcp', 'auto')
        attachTag(tagRepository, itemId, 'mcp', 'user')
        expect(tagRepository.listTagNamesByItemId(itemId)).toEqual(['mcp'])
        expect(database.select().from(itemTags).all()).toMatchObject([{ itemId, source: 'auto' }])
    })

    it('태그 떼기: 그 기사에서만 떼고(대소문자 무시), 안 쓰는 태그 정리는 따로 부른다', () => {
        const database = openTestDatabase()
        const tagRepository = createTagRepository(database)
        const firstItemId = insertItem(database, 'a.com/1')
        const secondItemId = insertItem(database, 'a.com/2')
        attachTag(tagRepository, firstItemId, 'mcp')
        attachTag(tagRepository, firstItemId, 'open-weight')
        attachTag(tagRepository, secondItemId, 'mcp')

        // 두 기사가 쓰는 태그를 한 기사에서 뗌 → 다른 기사에는 남고, 지울 태그 없음
        tagRepository.deleteItemTagByTagName(firstItemId, 'MCP')
        expect(tagRepository.listTagNamesByItemId(firstItemId)).toEqual(['open-weight'])
        expect(tagRepository.listTagNamesByItemId(secondItemId)).toEqual(['mcp'])
        expect(tagRepository.deleteUnusedTags()).toBe(0)

        // 마지막 기사에서도 뗌 → 태그 행은 정리하기 전까지 남아 있음
        tagRepository.deleteItemTagByTagName(secondItemId, 'mcp')
        expect(tagRepository.findTagByName('mcp')).not.toBeNull()
        expect(tagRepository.deleteUnusedTags()).toBe(1)
        expect(tagRepository.findTagByName('mcp')).toBeNull()
        expect(tagRepository.findTagByName('open-weight')).not.toBeNull()

        // 없는 태그 · 안 붙은 태그를 떼도 아무 일 없음
        tagRepository.deleteItemTagByTagName(firstItemId, 'no-such-tag')
        tagRepository.deleteItemTagByTagName(secondItemId, 'open-weight')
        expect(tagRepository.listTagNamesByItemId(firstItemId)).toEqual(['open-weight'])
    })

    it('태그 목록: 저장한 기사에 붙은 태그만, 많이 쓴 순 · 같으면 이름순으로 센다', () => {
        const database = openTestDatabase()
        const tagRepository = createTagRepository(database)
        const firstItemId = insertItem(database, 'a.com/1')
        const secondItemId = insertItem(database, 'a.com/2')
        const unsavedItemId = insertItem(database, 'a.com/3')
        expect(tagRepository.listTagCountsOnSavedItems()).toEqual([])

        attachTag(tagRepository, firstItemId, 'open-weight')
        attachTag(tagRepository, firstItemId, 'mcp')
        attachTag(tagRepository, firstItemId, 'agents')
        attachTag(tagRepository, secondItemId, 'mcp')
        attachTag(tagRepository, unsavedItemId, 'mcp')
        attachTag(tagRepository, unsavedItemId, 'unsaved-only')
        insertSave(database, firstItemId)
        insertSave(database, secondItemId)

        expect(tagRepository.listTagCountsOnSavedItems()).toEqual([
            { name: 'mcp', count: 2 },
            { name: 'agents', count: 1 },
            { name: 'open-weight', count: 1 }
        ])
    })
})
