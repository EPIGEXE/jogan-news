// ============================================================================
// Main과 Worker 사이의 메시지 규약
//
// [역할]
// - Worker(utilityProcess)가 제공하는 기능 목록과 각 기능의 인자 · 결과 타입 정의
// - Main과 Worker가 주고받는 메시지의 종류와 모양 정의
// - 기능 호출: Main이 번호(id)를 붙여 보내고, Worker가 같은 번호로 성공 · 실패를 답함
// - 시작 순서: Main이 시작 값(init)을 보내고, Worker가 준비 완료(ready)를 알린 뒤부터 호출을 받음
// - 호출과 상관없이 Worker가 먼저 보내는 알림: 생성 진행 · 기사 변경 · 답변 스트리밍 · 로그
// ============================================================================

import type { TriggerReason } from './schedule'
import type {
    AppSettings,
    DigestDTO,
    DigestSummaryDTO,
    HighlightDTO,
    HighlightRange,
    ItemDetailDTO,
    LibraryItemDTO,
    ChatEvent,
    ChatMessageDTO,
    ChatScope,
    QuickActions,
    RunProgress,
    SearchParams,
    SourceStatsDTO,
    StatsPeriod,
    TagCount,
    UsageSummary
} from './types'

// 브리핑 생성이 끝났을 때의 결과
export interface RunResult {
    digestId: number // 만든 브리핑의 번호
    date: string // 브리핑 날짜 'YYYY-MM-DD'
    headline: string // 오늘의 한 줄 (알림과 트레이 툴팁에 표시)
    entryCount: number // 실린 기사 수
    costUsd: number // 이 생성에 든 LLM 비용 (달러)
}

// Worker가 제공하는 기능 (메서드 이름이 호출할 기능 이름, 인자는 객체 하나)
export interface WorkerApi {
    getLatestDigest(): DigestDTO | null // 가장 최근 브리핑 (하나도 없으면 null)
    getLastDigestDate(): string | null // 마지막 브리핑 날짜 'YYYY-MM-DD' (하나도 없으면 null)
    // 브리핑 생성. 이미 만드는 중이거나 API 키가 없거나 하루 상한에 닿았으면 오류
    runPipeline(params: { reason: TriggerReason }): RunResult
    markRead(params: { itemId: number }): void // 읽음 표시
    setSaved(params: { itemId: number; saved: boolean }): void // 저장 · 저장 해제. 저장하면 본문 추출 · 태그 추천을 뒤에서 진행
    saveMemo(params: { itemId: number; body: string }): { savedAt: string } // 메모 저장 (빈 메모는 삭제). 메모를 쓴 기사는 자동 저장됨 → 저장한 시각
    getUsage(): UsageSummary // LLM 비용 사용량과 한도
    getSettings(): AppSettings
    updateSettings(params: Partial<AppSettings>): AppSettings // 준 항목만 변경 → 바뀐 뒤의 전체 설정
    // 라이브러리 · 아카이브
    search(params: SearchParams): LibraryItemDTO[] // 저장한 기사 또는 브리핑에 실린 기사 검색 (최대 200건)
    listTags(): TagCount[] // 저장한 기사에 붙은 태그와 개수 (많이 쓴 순)
    getItem(params: { itemId: number }): ItemDetailDTO | null // 기사 하나의 전체 정보 (없는 기사면 null)
    translateItem(params: { itemId: number }): boolean // 본문 번역 요청. 끝나면 item-updated 알림. 새로 번역했으면 true
    addHighlights(params: { itemId: number; ranges: HighlightRange[] }): HighlightDTO[] // 하이라이트 긋기. 그은 기사는 자동 저장됨
    updateHighlightNote(params: { highlightId: number; note: string }): HighlightDTO[] // 하이라이트 메모 수정 → 그 기사의 하이라이트 목록
    removeHighlight(params: { highlightId: number }): HighlightDTO[] // 하이라이트 지우기 → 그 기사의 남은 하이라이트 목록
    getSourceStats(params: { period: StatsPeriod }): SourceStatsDTO // 출처 페이지: 출처별 수집 · 선정 통계
    collectOnly(): { collected: number; skipped: boolean } // 낮 동안 수집만 (LLM 없음). 새로 쌓인 글 수. 브리핑 생성 중이거나 이미 수집 중이면 건너뜀(skipped)
    addTag(params: { itemId: number; name: string }): string[] // 태그 붙이기 → 그 기사의 태그 목록
    removeTag(params: { itemId: number; name: string }): string[] // 태그 떼기 → 그 기사의 남은 태그 목록
    listDigests(): DigestSummaryDTO[] // 지난 브리핑 목록 (최신 날짜부터)
    getDigest(params: { date: string }): DigestDTO | null // 그 날짜의 브리핑 (없으면 null)
    // AI 질문
    getChat(params: { scope: ChatScope }): ChatMessageDTO[] // 그 범위에서 나눈 대화 (오래된 것부터)
    // 질문을 저장하고 바로 돌아옴. 답변은 'chat' 알림으로 흘려보냄
    ask(params: { requestId: string; scope: ChatScope; question: string }): ChatMessageDTO
    clearChat(params: { scope: ChatScope }): void // 그 범위의 대화 삭제
    getQuickActions(): QuickActions // 설정 파일에 정해 둔 빠른 질문 목록
}

export type WorkerMethod = keyof WorkerApi // 기능 이름
export type WorkerParams<M extends WorkerMethod> = Parameters<WorkerApi[M]>[0] // 그 기능의 인자 (없으면 undefined)
export type WorkerResult<M extends WorkerMethod> = ReturnType<WorkerApi[M]> // 그 기능의 결과

// Main이 Worker로 보내는 메시지
export type MainToWorker =
    | { type: 'init'; dbPath: string; configDir: string; apiKey: string | null } // 시작 값 전달
    | { type: 'set-api-key'; apiKey: string | null } // API 키 변경
    | { type: 'rpc'; id: number; method: WorkerMethod; params: unknown } // 기능 호출 (id로 응답과 짝지음)

// Worker가 Main으로 보내는 메시지
export type WorkerToMain =
    | { type: 'ready' } // 호출을 받을 준비 완료
    | { type: 'rpc-result'; id: number; ok: true; result: unknown } // 호출 성공 (결과가 없는 기능이면 result는 null)
    | { type: 'rpc-result'; id: number; ok: false; error: string } // 호출 실패 (error는 오류 내용)
    | { type: 'progress'; progress: RunProgress } // 브리핑 생성 진행 상황
    // 저장 후 본문 추출 · 태그 추천처럼 뒤에서 끝난 작업으로 기사 정보가 바뀜
    | { type: 'item-updated'; itemId: number }
    | { type: 'chat'; event: ChatEvent } // AI 답변 스트리밍
    | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string } // Worker의 로그 (경고 · 오류는 진단 기록에 남음)
