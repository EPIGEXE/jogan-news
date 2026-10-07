import { useEffect } from 'react'

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

interface Options {
  ids: number[]
  selectedId: number | null
  onSelect(id: number): void
  onSave?(): void
  onMemo?(): void
  onOpen?(): void
}

/** 목록 단축키: J/K(↓/↑) 이동, S 저장, M 메모, Enter 원문. 입력란에 쓰는 중에는 동작하지 않는다 */
export function useListKeys({ ids, selectedId, onSelect, onSave, onMemo, onOpen }: Options): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.ctrlKey || e.altKey || e.metaKey) return
      const i = selectedId === null ? -1 : ids.indexOf(selectedId)
      const key = e.key.toLowerCase()
      if (key === 'j' || e.key === 'ArrowDown') {
        const next = ids[Math.min(ids.length - 1, i + 1)]
        if (next !== undefined) onSelect(next)
      } else if (key === 'k' || e.key === 'ArrowUp') {
        const prev = ids[Math.max(0, i - 1)]
        if (prev !== undefined) onSelect(prev)
      } else if (key === 's' && onSave) onSave()
      else if (key === 'm' && onMemo) onMemo()
      else if (e.key === 'Enter' && onOpen) onOpen()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ids, selectedId, onSelect, onSave, onMemo, onOpen])
}
