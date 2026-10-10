import { useCallback, useEffect, useRef, useState } from 'react'
import type { DigestEntryDTO, ItemDetailDTO } from '@shared/types'
import type { BodyMode } from '@/domains/article/ArticleBody'
import { api } from '@/common/lib/api'

/** 기사 패널·읽기 화면이 보여주는 기사 한 건 (브리핑 항목과 기사 상세의 공통 부분) */
export type ArticleView = Omit<DigestEntryDTO, 'rank' | 'section'>

/** 기사 한 건에 대한 사용자 동작 (domains/article/queries.ts의 useArticleActions가 만든다) */
export interface ArticleHandlers {
  onToggleSave(): void
  onSaveMemo(body: string): Promise<{ savedAt: string }>
  onAddTag(name: string): void
  onRemoveTag(name: string): void
  onOpenUrl(url: string): void
}

/**
 * 번역이 아직 없는 기사를 열면 번역을 요청한다 (절약 모드였거나 브리핑 밖에서 저장한 기사).
 * 끝나면 Worker가 item-updated를 보내 useItemDetail이 다시 불러온다. 기사마다 한 번만 자동 요청하고, 실패하면 retry로 다시 한다.
 */
export function useAutoTranslate(detail: ItemDetailDTO | null) {
  const requested = useRef(new Set<number>())
  const [running, setRunning] = useState<number | null>(null)
  const [failed, setFailed] = useState<number | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!detail || detail.translation !== 'missing' || requested.current.has(detail.itemId)) return
    const id = detail.itemId
    requested.current.add(id)
    setRunning(id)
    setFailed((f) => (f === id ? null : f))
    void api
      .translateItem(id)
      .then((ok) => {
        if (!ok) setFailed(id)
      })
      .catch(() => setFailed(id))
      .finally(() => setRunning((r) => (r === id ? null : r)))
  }, [detail, attempt])

  const id = detail?.itemId ?? null
  return {
    translating: id !== null && running === id,
    failed: id !== null && failed === id && detail?.translation === 'missing',
    retry: () => {
      if (id === null) return
      requested.current.delete(id)
      setAttempt((n) => n + 1)
    }
  }
}

const BODY_MODE_KEY = 'ainews.bodyMode'

/** 본문 보기 방식(한국어·원문·함께). 이 PC에서 마지막에 고른 값을 기억한다 */
export function useBodyMode() {
  const [mode, setMode] = useState<BodyMode>(() => {
    try {
      const v = localStorage.getItem(BODY_MODE_KEY)
      return v === 'original' || v === 'both' ? v : 'ko'
    } catch {
      return 'ko'
    }
  })
  const change = useCallback((m: BodyMode) => {
    setMode(m)
    try {
      localStorage.setItem(BODY_MODE_KEY, m)
    } catch {
      // 저장 못 해도 이번 화면에서는 바뀐 값을 쓴다
    }
  }, [])
  return [mode, change] as const
}
