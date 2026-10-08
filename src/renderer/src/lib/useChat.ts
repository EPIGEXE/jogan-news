import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatEvent, ChatMessageDTO, ChatScope, QuickActions } from '@shared/types'
import { api } from './api'

const keyOf = (s: ChatScope | null) => (s ? (s.kind === 'item' ? `item:${s.itemId}` : `digest:${s.date}`) : '')

export interface ChatState {
  messages: ChatMessageDTO[]
  /** 지금 받고 있는 답변 (스트리밍 중일 때만) */
  streaming: string | null
  error: string | null
  ask(question: string): void
  clear(): void
}

/**
 * 한 범위(기사 하나 또는 그날 브리핑)의 대화. 질문하면 답변 조각을 requestId로 골라 받는다.
 * ask 응답보다 답변 조각이 먼저 도착하는 경우를 대비해, 모르는 requestId의 조각은 잠시 모아 둔다.
 */
export function useChat(scope: ChatScope | null): ChatState {
  const [messages, setMessages] = useState<ChatMessageDTO[]>([])
  const [streaming, setStreaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = useRef<string | null>(null)
  const early = useRef(new Map<string, ChatEvent[]>())
  const key = keyOf(scope)
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  const apply = useCallback((e: ChatEvent) => {
    if (e.type === 'delta') setStreaming((t) => (t ?? '') + e.text)
    else if (e.type === 'done') {
      setMessages((m) => [...m, e.message])
      setStreaming(null)
      current.current = null
    } else {
      setError(e.message)
      setStreaming(null)
      current.current = null
    }
  }, [])

  useEffect(() => {
    setMessages([])
    setStreaming(null)
    setError(null)
    current.current = null
    if (!scopeRef.current) return
    void api.getChat(scopeRef.current).then(setMessages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      api.ask(s, q).then(
        ({ requestId, userMessage }) => {
          setMessages((m) => [...m, userMessage])
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
    [apply]
  )

  const clear = useCallback(() => {
    const s = scopeRef.current
    if (!s || current.current) return
    void api.clearChat(s).then(() => setMessages([]))
  }, [])

  return { messages, streaming, error, ask, clear }
}

let quickActionsCache: Promise<QuickActions> | null = null

/** 빠른 질문 버튼 목록 (config/quick-actions.yaml). 앱이 켜져 있는 동안 한 번만 읽는다 */
export function useQuickActions(): QuickActions | null {
  const [value, setValue] = useState<QuickActions | null>(null)
  useEffect(() => {
    quickActionsCache ??= api.getQuickActions()
    void quickActionsCache.then(setValue)
  }, [])
  return value
}
