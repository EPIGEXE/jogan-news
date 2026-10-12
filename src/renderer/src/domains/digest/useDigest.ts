// ============================================================================
// 최신 브리핑 상태 훅
//
// [역할]
// - 최신 브리핑과 생성 진행 상황을 한 묶음으로 제공
// - Main이 보내는 진행 알림을 받아 진행 단계 · 오류 갱신
// - "지금 만들기" 시작
// ============================================================================
import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { DigestDTO, RunProgress } from '@shared/types'
import { api } from '@/common/lib/api'
import { setRunning, useLatestDigestQuery, useRunNowMutation, useRunningQuery } from '@/domains/digest/queries'

export interface DigestState {
    digest: DigestDTO | null // 최신 브리핑 (아직 없거나 읽는 중이면 null)
    isLoading: boolean // 최신 브리핑을 처음 읽는 중인지
    isRunning: boolean // 지금 브리핑을 만드는 중인지
    runProgress: RunProgress | null // 마지막으로 받은 생성 진행 상황
    errorMessage: string | null // 생성 오류 또는 브리핑 조회 오류 메시지
    runNow(): void // 지금 만들기
}

/**
 * 최신 브리핑과 생성 진행 상황
 *
 * - 브리핑과 "만드는 중" 여부는 쿼리 캐시에 보관
 * - 진행 단계는 Main이 보내는 실시간 알림이라 화면 상태로 보관
 * - 새 브리핑이 게시되면 digest-updated로 캐시를 새로 읽음 (app/providers의 이벤트 연결)
 *
 * @returns {DigestState} 최신 브리핑 · 생성 중 여부 · 진행 상황 · 오류 · 지금 만들기 함수
 */
export function useDigest(): DigestState {
    // =============================== 훅 ===================================
    const queryClient = useQueryClient()

    // =============================== 쿼리 훅 ===================================
    const latestDigestQuery = useLatestDigestQuery()
    const isRunning = useRunningQuery()
    const { mutate: startRun } = useRunNowMutation()

    // =============================== 상태 ===================================
    const [latestRunProgress, setLatestRunProgress] = useState<RunProgress | null>(null) // 마지막으로 받은 생성 진행 상황
    const [runError, setRunError] = useState<string | null>(null) // 생성 중 난 오류 메시지

    // =============================== 계산 ===================================
    // 지금 만들기 (응답이 오기 전에도 "준비 중"이 보이게 진행 상황을 먼저 채우고, 건너뛰었으면 비움)
    const runNow = useCallback(() => {
        setRunError(null)
        setLatestRunProgress({ stage: 'collect', message: '준비 중' })
        startRun(undefined, {
            onSuccess: (runStarted) => {
                if (!runStarted) setLatestRunProgress(null)
            }
        })
    }, [startRun])

    // =============================== useEffect ===================================
    // Main의 진행 알림 구독 (진행 단계 · 만드는 중 여부 · 오류 갱신)
    useEffect(
        () =>
            api.onProgress((runProgress) => {
                setLatestRunProgress(runProgress)
                setRunning(queryClient, runProgress.stage !== 'done' && runProgress.stage !== 'error')
                if (runProgress.stage === 'done') setRunError(null)
                else if (runProgress.stage === 'error') setRunError(runProgress.message)
            }),
        [queryClient]
    )

    return {
        digest: latestDigestQuery.data ?? null,
        isLoading: latestDigestQuery.isPending,
        isRunning,
        runProgress: latestRunProgress,
        errorMessage: runError ?? (latestDigestQuery.error ? latestDigestQuery.error.message : null),
        runNow
    }
}
