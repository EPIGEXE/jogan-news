// ============================================================================
// 화면 요청 등록
//
// [역할]
// - 화면(renderer)에서 오는 요청을 받을 핸들러를 영역별로 등록
// - 요청을 서비스에 전달만 하고 판단 · 저장은 하지 않음
// - Electron 기능(창 · 링크 열기)은 직접 가져오지 않고 주입받은 것만 사용 (연결은 index.ts)
// - 채널 이름은 shared/ipc.ts의 IPC에 정의된 것만 사용
// ============================================================================
import type { ArticleService } from '../services/article-service'
import type { BriefingService } from '../services/briefing-service'
import type { ChatService } from '../services/chat-service'
import type { DiagnosticsService } from '../services/diagnostics-service'
import type { DigestService } from '../services/digest-service'
import type { HighlightService } from '../services/highlight-service'
import type { WindowControls } from '../services/ports'
import type { SearchService } from '../services/search-service'
import type { SettingsService } from '../services/settings-service'
import type { SourceStatsService } from '../services/source-stats-service'
import type { TagService } from '../services/tag-service'
import { registerChatIpc } from './chat'
import { registerDiagnosticsIpc } from './diagnostics'
import { registerDigestIpc } from './digest'
import { registerLibraryIpc } from './library'
import { registerSettingsIpc } from './settings'
import { registerWindowIpc } from './window'

// 화면 요청을 처리하는 데 필요한 것
export interface IpcDeps {
    digests: DigestService // 브리핑 조회
    briefing: BriefingService // 브리핑 생성 흐름
    article: ArticleService // 기사 상세 · 읽음 · 저장 · 메모 · 번역
    highlights: HighlightService // 하이라이트
    tags: TagService // 태그
    search: SearchService // 라이브러리 · 아카이브 검색
    sourceStats: SourceStatsService // 출처 통계
    chat: ChatService // AI 질문
    settings: SettingsService // API 키 · 예산 · 자동 시작
    diagnostics: DiagnosticsService // 진단 화면
    runNow(): Promise<boolean> // 브리핑을 지금 만들기 (생성을 시작했으면 true)
    openExternal(url: string): Promise<void> // 링크를 기본 브라우저로 열기
    window: WindowControls // 제목 표시줄의 창 버튼
}

/**
 * 화면 요청을 받을 핸들러를 모두 등록
 *
 * @param {IpcDeps} deps - 요청을 처리할 서비스와 창 조작
 * @returns {void}
 */
export function registerIpc(deps: IpcDeps): void {
    registerDigestIpc(deps) // 브리핑 · 기사
    registerLibraryIpc(deps) // 라이브러리 · 아카이브 · 출처
    registerChatIpc(deps) // AI 질문
    registerSettingsIpc(deps) // 설정
    registerDiagnosticsIpc(deps) // 진단 화면
    registerWindowIpc(deps.window) // 창 버튼
}
