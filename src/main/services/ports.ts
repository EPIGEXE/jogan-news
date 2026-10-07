// 서비스가 바깥 기능을 쓰는 통로(포트). 서비스는 이 인터페이스만 알고 Electron은 모른다.
// 구현은 platform/에 있고, index.ts가 둘을 연결한다.

import type { ApiKeyStatus, Route } from '@shared/ipc'
import type { RunProgress } from '@shared/types'
import type { WorkerMethod, WorkerParams, WorkerResult } from '@shared/worker-protocol'

/** 진단 기록 남기기 (diagnostics.log + 진단 화면) */
export type LogFn = (kind: string, detail?: string) => void

export type TrayState = 'idle' | 'busy' | 'new' | 'offline' | 'error'

/** 앱 상태 표시 (트레이 아이콘) */
export interface StatusPort {
  set(state: TrayState): void
}

/** 인터넷 연결 확인 */
export interface NetworkPort {
  /** 연결될 때까지 기다린다. 처음 기다리기 시작할 때 onWaiting을 한 번 부른다. 끝내 안 되면 false */
  waitUntilOnline(onWaiting: () => void): Promise<boolean>
}

/** 브리핑 결과 알림 */
export interface BriefingNotifier {
  briefingReady(headline: string): void
  briefingFailed(message: string): void
}

/** Worker 프로세스 호출 */
export interface WorkerRpc {
  call<M extends WorkerMethod>(method: M, ...params: WorkerParams<M> extends undefined ? [] : [WorkerParams<M>]): Promise<WorkerResult<M>>
  setApiKey(apiKey: string | null): void
}

/** 화면(renderer)으로 보내는 알림 */
export interface RendererEvents {
  progress(p: RunProgress): void
  digestUpdated(): void
  itemUpdated(itemId: number): void
  navigate(route: Route): void
}

/** API 키 보관 */
export interface ApiKeyStore {
  get(): string | null
  status(): ApiKeyStatus
  set(key: string | null): void
}

/** Windows 시작 시 실행 */
export interface AutostartPort {
  isEnabled(): boolean
  set(on: boolean): boolean
}
