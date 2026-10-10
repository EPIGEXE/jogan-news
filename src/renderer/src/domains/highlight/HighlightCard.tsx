import { useEffect, useState } from 'react'
import type { HighlightDTO } from '@shared/types'
import { Button } from '@/common/ui/Button'

interface Props {
  highlight: HighlightDTO
  /** 하이라이트(<mark>)의 화면 위치. 카드는 그 위(자리가 없으면 아래)에 뜬다 */
  anchor: DOMRect
  onSaveNote(note: string): void
  onAsk(): void
  onRemove(): void
  /** 카드 위에 마우스가 있는 동안은 닫히지 않게 */
  onPointerEnter(): void
  onPointerLeave(): void
}

const WIDTH = 288
const GAP = 8

/**
 * 본문의 하이라이트에 마우스를 올리면 뜨는 작은 종이 카드: 메모 보기·고치기, 이 부분 질문, 지우기.
 * 하이라이트 탭에 가지 않아도 본문에서 바로 다룰 수 있게 한다.
 */
export function HighlightCard({ highlight, anchor, onSaveNote, onAsk, onRemove, onPointerEnter, onPointerLeave }: Props) {
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState(highlight.note)
  useEffect(() => {
    setNote(highlight.note)
    setEditing(false)
  }, [highlight.id, highlight.note])

  // 창 안에 들어오게: 가로는 하이라이트 가운데 기준으로 맞추고, 위에 자리가 없으면 아래에 둔다
  const left = Math.max(GAP, Math.min(window.innerWidth - WIDTH - GAP, anchor.left + anchor.width / 2 - WIDTH / 2))
  const above = anchor.top > 180
  const position = above ? { left, bottom: window.innerHeight - anchor.top + GAP } : { left, top: anchor.bottom + GAP }

  const save = () => {
    setEditing(false)
    if (note !== highlight.note) onSaveNote(note.trim())
  }

  return (
    <div
      role="dialog"
      aria-label="하이라이트"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className="fixed z-20 flex w-72 animate-paper-drop flex-col gap-2 rounded-control border border-rule-strong bg-paper-raised p-3"
      // 위치는 하이라이트 자리에 따라 실행 중에 정해지는 값이라 인라인 style로 준다
      style={position}
    >
      <span className="font-display text-caption font-bold tracking-label text-accent">
        ¶{highlight.paragraph} 하이라이트{highlight.variant === 'original' ? ' · 원문' : ''}
      </span>
      {editing ? (
        <>
          <label htmlFor={`hl-card-${highlight.id}`} className="sr-only">
            하이라이트 메모
          </label>
          <textarea
            id={`hl-card-${highlight.id}`}
            autoFocus
            rows={3}
            value={note}
            placeholder="메모 덧붙이기"
            onChange={(e) => setNote(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              // Enter로 저장, Shift+Enter 줄바꿈, Esc 취소 (한글 조합 중에는 저장하지 않음)
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                save()
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setNote(highlight.note)
                setEditing(false)
              }
            }}
            className="w-full resize-y rounded-control border border-rule bg-paper-input px-2 py-1 text-body text-ink-body placeholder:text-ink-faint focus:border-ink"
          />
        </>
      ) : highlight.note ? (
        <p className="whitespace-pre-wrap text-body text-ink-body">{highlight.note}</p>
      ) : (
        <p className="text-meta text-ink-muted">메모 없음</p>
      )}
      <div className="flex flex-wrap gap-x-4 border-t border-rule-soft pt-2">
        {!editing && (
          <Button variant="text" onClick={() => setEditing(true)}>
            {highlight.note ? '메모 고치기' : '메모 쓰기'}
          </Button>
        )}
        <Button variant="text" onClick={onAsk}>
          이 부분 질문
        </Button>
        <Button variant="text" onClick={onRemove}>
          지우기
        </Button>
      </div>
    </div>
  )
}
