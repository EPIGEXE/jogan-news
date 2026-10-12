// ============================================================================
// 검색 서비스
//
// [역할]
// - 라이브러리(저장한 기사)와 아카이브(브리핑에 실린 기사) 검색 (검색 조건의 범위로 구분)
// - 검색어 · 태그 · 메모가 있는 기사만 조건을 모두 만족하는 기사만, 최대 200건
// - 저장한 기사는 최근에 저장한 순, 실린 기사는 최근 브리핑 순
// - 읽기만 함 (검색 색인 갱신은 색인에 들어가는 내용을 바꾼 서비스가 함)
// ============================================================================
import type { LibraryItemDTO, SearchParams } from '@shared/types'
import type { SearchRepository } from '@data/repositories/search-repository'

/**
 * 라이브러리 · 아카이브 검색
 */
export class SearchService {
    constructor(private readonly deps: { searchRepository: SearchRepository }) {}

    // 범위와 조건을 모두 만족하는 기사 (검색어가 없으면 그 범위의 전체)
    search(searchParams: SearchParams): LibraryItemDTO[] {
        return this.deps.searchRepository.searchItems(searchParams)
    }
}
