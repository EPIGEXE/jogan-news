// ============================================================================
// 라이브러리 · 아카이브 · 출처 요청
//
// [역할]
// - 화면의 검색 · 태그 목록 · 지난 브리핑 목록 · 날짜별 브리핑 · 출처 통계 요청을 서비스에 전달
// - 검색 하나로 라이브러리(저장한 기사)와 아카이브(브리핑에 실린 기사)를 모두 처리 (검색 조건의 범위로 구분)
// ============================================================================
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { SearchParams, StatsPeriod } from '@shared/types'
import type { DigestService } from '../services/digest-service'
import type { SearchService } from '../services/search-service'
import type { SourceStatsService } from '../services/source-stats-service'
import type { TagService } from '../services/tag-service'

/**
 * 라이브러리 · 아카이브 · 출처 요청 핸들러 등록
 *
 * @param deps - 검색 · 태그 · 브리핑 조회 · 출처 통계 서비스
 * @returns {void}
 */
export function registerLibraryIpc(deps: {
    search: SearchService // 라이브러리 · 아카이브 검색
    tags: TagService // 태그 목록
    digests: DigestService // 지난 브리핑 조회
    sourceStats: SourceStatsService // 출처 통계
}): void {
    // 라이브러리: 기사 검색, 태그 목록
    ipcMain.handle(IPC.search, (_invokeEvent, searchParams: SearchParams) => deps.search.search(searchParams))
    ipcMain.handle(IPC.listTags, () => deps.tags.listTagCounts())

    // 아카이브: 지난 브리핑 목록, 그 날짜의 브리핑
    ipcMain.handle(IPC.listDigests, () => deps.digests.listDigests())
    ipcMain.handle(IPC.getDigest, (_invokeEvent, digestDate: string) => deps.digests.getDigestByDate(digestDate))

    // 출처: 고른 기간의 출처별 통계
    ipcMain.handle(IPC.getSourceStats, (_invokeEvent, statsPeriod: StatsPeriod) => deps.sourceStats.getSourceStats(statsPeriod))
}
