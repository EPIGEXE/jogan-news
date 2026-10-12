// ============================================================================
// 브리핑 생성 서비스 테스트
//
// [역할]
// - 성공 · 오프라인 · 실패 때 트레이 상태, 화면 알림, 데스크톱 알림이 맞게 나가는지 확인
// - 이미 만드는 중일 때 두 번째 요청을 건너뛰는지 확인
// - 미리 수집 요청을 Worker에 전달하는지 확인
// ============================================================================
import { describe, expect, it, vi } from 'vitest'
import type { RunResult } from '@shared/worker-protocol'
import { BriefingService, type BriefingDeps } from './briefing-service'
import type { TrayState, WorkerRpc } from './ports'

const RESULT: RunResult = { digestId: 1, date: '2026-10-07', headline: '오늘의 한 줄', entryCount: 17, costUsd: 0.01 }

function setup(opts: { online?: boolean; run?: () => Promise<RunResult> } = {}) {
    const states: TrayState[] = []
    const call = vi.fn(opts.run ?? (() => Promise.resolve(RESULT)))
    const deps = {
        network: {
            waitUntilOnline: vi.fn(async (onWaiting: () => void) => {
                if (opts.online === false) onWaiting()
                return opts.online ?? true
            })
        },
        status: { setTrayState: (s: TrayState) => states.push(s) },
        notifier: { briefingReady: vi.fn(), briefingFailed: vi.fn() },
        worker: { call, setApiKey: vi.fn() } as unknown as WorkerRpc,
        events: { runProgress: vi.fn(), digestUpdated: vi.fn(), itemUpdated: vi.fn(), navigate: vi.fn(), chatEvent: vi.fn() },
        log: vi.fn()
    } satisfies BriefingDeps
    return { service: new BriefingService(deps), deps, states, call }
}

describe('BriefingService', () => {
    it('성공하면 생성 중 → 새 브리핑으로 바꾸고, 화면을 갱신하고, 알림을 띄운다', async () => {
        const { service, deps, states, call } = setup()
        await service.generate('unlock')
        expect(call).toHaveBeenCalledWith('runPipeline', { reason: 'unlock' })
        expect(states).toEqual(['busy', 'new'])
        expect(deps.events.digestUpdated).toHaveBeenCalledOnce()
        expect(deps.notifier.briefingReady).toHaveBeenCalledWith('오늘의 한 줄')
        expect(service.isRunning()).toBe(false)
    })

    it('끝내 오프라인이면 파이프라인을 부르지 않고 오프라인으로 표시한다', async () => {
        const { service, deps, states, call } = setup({ online: false })
        await service.generate('startup')
        expect(call).not.toHaveBeenCalled()
        expect(states).toEqual(['offline', 'offline'])
        expect(deps.events.runProgress).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'error' }))
        expect(deps.notifier.briefingReady).not.toHaveBeenCalled()
    })

    it('실패하면 오류로 표시하고 실패 알림과 오류 진행 상황을 보낸다', async () => {
        const { service, deps, states } = setup({ run: () => Promise.reject(new Error('API 키가 없습니다')) })
        await service.generate('manual')
        expect(states).toEqual(['busy', 'error'])
        expect(deps.notifier.briefingFailed).toHaveBeenCalledWith('API 키가 없습니다')
        expect(deps.events.runProgress).toHaveBeenCalledWith({ stage: 'error', message: 'API 키가 없습니다' })
        expect(service.isRunning()).toBe(false)
    })

    it('미리 수집 요청은 Worker의 결과를 그대로 돌려준다', async () => {
        const collectResult = { collected: 3, skipped: false }
        const call = vi.fn(() => Promise.resolve(collectResult))
        const { deps } = setup()
        const service = new BriefingService({ ...deps, worker: { call, setApiKey: vi.fn() } as unknown as WorkerRpc })
        await expect(service.collectOnly()).resolves.toEqual(collectResult)
        expect(call).toHaveBeenCalledWith('collectOnly')
    })

    it('이미 만드는 중이면 두 번째 요청은 건너뛴다', async () => {
        let finish!: (r: RunResult) => void
        const { service, call } = setup({ run: () => new Promise((r) => (finish = r)) })
        const first = service.generate('unlock')
        await vi.waitFor(() => expect(call).toHaveBeenCalledOnce())
        expect(service.isRunning()).toBe(true)
        await service.generate('timer')
        expect(call).toHaveBeenCalledOnce()
        finish(RESULT)
        await first
        expect(service.isRunning()).toBe(false)
    })
})
