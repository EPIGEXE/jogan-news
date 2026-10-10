import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { DigestDTO, RunProgress } from '@shared/types'
import { api } from '@/common/lib/api'
import { qk } from '@/common/lib/queryKeys'

/** 최신 브리핑 (오늘 화면, 질문 화면, 메뉴의 기사 수, 제목 표시줄) */
export function useLatestDigest() {
  return useQuery({ queryKey: qk.latestDigest, queryFn: () => api.getLatestDigest() })
}

/** 특정 날짜의 브리핑 (아카이브). date가 없으면 부르지 않는다 */
export function useDigestByDate(date: string | null) {
  return useQuery({ queryKey: qk.digestByDate(date ?? ''), queryFn: () => api.getDigest(date!), enabled: date !== null })
}

/** 아카이브 날짜 목록 (제목 표시줄의 호수도 이것으로 센다) */
export function useDigestList() {
  return useQuery({ queryKey: qk.digestList, queryFn: () => api.listDigests() })
}

export interface DigestState {
  digest: DigestDTO | null
  loading: boolean
  running: boolean
  progress: RunProgress | null
  error: string | null
  runNow(): void
}

/**
 * 최신 브리핑과 생성 진행 상황. 브리핑은 쿼리 캐시에, 진행 상황은 Main이 보내는 실시간 알림이라 화면 상태로 둔다.
 * 새 브리핑이 게시되면 digest-updated로 캐시가 새로 읽힌다 (app/providers의 이벤트 연결).
 */
export function useDigest(): DigestState {
  const qc = useQueryClient()
  const latest = useLatestDigest()
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api.isRunning().then(setRunning)
    return api.onProgress((p) => {
      setProgress(p)
      if (p.stage === 'done') {
        setRunning(false)
        setError(null)
      } else if (p.stage === 'error') {
        setRunning(false)
        setError(p.message)
      } else {
        setRunning(true)
      }
    })
  }, [])

  const runNow = useCallback(() => {
    setError(null)
    setRunning(true)
    setProgress({ stage: 'collect', message: '준비 중' })
    void api.runNow().then((started) => {
      // 건너뛰었으면(오늘 브리핑이 이미 있음) "준비 중"에 멈춰 있지 않게 되돌린다
      if (!started) {
        setRunning(false)
        setProgress(null)
        void qc.invalidateQueries({ queryKey: qk.latestDigest })
      }
    })
  }, [qc])

  return {
    digest: latest.data ?? null,
    loading: latest.isPending,
    running,
    progress,
    error: error ?? (latest.error ? latest.error.message : null),
    runNow
  }
}
