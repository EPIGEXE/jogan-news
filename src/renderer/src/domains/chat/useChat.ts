// ============================================================================
// 대화 상태 훅
//
// [역할]
// - 한 범위(기사 하나 또는 그날 브리핑)의 대화와 지금 받는 답변을 한 묶음으로 제공
// - 질문을 보내고, 조각으로 오는 답변을 이어 붙여 표시
// - 답변이 끝나면 질문했던 범위의 대화에 추가
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ChatEvent, ChatMessageDTO, ChatScope } from '@shared/types'
import { api } from '@/common/lib/api'
import { appendChatMessage, useAskChatMutation, useChatMessagesQuery, useClearChatMutation } from '@/domains/chat/queries'

// 범위를 구분하는 글자 (범위가 바뀌었는지 비교하는 용도, 범위가 없으면 빈 문자열)
const scopeKeyOf = (chatScope: ChatScope | null) =>
    chatScope ? (chatScope.kind === 'item' ? `item:${chatScope.itemId}` : `digest:${chatScope.date}`) : ''

export interface ChatState {
    messages: ChatMessageDTO[]
    streamingAnswer: string | null // 지금 받고 있는 답변 (받는 중일 때만, 아니면 null)
    errorMessage: string | null
    ask(question: string): void
    clear(): void
}

/**
 * 한 범위(기사 하나 또는 그날 브리핑)의 대화
 *
 * - 지난 대화는 쿼리 캐시에 보관 (다른 기사를 보고 돌아와도 바로 보임)
 * - 지금 받는 답변 조각은 화면 상태로 보관
 * - 질문하면 답변 조각을 requestId로 골라 받음
 * - ask 응답보다 답변 조각이 먼저 도착하는 경우를 대비해 모르는 requestId의 조각은 잠시 모아 둠
 *
 * @param {ChatScope | null} scope - 대화 범위 (null이면 조회 · 질문 · 지우기 모두 하지 않음)
 * @returns {ChatState} 대화 · 받는 중인 답변 · 오류 · 질문하기 · 지우기 함수
 */
export function useChat(scope: ChatScope | null): ChatState {
    // =============================== 훅 ===================================
    const queryClient = useQueryClient()

    // =============================== 쿼리 훅 ===================================
    const messages = useChatMessagesQuery(scope)
    const { mutate: sendQuestion } = useAskChatMutation()
    const { mutate: clearChat } = useClearChatMutation()

    // =============================== 상태 ===================================
    const [streamingAnswer, setStreamingAnswer] = useState<string | null>(null) // 지금 받고 있는 답변
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    // =============================== Ref ===================================
    const pendingRequestId = useRef<string | null>(null) // 답을 기다리는 질문의 requestId (ask 응답 전에는 'pending', 없으면 null)
    const earlyChatEvents = useRef(new Map<string, ChatEvent[]>()) // ask 응답보다 먼저 도착한 답변 조각 (requestId별)
    const scopeRef = useRef(scope) // 최신 범위 (ask · clear를 다시 만들지 않고 읽는 용도)
    scopeRef.current = scope
    // 답변이 끝나면 질문할 때의 범위 캐시에 붙이기 위한 기록 (그 사이 다른 기사로 넘어가도 제자리에 들어가게)
    const askedScope = useRef<ChatScope | null>(null)

    // =============================== 계산 ===================================
    const scopeKey = scopeKeyOf(scope)

    // 답변 조각 하나 처리 (조각이면 이어 붙이고, 끝 · 오류면 받기 종료)
    const applyChatEvent = useCallback(
        (chatEvent: ChatEvent) => {
            if (chatEvent.type === 'delta') setStreamingAnswer((streamedText) => (streamedText ?? '') + chatEvent.text)
            else if (chatEvent.type === 'done') {
                if (askedScope.current) appendChatMessage(queryClient, askedScope.current, chatEvent.message)
                setStreamingAnswer(null)
                pendingRequestId.current = null
            } else {
                setErrorMessage(chatEvent.message)
                setStreamingAnswer(null)
                pendingRequestId.current = null
            }
        },
        [queryClient]
    )

    // 질문 보내기 (범위가 없거나 빈 질문이거나 답을 기다리는 중이면 무시)
    const ask = useCallback(
        (question: string) => {
            const chatScope = scopeRef.current
            const trimmedQuestion = question.trim()
            if (!chatScope || !trimmedQuestion || pendingRequestId.current) return
            setErrorMessage(null)
            setStreamingAnswer('')
            pendingRequestId.current = 'pending'
            askedScope.current = chatScope
            sendQuestion(
                { scope: chatScope, question: trimmedQuestion },
                {
                    onSuccess: ({ requestId }) => {
                        pendingRequestId.current = requestId
                        for (const earlyChatEvent of earlyChatEvents.current.get(requestId) ?? []) applyChatEvent(earlyChatEvent)
                        earlyChatEvents.current.delete(requestId)
                    },
                    onError: (askError) => {
                        setErrorMessage(askError.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
                        setStreamingAnswer(null)
                        pendingRequestId.current = null
                    }
                }
            )
        },
        [applyChatEvent, sendQuestion]
    )

    // 대화 지우기 (범위가 없거나 답을 기다리는 중이면 무시)
    const clear = useCallback(() => {
        const chatScope = scopeRef.current
        if (!chatScope || pendingRequestId.current) return
        clearChat(chatScope)
    }, [clearChat])

    // =============================== useEffect ===================================
    // 범위가 바뀌면 받던 답변 · 오류 비움
    useEffect(() => {
        setStreamingAnswer(null)
        setErrorMessage(null)
        pendingRequestId.current = null
    }, [scopeKey])

    // 답변 조각 구독 (기다리는 질문의 조각이면 바로 처리, 아니면 requestId별로 모아 둠)
    useEffect(
        () =>
            api.onChatEvent((chatEvent) => {
                if (chatEvent.requestId === pendingRequestId.current) return applyChatEvent(chatEvent)
                const eventsForRequest = earlyChatEvents.current.get(chatEvent.requestId) ?? []
                eventsForRequest.push(chatEvent)
                earlyChatEvents.current.set(chatEvent.requestId, eventsForRequest)
            }),
        [applyChatEvent]
    )

    return { messages, streamingAnswer, errorMessage, ask, clear }
}
