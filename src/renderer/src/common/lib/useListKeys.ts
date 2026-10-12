// ============================================================================
// 목록 단축키
//
// [역할]
// - 기사 목록에서 키보드로 이동 · 저장 · 읽기 · 원문 열기
// - 입력란에 글을 쓰는 중이거나 꺼져 있으면 무시
// ============================================================================
import { useEffect } from 'react'

// 입력란에 글을 쓰는 중인지
function isTyping(keyboardEvent: KeyboardEvent): boolean {
    const targetElement = keyboardEvent.target as HTMLElement | null
    return !!targetElement && (targetElement.tagName === 'INPUT' || targetElement.tagName === 'TEXTAREA' || targetElement.isContentEditable)
}

interface Options {
    ids: number[] // 목록에 보이는 순서대로의 기사 번호
    selectedId: number | null // 지금 고른 기사 번호 (없으면 null)
    onSelect(itemId: number): void
    onSave?(): void // S: 저장 · 저장 해제
    onOpen?(): void // Enter: 기사 읽기 화면 열기
    onOpenOriginal?(): void // O: 원문 열기
    enabled?: boolean // false면 단축키 끔 (기본 true)
}

/**
 * 목록 단축키 연결
 *
 * - J · ↓ 다음 기사, K · ↑ 이전 기사, S 저장, Enter 읽기, O 원문
 * - 입력란에 쓰는 중이거나 Ctrl · Alt · Meta와 함께 누르면 무시
 * - enabled가 false면 동작 안 함
 *
 * @param {Options} options - 기사 번호 목록, 고른 기사, 키별로 부를 함수
 * @returns {void}
 */
export function useListKeys({ ids, selectedId, onSelect, onSave, onOpen, onOpenOriginal, enabled = true }: Options): void {
    // 키 입력 구독
    useEffect(() => {
        if (!enabled) return
        const onKeyDown = (keyboardEvent: KeyboardEvent) => {
            if (isTyping(keyboardEvent) || keyboardEvent.ctrlKey || keyboardEvent.altKey || keyboardEvent.metaKey) return
            const selectedIndex = selectedId === null ? -1 : ids.indexOf(selectedId)
            const lowerCaseKey = keyboardEvent.key.toLowerCase()
            if (lowerCaseKey === 'j' || keyboardEvent.key === 'ArrowDown') {
                const nextItemId = ids[Math.min(ids.length - 1, selectedIndex + 1)]
                if (nextItemId !== undefined) onSelect(nextItemId)
            } else if (lowerCaseKey === 'k' || keyboardEvent.key === 'ArrowUp') {
                const previousItemId = ids[Math.max(0, selectedIndex - 1)]
                if (previousItemId !== undefined) onSelect(previousItemId)
            } else if (lowerCaseKey === 's' && onSave) onSave()
            else if (keyboardEvent.key === 'Enter' && onOpen) onOpen()
            else if (lowerCaseKey === 'o' && onOpenOriginal) onOpenOriginal()
            else return
            keyboardEvent.preventDefault()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [ids, selectedId, onSelect, onSave, onOpen, onOpenOriginal, enabled])
}
