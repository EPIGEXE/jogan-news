// ============================================================================
// 브리핑 · 기사 요청
//
// [역할]
// - 화면의 브리핑 요청(최신 브리핑 조회 · 지금 만들기 · 생성 중 여부)을 서비스에 전달
// - 기사 요청(읽음 · 저장 · 메모 · 본문 번역 · 하이라이트 · 태그)을 서비스에 전달
// - 링크를 기본 브라우저로 여는 요청 처리
// - "지금 만들기"는 생성을 시작했는지만 응답 (끝날 때까지 기다리지 않음, 진행 · 완료는 알림으로 전달됨)
// - 하이라이트 · 태그 요청은 바뀐 뒤의 목록을 응답
// ============================================================================
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { HighlightRange } from '@shared/types'
import type { ArticleService } from '../services/article-service'
import type { BriefingService } from '../services/briefing-service'
import type { DigestService } from '../services/digest-service'
import type { HighlightService } from '../services/highlight-service'
import type { TagService } from '../services/tag-service'

/**
 * 브리핑 · 기사 요청 핸들러 등록
 *
 * @param deps - 브리핑 · 기사 · 하이라이트 · 태그 서비스, 지금 만들기 · 링크 열기 동작
 * @returns {void}
 */
export function registerDigestIpc(deps: {
    digests: DigestService // 브리핑 조회
    briefing: BriefingService // 브리핑 생성 흐름
    article: ArticleService // 기사 상세 · 읽음 · 저장 · 메모 · 번역
    highlights: HighlightService // 하이라이트
    tags: TagService // 태그
    runNow(): Promise<boolean> // 브리핑을 지금 만들기 (생성을 시작했으면 true)
    openExternal(url: string): Promise<void> // 링크를 기본 브라우저로 열기
}): void {
    // 브리핑: 최신 브리핑 조회, 지금 만들기, 생성 중 여부
    ipcMain.handle(IPC.getLatestDigest, () => deps.digests.getLatestDigest())
    ipcMain.handle(IPC.runNow, () => deps.runNow())
    ipcMain.handle(IPC.isRunning, () => deps.briefing.isRunning())

    // 기사: 읽음 표시, 저장 · 저장 해제, 메모 저장
    ipcMain.handle(IPC.markRead, (_invokeEvent, itemId: number) => deps.article.markRead(itemId))
    ipcMain.handle(IPC.setSaved, (_invokeEvent, itemId: number, isSaved: boolean) => deps.article.setSaved(itemId, isSaved))
    ipcMain.handle(IPC.saveMemo, (_invokeEvent, itemId: number, memoBody: string) => deps.article.saveMemo(itemId, memoBody))

    // 기사 읽기: 상세 조회, 본문 번역
    ipcMain.handle(IPC.getItem, (_invokeEvent, itemId: number) => deps.article.getItemDetail(itemId))
    ipcMain.handle(IPC.translateItem, (_invokeEvent, itemId: number) => deps.article.translateItem(itemId))

    // 하이라이트: 긋기, 메모 수정, 지우기
    ipcMain.handle(IPC.addHighlights, (_invokeEvent, itemId: number, highlightRanges: HighlightRange[]) =>
        deps.highlights.addHighlights(itemId, highlightRanges)
    )
    ipcMain.handle(IPC.updateHighlightNote, (_invokeEvent, highlightId: number, note: string) =>
        deps.highlights.updateHighlightNote(highlightId, note)
    )
    ipcMain.handle(IPC.removeHighlight, (_invokeEvent, highlightId: number) => deps.highlights.removeHighlight(highlightId))

    // 태그: 붙이기, 떼기
    ipcMain.handle(IPC.addTag, (_invokeEvent, itemId: number, tagName: string) => deps.tags.addTag(itemId, tagName))
    ipcMain.handle(IPC.removeTag, (_invokeEvent, itemId: number, tagName: string) => deps.tags.removeTag(itemId, tagName))

    // 링크를 기본 브라우저로 열기
    ipcMain.handle(IPC.openExternal, (_invokeEvent, url: string) => deps.openExternal(url))
}
