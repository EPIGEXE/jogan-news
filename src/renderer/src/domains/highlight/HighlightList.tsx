import { useEffect, useState } from 'react'
import type { HighlightDTO } from '@shared/types'
import { cn } from '@/common/lib/cn'
import { Button } from '@/common/ui/Button'
import { Help } from '@/common/ui/Text'

interface Props {
  highlights: HighlightDTO[]
  /** 본문에서 하이라이트를 눌러 들어왔을 때 강조할 항목 */
  activeId: number | null
  onGoTo(h: HighlightDTO): void
  onAsk(h: HighlightDTO): void
  onSaveNote(id: number, note: string): void
  onRemove(id: number): void
}

/** 하이라이트 메모 한 줄. 입력을 마치고 나가면(blur) 저장한다 */
function NoteInput({ h, onSave }: { h: HighlightDTO; onSave(note: string): void }) {
  const [value, setValue] = useState(h.note)
  useEffect(() => setValue(h.note), [h.note])
  return (
    <>
      <label className="sr-only" htmlFor={`hl-note-${h.id}`}>
        하이라이트 메모
      </label>
      <textarea
        id={`hl-note-${h.id}`}
        rows={value ? 2 : 1}
        value={value}
        placeholder="메모 덧붙이기"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value !== h.note && onSave(value)}
        className="w-full resize-y rounded-control border border-rule bg-paper-input px-2 py-1 text-body text-ink-body placeholder:text-ink-faint focus:border-ink"
      />
    </>
  )
}

/** 읽기 화면의 "하이라이트" 탭: 그은 문장을 본문 순서대로 모아 보여준다 */
export function HighlightList({ highlights, activeId, onGoTo, onAsk, onSaveNote, onRemove }: Props) {
  useEffect(() => {
    if (activeId !== null) document.getElementById(`hl-${activeId}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  if (highlights.length === 0) {
    return <Help>본문에서 문장을 드래그한 뒤 "하이라이트"(H)를 누르면 여기에 모입니다. 하이라이트를 그은 기사는 자동으로 저장됩니다.</Help>
  }
  return (
    <ol className="m-0 flex list-none flex-col gap-5 p-0">
      {highlights.map((h) => (
        <li
          key={h.id}
          id={`hl-${h.id}`}
          className={cn('-mx-2 flex flex-col gap-2 px-2 py-2 transition-colors duration-120', activeId === h.id && 'bg-paper-sunken')}
        >
          <button
            type="button"
            onClick={() => onGoTo(h)}
            title="본문에서 보기"
            className="cursor-pointer border-0 border-l-3 border-highlight bg-transparent py-0.5 pr-0 pl-3 text-left text-reading text-ink-body hover:text-ink"
          >
            <span className="mr-2 font-display text-caption text-ink-faint">
              ¶{h.paragraph}
              {h.variant === 'original' ? ' 원문' : ''}
            </span>
            {h.text}
          </button>
          <NoteInput h={h} onSave={(note) => onSaveNote(h.id, note)} />
          <div className="flex gap-4">
            <Button variant="text" onClick={() => onAsk(h)}>
              이 부분 질문
            </Button>
            <Button variant="text" onClick={() => onRemove(h.id)}>
              지우기
            </Button>
          </div>
        </li>
      ))}
    </ol>
  )
}
