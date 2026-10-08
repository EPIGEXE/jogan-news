import { useCallback, useEffect, useState } from 'react'
import type { DigestDTO, DigestEntryDTO, RunProgress } from '@shared/types'
import { api } from './api'

export interface DigestState {
  digest: DigestDTO | null
  loading: boolean
  running: boolean
  progress: RunProgress | null
  error: string | null
  runNow(): void
  /** 저장·메모·읽음을 화면에 바로 반영 (DB 저장은 따로 호출) */
  patchEntry(itemId: number, patch: Partial<DigestEntryDTO>): void
}

/** 최신 브리핑과 생성 진행 상황을 구독한다 */
export function useDigest(): DigestState {
  const [digest, setDigest] = useState<DigestDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setDigest(await api.getLatestDigest())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    void api.isRunning().then(setRunning)
    const offProgress = api.onProgress((p) => {
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
    const offUpdated = api.onDigestUpdated(() => void load())
    return () => {
      offProgress()
      offUpdated()
    }
  }, [load])

  const runNow = useCallback(() => {
    setError(null)
    setRunning(true)
    setProgress({ stage: 'collect', message: '준비 중' })
    void api.runNow().then((started) => {
      // 건너뛰었으면(오늘 브리핑이 이미 있음) "준비 중"에 멈춰 있지 않게 되돌린다
      if (!started) {
        setRunning(false)
        setProgress(null)
        void load()
      }
    })
  }, [load])

  const patchEntry = useCallback((itemId: number, patch: Partial<DigestEntryDTO>) => {
    setDigest((d) => (d ? { ...d, entries: d.entries.map((e) => (e.itemId === itemId ? { ...e, ...patch } : e)) } : d))
  }, [])

  return { digest, loading, running, progress, error, runNow, patchEntry }
}
