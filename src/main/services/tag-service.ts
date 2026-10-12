// ============================================================================
// 태그 서비스
//
// [역할]
// - 기사에 태그 붙이기 · 떼기, 태그 목록(저장한 기사에 붙은 태그와 개수) 조회
// - 이름 정리: 앞뒤 공백 · 앞의 # 제거, 공백은 하이픈, 영문은 소문자, 최대 30자
// - 하이픈만 다른 이름은 같은 태그로 봄 (openweight를 붙이려 할 때 open-weight가 있으면 그 표기로 붙임)
// - 정리하고 남는 글자가 없는 이름은 붙이지 않음
// - 떼고 난 뒤 어떤 기사에도 붙어 있지 않은 태그는 삭제
// - 사용자가 직접 붙인 태그('user')와 AI가 추천한 태그('auto')를 같은 규칙으로 붙임 (붙인 쪽만 다르게 기록)
// ============================================================================
import type { TagCount } from '@shared/types'
import { runInTransaction, type AppDatabase } from '@data/client'
import type { TagRepository, TagSource } from '@data/repositories/tag-repository'

const MAX_TAG_LENGTH = 30 // 태그 이름의 최대 길이 (글자 수)

export interface TagServiceDeps {
    database: AppDatabase // 여러 쓰기를 한 묶음으로 실행할 때만 사용
    tagRepository: TagRepository // 태그 저장소
}

/**
 * 태그 이름 정리
 *
 * - 앞뒤 공백 · 앞의 # 제거, 공백은 하이픈, 영문은 소문자, 최대 30자
 *
 * @param {string} tagName - 입력한 태그 이름
 * @returns {string} 정리한 이름 (남는 글자가 없으면 빈 글자)
 */
export function normalizeTagName(tagName: string): string {
    return tagName.trim().replace(/^#+/, '').replace(/\s+/g, '-').toLowerCase().slice(0, MAX_TAG_LENGTH)
}

/**
 * 태그 붙이기 · 떼기 · 목록
 */
export class TagService {
    constructor(private readonly deps: TagServiceDeps) {}

    /**
     * 기사에 태그 붙이기
     *
     * - 하이픈만 다른 기존 태그가 있으면 그 표기를 씀
     * - 이미 붙어 있는 태그면 그대로 둠 (붙인 쪽도 처음 기록 그대로)
     *
     * @param {number} itemId - 기사 번호
     * @param {string} tagName - 태그 이름 (정리 전)
     * @param {TagSource} tagSource - user: 직접 입력, auto: AI 추천
     * @returns {string[]} 붙인 뒤 그 기사의 태그 목록 (이름순)
     */
    addTag(itemId: number, tagName: string, tagSource: TagSource = 'user'): string[] {
        const { database, tagRepository } = this.deps

        // 이름 정리 (정리하고 남는 글자가 없으면 아무것도 붙이지 않음)
        const normalizedTagName = normalizeTagName(tagName)
        if (!normalizedTagName) return tagRepository.listTagNamesByItemId(itemId)

        runInTransaction(database, () => {
            // 하이픈만 다른 기존 태그가 있으면 그 표기를 씀 (openweight → open-weight)
            const hyphenVariantTag = tagRepository.findTagByNameWithoutHyphens(normalizedTagName.replaceAll('-', ''))
            const tagNameToAttach = hyphenVariantTag?.name ?? normalizedTagName

            // 태그가 없으면 만들고 기사에 연결 (이미 있거나 이미 연결돼 있으면 그대로)
            tagRepository.insertTagIfAbsent(tagNameToAttach)
            const tagRow = tagRepository.findTagByName(tagNameToAttach)
            if (tagRow) tagRepository.insertItemTagIfAbsent(itemId, tagRow.id, tagSource)
        })
        return tagRepository.listTagNamesByItemId(itemId)
    }

    /**
     * 기사에서 태그 떼기
     *
     * - 더 이상 쓰는 기사가 없는 태그는 삭제
     *
     * @param {number} itemId - 기사 번호
     * @param {string} tagName - 뗄 태그 이름 (정리 전)
     * @returns {string[]} 뗀 뒤 그 기사에 남은 태그 목록 (이름순)
     */
    removeTag(itemId: number, tagName: string): string[] {
        const { database, tagRepository } = this.deps

        runInTransaction(database, () => {
            // 기사와 태그의 연결 삭제 (붙일 때와 같은 방법으로 정리한 이름으로 찾음)
            tagRepository.deleteItemTagByTagName(itemId, normalizeTagName(tagName))

            // 어떤 기사에도 붙어 있지 않게 된 태그 삭제
            tagRepository.deleteUnusedTags()
        })
        return tagRepository.listTagNamesByItemId(itemId)
    }

    // 저장한 기사에 붙은 태그와 그 기사 수 (많이 쓴 순, 같으면 이름순)
    listTagCounts(): TagCount[] {
        return this.deps.tagRepository.listTagCountsOnSavedItems()
    }
}
