// ============================================================================
// 대화 쿼리 훅
//
// [역할]
// - 대화 데이터를 읽고 바꾸는 훅 모음
// - 지난 대화를 범위(기사 하나 또는 그날 브리핑)별로 캐시에 보관
// - 빠른 질문 버튼 목록 조회, 질문 보내기 · 대화 지우기
// ============================================================================
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { ChatMessageDTO, ChatScope, QuickActions } from '@shared/types'
import { api } from '@/common/lib/api'
import { queryKeys } from '@/common/lib/queryKeys'

const NO_SCOPE: ChatScope = { kind: 'item', itemId: -1 } // 범위가 없을 때 쿼리 키 자리를 채우는 값 (이때는 조회하지 않음)
const NO_CHAT_MESSAGES: ChatMessageDTO[] = [] // 대화가 아직 없을 때 돌려주는 빈 목록 (매번 같은 배열)

/**
 * 대화 캐시 끝에 메시지 하나 추가 (보낸 질문, 다 받은 답변)
 *
 * @param {QueryClient} queryClient - 쿼리 캐시
 * @param {ChatScope} scope - 대화 범위 (기사 하나 또는 그날 브리핑)
 * @param {ChatMessageDTO} message - 붙일 메시지
 * @returns {void}
 */
export function appendChatMessage(queryClient: QueryClient, scope: ChatScope, message: ChatMessageDTO): void {
    queryClient.setQueryData<ChatMessageDTO[]>(queryKeys.chat(scope), (chatMessages) => [...(chatMessages ?? []), message])
}

// =============================== 조회 ===================================

/**
 * 한 범위의 지난 대화 조회 (다른 기사를 보고 돌아와도 바로 표시)
 *
 * @param {ChatScope | null} scope - 대화 범위 (null이면 조회하지 않음)
 * @returns {ChatMessageDTO[]} 지난 대화 (없거나 읽기 전이면 빈 배열)
 */
export function useChatMessagesQuery(scope: ChatScope | null): ChatMessageDTO[] {
    return (
        useQuery({ queryKey: queryKeys.chat(scope ?? NO_SCOPE), queryFn: () => api.getChat(scope!), enabled: scope !== null }).data ??
        NO_CHAT_MESSAGES
    )
}

/**
 * 빠른 질문 버튼 목록 조회 (config/quick-actions.yaml)
 *
 * - 앱이 켜져 있는 동안 한 번만 읽음
 *
 * @returns {QuickActions | null} 빠른 질문 목록 (읽기 전이면 null)
 */
export function useQuickActionsQuery(): QuickActions | null {
    return useQuery({ queryKey: queryKeys.quickActions, queryFn: () => api.getQuickActions() }).data ?? null
}

// =============================== 변경 ===================================

/**
 * 질문 보내기
 *
 * - 보낸 질문을 대화에 붙이고 requestId를 돌려줌 (답변 조각은 그 requestId로 따로 도착)
 *
 * @returns {UseMutationResult<{ requestId: string, userMessage: ChatMessageDTO }>} 범위(scope)와 질문(question)을 받는 요청 훅
 */
export function useAskChatMutation() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ scope, question }: { scope: ChatScope; question: string }) => api.ask(scope, question),
        onSuccess: ({ userMessage }, { scope }) => appendChatMessage(queryClient, scope, userMessage)
    })
}

/**
 * 대화 지우기
 *
 * @returns {UseMutationResult<void>} 범위(scope)를 받는 요청 훅
 */
export function useClearChatMutation() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (scope: ChatScope) => api.clearChat(scope),
        onSuccess: (_data, scope) => queryClient.setQueryData(queryKeys.chat(scope), [])
    })
}
