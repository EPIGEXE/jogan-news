// ============================================================================
// Main과 Worker 사이의 메시지 규약
//
// [역할]
// - Worker(utilityProcess)가 제공하는 기능 목록과 각 기능의 인자 · 결과 타입 정의
// - Worker의 기능은 모두 "기사를 만들어 오는 일" (수집 · 브리핑 생성 · 본문 추출 · 태그 추천 · 번역 · 답변 생성)
// - 사용자 데이터(저장 · 메모 · 태그 · 하이라이트 · 설정 · 대화)를 쓰는 일과 화면용 조회는 여기에 없음 (Main이 직접 함)
// - Main과 Worker가 주고받는 메시지의 종류와 모양 정의
// - 기능 호출: Main이 번호(id)를 붙여 보내고, Worker가 같은 번호로 성공 · 실패를 답함
// - 시작 순서: Main이 시작 값(init)을 보내고, Worker가 준비 완료(ready)를 알린 뒤부터 호출을 받음
// - 호출과 상관없이 Worker가 먼저 보내는 알림: 생성 진행 · 답변 조각 · 로그
// ============================================================================

import type { TriggerReason } from './schedule'
import type { ChatMessageDTO, ChatScope, RunProgress } from './types'

// 브리핑 생성이 끝났을 때의 결과
export interface RunResult {
    digestId: number // 만든 브리핑의 번호
    date: string // 브리핑 날짜 'YYYY-MM-DD'
    headline: string // 오늘의 한 줄 (알림과 트레이 툴팁에 표시)
    entryCount: number // 실린 기사 수
    costUsd: number // 이 생성에 든 LLM 비용 (달러)
}

// Main이 Worker에 시키는 일 (메서드 이름이 호출할 기능 이름, 인자는 객체 하나)
export interface WorkerApi {
    // 브리핑 생성. 이미 만드는 중이거나 API 키가 없거나 하루 상한에 닿았으면 오류
    runPipeline(params: { reason: TriggerReason }): RunResult
    // 낮 동안 수집만 (LLM 없음) → 새로 쌓인 글 수. 브리핑 생성 중이거나 이미 수집 중이면 건너뜀(skipped)
    collectOnly(): { collected: number; skipped: boolean }
    // 저장한 기사 보강: 원문 본문을 추출해 보관하고(이미 있으면 생략) 태그를 추천
    // contentUpdated: 본문을 새로 보관했는지, suggestedTags: 추천한 태그 이름 (추천하지 않았거나 실패하면 빈 목록)
    // 태그를 기사에 붙이는 일과 "보강 완료" 표시는 Main이 함
    enrichItem(params: { itemId: number }): { contentUpdated: boolean; suggestedTags: string[] }
    // 본문 번역 → 번역을 새로 만들었으면 true (키 없음 · 하루 상한 · 번역할 것 없음 · 실패면 false)
    // 같은 기사를 번역하는 중이면 진행 중인 번역의 결과를 돌려줌
    translateItem(params: { itemId: number }): boolean
    // 질문에 대한 답변 생성. 만드는 동안 조각을 'chat-delta' 알림으로 보내고, 끝나면 완성된 답변을 돌려줌
    // history: 이 질문 이전의 대화 (Main이 읽어서 넘김, 최근 것만 쓰는 규칙은 Worker)
    // content: 근거에 있는 인용 번호만 남긴 답변 (비었으면 안내 문구), citations: 실제로 인용한 번호, model: 답한 모델
    // 근거로 쓸 기사 · 브리핑이 없거나 API 키가 없으면 오류
    answerQuestion(params: { requestId: string; scope: ChatScope; question: string; history: ChatMessageDTO[] }): {
        content: string
        citations: number[]
        model: string
    }
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
    | { type: 'rpc-result'; id: number; ok: true; result: unknown } // 호출 성공
    | { type: 'rpc-result'; id: number; ok: false; error: string } // 호출 실패 (error는 오류 내용)
    | { type: 'progress'; progress: RunProgress } // 브리핑 생성 진행 상황
    | { type: 'chat-delta'; requestId: string; text: string } // 답변 조각
    | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string } // Worker의 로그 (경고 · 오류는 진단 기록에 남음)
