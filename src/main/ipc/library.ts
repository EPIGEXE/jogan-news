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
import type { ContentService } from '../services/content-service'

/**
 * 라이브러리 · 아카이브 · 출처 요청 핸들러 등록
 *
 * @param {{ content: ContentService }} deps - 데이터 서비스
 * @returns {void}
 */
export function registerLibraryIpc(deps: { content: ContentService }): void {
    // 라이브러리: 기사 검색, 태그 목록
    ipcMain.handle(IPC.search, (_invokeEvent, searchParams: SearchParams) => deps.content.search(searchParams))
    ipcMain.handle(IPC.listTags, () => deps.content.listTags())

    // 아카이브: 지난 브리핑 목록, 그 날짜의 브리핑
    ipcMain.handle(IPC.listDigests, () => deps.content.listDigests())
    ipcMain.handle(IPC.getDigest, (_invokeEvent, digestDate: string) => deps.content.getDigest(digestDate))

    // 출처: 고른 기간의 출처별 통계
    ipcMain.handle(IPC.getSourceStats, (_invokeEvent, statsPeriod: StatsPeriod) => deps.content.getSourceStats(statsPeriod))
}
