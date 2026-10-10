import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChatEvent, ChatMessageDTO, ChatScope, QuickActions } from '@shared/types'
import { api } from '@/common/lib/api'
import { qk } from '@/common/lib/queryKeys'

const keyOf = (s: ChatScope | null) => (s ? (s.kind === 'item' ? `item:${s.itemId}` : `digest:${s.date}`) : '')
const NO_SCOPE: ChatScope = { kind: 'item', itemId: -1 }
const EMPTY: ChatMessageDTO[] = []

export interface ChatState {
  messages: ChatMessageDTO[]
  /** 지금 받고 있는 답변 (스트리밍 중일 때만) */
  streaming: string | null
  error: string | null
  ask(question: string): void
  clear(): void
}

/**
 * 한 범위(기사 하나 또는 그날 브리핑)의 대화. 지난 대화는 쿼리 캐시에 두고(다른 기사를 보고 돌아와도 바로 보임),
 * 지금 받는 답변 조각은 화면 상태로 둔다. 질문하면 답변 조각을 requestId로 골라 받고,
 * ask 응답보다 답변 조각이 먼저 도착하는 경우를 대비해 모르는 requestId의 조각은 잠시 모아 둔다.
 */
export function useChat(scope: ChatScope | null): ChatState {
  const qc = useQueryClient()
  const chatKey = qk.chat(scope ?? NO_SCOPE)
  const messages =
    useQuery({ queryKey: chatKey, queryFn: () => api.getChat(scope!), enabled: scope !== null }).data ?? EMPTY
  const append = useCallback(
    (key: readonly unknown[], m: ChatMessageDTO) => qc.setQueryData<ChatMessageDTO[]>(key, (list) => [...(list ?? []), m]),
    [qc]
  )
  const [streaming, setStreaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = useRef<string | null>(null)
  const early = useRef(new Map<string, ChatEvent[]>())
  const key = keyOf(scope)
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  // 답변이 끝나면 질문할 때의 범위 캐시에 붙인다 (그 사이 다른 기사로 넘어가도 제자리에 들어가게)
  const askedKey = useRef<readonly unknown[]>(chatKey)
  const apply = useCallback((e: ChatEvent) => {
    if (e.type === 'delta') setStreaming((t) => (t ?? '') + e.text)
    else if (e.type === 'done') {
      append(askedKey.current, e.message)
      setStreaming(null)
      current.current = null
    } else {
      setError(e.message)
      setStreaming(null)
      current.current = null
    }
  }, [append])

  useEffect(() => {
    setStreaming(null)
    setError(null)
    current.current = null
  }, [key])

  useEffect(
    () =>
      api.onChatEvent((e) => {
        if (e.requestId === current.current) return apply(e)
        const list = early.current.get(e.requestId) ?? []
        list.push(e)
        early.current.set(e.requestId, list)
      }),
    [apply]
  )

  const ask = useCallback(
    (question: string) => {
      const s = scopeRef.current
      const q = question.trim()
      if (!s || !q || current.current) return
      setError(null)
      setStreaming('')
      current.current = 'pending'
      askedKey.current = qk.chat(s)
      api.ask(s, q).then(
        ({ requestId, userMessage }) => {
          append(askedKey.current, userMessage)
          current.current = requestId
          for (const e of early.current.get(requestId) ?? []) apply(e)
          early.current.delete(requestId)
        },
        (err: Error) => {
          setError(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
          setStreaming(null)
          current.current = null
        }
      )
    },
    [apply, append]
  )

  const clear = useCallback(() => {
    const s = scopeRef.current
    if (!s || current.current) return
    void api.clearChat(s).then(() => qc.setQueryData(qk.chat(s), []))
  }, [qc])

  return { messages, streaming, error, ask, clear }
}

/** 빠른 질문 버튼 목록 (config/quick-actions.yaml). 앱이 켜져 있는 동안 한 번만 읽는다 */
export function useQuickActions(): QuickActions | null {
  return useQuery({ queryKey: qk.quickActions, queryFn: () => api.getQuickActions() }).data ?? null
}
