import { useCallback, useEffect, useRef, useState } from 'react'
import type { DigestEntryDTO, ItemDetailDTO } from '@shared/types'
import type { BodyMode } from '../components/article/ArticleBody'
import { api } from './api'
import { toast } from './toast'

/** 기사 패널·읽기 화면이 보여주는 기사 한 건 (브리핑 항목과 기사 상세의 공통 부분) */
export type ArticleView = Omit<DigestEntryDTO, 'rank' | 'section'>

/** 기사 한 건에 대한 사용자 동작 */
export interface ArticleHandlers {
  onToggleSave(): void
  onSaveMemo(body: string): Promise<{ savedAt: string }>
  onAddTag(name: string): void
  onRemoveTag(name: string): void
  onOpenUrl(url: string): void
}

/**
 * 기사 한 건의 상세(본문 문단 등)를 불러온다.
 * 저장 후 뒤에서 본문 추출·태그 추천이 끝나면(item-updated) 다시 불러오고 onUpdated로 알린다.
 */
export function useItemDetail(itemId: number | null, onUpdated?: (d: ItemDetailDTO) => void) {
  const [detail, setDetail] = useState<ItemDetailDTO | null>(null)
  const [enriching, setEnriching] = useState(false)
  const current = useRef(itemId)
  const cb = useRef(onUpdated)
  current.current = itemId
  cb.current = onUpdated

  // 다른 기사로 넘어간 뒤 늦게 도착한 응답은 버린다
  const load = useCallback(async (id: number) => {
    const d = await api.getItem(id)
    if (current.current === id) setDetail(d)
    return d
  }, [])

  useEffect(() => {
    setDetail(null)
    setEnriching(false)
    if (itemId === null) return
    void load(itemId)
    return api.onItemUpdated((updated) => {
      if (updated !== itemId) return
      setEnriching(false)
      void load(itemId).then((d) => d && cb.current?.(d))
    })
  }, [itemId, load])

  return { detail, enriching, setEnriching }
}

/**
 * 저장·메모·태그 동작. DB에 저장하고 화면 상태는 patch로 바로 고친다.
 * 저장하면 뒤에서 본문 추출·태그 추천이 돌기 시작하므로 onEnrichStart를 부른다.
 */
export function makeArticleHandlers(
  entry: ArticleView | null,
  patch: (itemId: number, p: Partial<ArticleView>) => void,
  onEnrichStart?: () => void
): ArticleHandlers | null {
  if (!entry) return null
  const id = entry.itemId
  return {
    onToggleSave: () => {
      const saved = !entry.isSaved
      patch(id, { isSaved: saved })
      void api.setSaved(id, saved).then(() => toast(saved ? '저장했습니다' : '저장을 해제했습니다'))
      if (saved) onEnrichStart?.()
    },
    onSaveMemo: async (body) => {
      const r = await api.saveMemo(id, body)
      // 메모를 쓴 기사는 자동으로 저장된다 (DESIGN.md 6.3절)
      if (body.trim()) {
        if (!entry.isSaved) onEnrichStart?.()
        patch(id, { memo: body, isSaved: true })
      } else {
        patch(id, { memo: '' })
      }
      return r
    },
    onAddTag: (name) => void api.addTag(id, name).then((tags) => patch(id, { tags })),
    onRemoveTag: (name) => void api.removeTag(id, name).then((tags) => patch(id, { tags })),
    onOpenUrl: (url) => void api.openExternal(url)
  }
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
