// ============================================================================
// 태그 서비스 테스트
//
// [역할]
// - 이름 정리(공백 · # · 대소문자 · 길이), 하이픈만 다른 이름을 같은 태그로 보는 규칙 확인
// - 떼고 난 뒤 안 쓰는 태그 삭제, 저장한 기사만 세는 태그 목록 확인
// ============================================================================
import { describe, expect, it } from 'vitest'
import { normalizeTagName, TagService } from './tag-service'
import { createTestRepositories, insertTestItem } from './test-support'

function setup() {
    const repositories = createTestRepositories()
    const tagService = new TagService({ database: repositories.database, tagRepository: repositories.tagRepository })
    return { ...repositories, tagService }
}

describe('TagService', () => {
    it('이름 정리: 앞뒤 공백과 앞의 #을 떼고, 공백은 하이픈으로, 영문은 소문자로, 30자까지만', () => {
        expect(normalizeTagName(' #Coding Agent ')).toBe('coding-agent')
        expect(normalizeTagName('##MCP')).toBe('mcp')
        expect(normalizeTagName('   ')).toBe('')
        expect(normalizeTagName('a'.repeat(40))).toHaveLength(30)
    })

    it('정리해서 붙이고, 이미 붙은 태그는 한 번만 붙는다', () => {
        const { tagService, itemRepository } = setup()
        const itemId = insertTestItem(itemRepository)

        expect(tagService.addTag(itemId, 'MCP', 'auto')).toEqual(['mcp'])
        expect(tagService.addTag(itemId, 'mcp')).toEqual(['mcp'])
        expect(tagService.addTag(itemId, ' #Coding Agent ')).toEqual(['coding-agent', 'mcp'])
    })

    it('정리하고 남는 글자가 없는 이름은 붙이지 않는다', () => {
        const { tagService, itemRepository, tagRepository } = setup()
        const itemId = insertTestItem(itemRepository)

        expect(tagService.addTag(itemId, ' # ')).toEqual([])
        expect(tagRepository.findTagByName('')).toBeNull()
    })

    it('하이픈만 다른 이름은 같은 태그로 보고 기존 표기로 붙인다', () => {
        const { tagService, itemRepository } = setup()
        const firstItemId = insertTestItem(itemRepository)
        const secondItemId = insertTestItem(itemRepository)

        expect(tagService.addTag(firstItemId, 'open weight')).toEqual(['open-weight'])
        expect(tagService.addTag(firstItemId, 'openweight', 'auto')).toEqual(['open-weight'])
        // 다른 기사에 붙일 때도 먼저 있던 표기를 씀
        expect(tagService.addTag(secondItemId, 'OpenWeight')).toEqual(['open-weight'])
        expect(tagService.addTag(secondItemId, 'o-pen-weight')).toEqual(['open-weight'])
    })

    it('떼면 그 기사에서만 빠지고, 아무도 안 쓰는 태그는 지워진다', () => {
        const { tagService, itemRepository, tagRepository } = setup()
        const firstItemId = insertTestItem(itemRepository)
        const secondItemId = insertTestItem(itemRepository)
        tagService.addTag(firstItemId, 'mcp')
        tagService.addTag(firstItemId, 'agents')
        tagService.addTag(secondItemId, 'mcp')

        // 다른 기사가 아직 쓰는 태그는 남음
        expect(tagService.removeTag(firstItemId, ' #MCP ')).toEqual(['agents'])
        expect(tagRepository.findTagByName('mcp')).not.toBeNull()

        // 마지막으로 쓰던 기사에서 떼면 태그도 지워짐
        expect(tagService.removeTag(secondItemId, 'mcp')).toEqual([])
        expect(tagRepository.findTagByName('mcp')).toBeNull()
        expect(tagRepository.findTagByName('agents')).not.toBeNull()
    })

    it('태그 목록은 저장한 기사에 붙은 태그만 많이 쓴 순으로 센다', () => {
        const { tagService, itemRepository, libraryRepository } = setup()
        const firstItemId = insertTestItem(itemRepository)
        const secondItemId = insertTestItem(itemRepository)
        const unsavedItemId = insertTestItem(itemRepository)
        libraryRepository.insertSaveIfAbsent(firstItemId)
        libraryRepository.insertSaveIfAbsent(secondItemId)
        tagService.addTag(firstItemId, 'mcp')
        tagService.addTag(secondItemId, 'mcp')
        tagService.addTag(secondItemId, 'agents')
        tagService.addTag(unsavedItemId, 'not-saved')

        expect(tagService.listTagCounts()).toEqual([
            { name: 'mcp', count: 2 },
            { name: 'agents', count: 1 }
        ])
    })
})
