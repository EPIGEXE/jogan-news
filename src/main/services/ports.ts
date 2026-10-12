// ============================================================================
// 서비스 포트
//
// [역할]
// - 서비스가 바깥 기능(창 · 트레이 · 네트워크 · 알림 · Worker · 키 보관)을 쓰는 통로를 인터페이스로 정의
// - 서비스는 이 인터페이스만 알고 Electron은 모름 (구현은 platform/에 있고 index.ts가 연결)
// - 테스트에서는 이 인터페이스의 가짜 구현으로 서비스만 따로 확인 (DESIGN.md 3.1절)
// - 타입만 정의 (실행되는 코드는 없음)
// ============================================================================

import type { ApiKeyStatus, Route } from '@shared/ipc'
import type { ChatEvent, RunProgress } from '@shared/types'
import type { WorkerMethod, WorkerParams, WorkerResult } from '@shared/worker-protocol'

// 진단 기록 남기기 (diagnostics.log 파일과 진단 화면)
// kind는 기록 종류(generate-start, trigger:unlock 등), detail은 덧붙일 설명
export type LogFn = (kind: string, detail?: string) => void

// 트레이 아이콘으로 보여 주는 앱 상태
// idle: 대기, busy: 브리핑 만드는 중, new: 새 브리핑, offline: 네트워크 연결 대기, error: 생성 실패
export type TrayState = 'idle' | 'busy' | 'new' | 'offline' | 'error'

// 직접 그린 제목 표시줄의 창 버튼
export interface WindowControls {
    minimize(): void // 최소화
    toggleMaximize(): void // 최대화되어 있으면 원래 크기로, 아니면 최대화
    close(): void // 닫지 않고 트레이로 숨기기
    isMaximized(): boolean // 지금 최대화되어 있는지 (창이 없으면 false)
}

// 앱 상태 표시 (트레이 아이콘)
export interface StatusPort {
    setTrayState(state: TrayState, detail?: string): void // detail은 툴팁에 붙일 설명 (새 브리핑의 오늘의 한 줄, 실패 이유 등)
}

// 인터넷 연결 확인
export interface NetworkPort {
    // 연결될 때까지 대기. 처음 기다리기 시작할 때 onWaiting을 한 번 호출. 끝내 안 되면 false
    // (바로 연결되면 onWaiting을 부르지 않음, 얼마나 기다릴지는 구현이 정함)
    waitUntilOnline(onWaiting: () => void): Promise<boolean>
}

// 브리핑 결과 알림
export interface BriefingNotifier {
    briefingReady(headline: string): void // 새 브리핑 완성 알림 (headline은 오늘의 한 줄)
    briefingFailed(message: string): void // 생성 실패 알림 (message는 실패 이유)
}

// Worker 프로세스 호출
export interface WorkerRpc {
    // Worker의 기능을 이름(method)으로 불러 결과 받기 (인자가 없는 기능이면 params 생략)
    // Worker 쪽에서 실패했거나 Worker가 종료되면 reject
    call<M extends WorkerMethod>(method: M, ...params: WorkerParams<M> extends undefined ? [] : [WorkerParams<M>]): Promise<WorkerResult<M>>
    setApiKey(apiKey: string | null): void // 바뀐 API 키를 Worker에 알림 (null이면 키 없음)
}

// 화면(renderer)으로 보내는 알림
export interface RendererEvents {
    runProgress(runProgress: RunProgress): void // 브리핑 생성 진행 상황
    digestUpdated(): void // 새 브리핑 게시
    itemUpdated(itemId: number): void // 기사 내용 변경 (보강 · 번역 완료)
    navigate(route: Route): void // 화면 이동 요청
    chatEvent(chatEvent: ChatEvent): void // AI 답변 조각
}

// API 키 보관
export interface ApiKeyStore {
    getApiKey(): string | null // 지금 쓸 키 (없으면 null)
    getStatus(): ApiKeyStatus // 키가 어디서 왔는지와 끝 몇 글자
    setApiKey(apiKey: string | null): void // null이나 빈 문자열이면 저장된 키 삭제
}

// Windows 시작 시 실행
export interface AutostartPort {
    isEnabled(): boolean // 지금 켜져 있는지
    setEnabled(shouldEnable: boolean): boolean // 켜기 · 끄기 → 바꾼 뒤의 실제 상태
}
