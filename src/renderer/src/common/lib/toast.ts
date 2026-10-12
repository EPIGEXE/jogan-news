// ============================================================================
// 알림 보관소
//
// [역할]
// - 동작 결과를 잠깐 알려주는 짧은 알림을 어디서든 띄울 수 있게 함 (예: "메모에 추가했습니다")
// - 떠 있는 알림 목록 보관 (최근 3개까지), 시간이 지나면 자동으로 제거
// - 알림 목록이 바뀔 때마다 화면(Toaster)에 전달
// ============================================================================
import { useEffect, useState } from 'react'

export interface ToastItem {
    id: number
    message: string
    leaving: boolean // 사라지는 중 (사라지는 움직임을 보여준 뒤 목록에서 제거)
}

export const TOAST_DURATION_MS = 2400 // 보여주는 시간 (tokens.css의 --animate-timer, 남은 시간 선과 같아야 함)
const TOAST_LEAVE_MS = 160 // 사라지는 움직임 시간 (--animate-paper-out)
let nextToastId = 1 // 다음 알림에 붙일 번호
let activeToasts: ToastItem[] = [] // 지금 떠 있는 알림 목록
const toastListeners = new Set<(toasts: ToastItem[]) => void>() // 목록이 바뀔 때 알려줄 구독자들

// 바뀐 알림 목록을 구독자 모두에게 전달
function emit(): void {
    for (const toastListener of toastListeners) toastListener(activeToasts)
}

/**
 * 짧은 알림 띄우기
 *
 * - 가장 최근 3개까지만 유지 (더 오래된 알림은 바로 제거)
 * - 보여주는 시간이 지나면 사라지는 중으로 표시, 사라지는 움직임이 끝나면 목록에서 제거
 *
 * @param {string} message - 알림에 보여줄 글
 * @returns {void}
 */
export function toast(message: string): void {
    const newToast: ToastItem = { id: nextToastId++, message, leaving: false }
    activeToasts = [...activeToasts.slice(-2), newToast]
    emit()
    setTimeout(() => {
        activeToasts = activeToasts.map((activeToast) => (activeToast.id === newToast.id ? { ...activeToast, leaving: true } : activeToast))
        emit()
    }, TOAST_DURATION_MS)
    setTimeout(() => {
        activeToasts = activeToasts.filter((activeToast) => activeToast.id !== newToast.id)
        emit()
    }, TOAST_DURATION_MS + TOAST_LEAVE_MS)
}

/**
 * 지금 떠 있는 알림 목록 구독
 *
 * @returns {ToastItem[]} 알림 목록 (바뀔 때마다 다시 렌더)
 */
export function useToasts(): ToastItem[] {
    const [subscribedToasts, setSubscribedToasts] = useState(activeToasts)

    // 알림 목록 변경 구독
    useEffect(() => {
        toastListeners.add(setSubscribedToasts)
        return () => {
            toastListeners.delete(setSubscribedToasts)
        }
    }, [])

    return subscribedToasts
}
