import { useEffect, useState } from 'react'

// 동작 결과를 잠깐 알려주는 짧은 알림 ("메모에 추가했습니다"). 어디서든 toast()로 띄우고 Toaster가 그린다.

export interface ToastItem {
  id: number
  message: string
  /** 사라지는 중 (사라지는 움직임을 보여준 뒤 목록에서 뺀다) */
  leaving: boolean
}

/** 보여주는 시간. tokens.css의 --animate-timer(남은 시간 선)와 같아야 한다 */
export const TOAST_DURATION_MS = 2400
/** 사라지는 움직임 시간 (--animate-paper-out) */
const LEAVE_MS = 160
let nextId = 1
let items: ToastItem[] = []
const listeners = new Set<(items: ToastItem[]) => void>()

function emit(): void {
  for (const l of listeners) l(items)
}

export function toast(message: string): void {
  const item: ToastItem = { id: nextId++, message, leaving: false }
  items = [...items.slice(-2), item]
  emit()
  setTimeout(() => {
    items = items.map((t) => (t.id === item.id ? { ...t, leaving: true } : t))
    emit()
  }, TOAST_DURATION_MS)
  setTimeout(() => {
    items = items.filter((t) => t.id !== item.id)
    emit()
  }, TOAST_DURATION_MS + LEAVE_MS)
}

export function useToasts(): ToastItem[] {
  const [value, setValue] = useState(items)
  useEffect(() => {
    listeners.add(setValue)
    return () => {
      listeners.delete(setValue)
    }
  }, [])
  return value
}
