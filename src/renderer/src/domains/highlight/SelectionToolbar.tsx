import { useEffect, useState, type RefObject } from 'react'
import { rangesFromSelection } from '@/domains/highlight/highlight'

interface Props {
  /** 본문을 감싼 요소. 이 안의 문단을 선택했을 때만 나타난다 */
  container: RefObject<HTMLElement | null>
  onHighlight(): void
  onAsk(): void
}

interface Spot {
  top: number
  left: number
}

/**
 * 본문 문장을 드래그하면 선택 영역 위에 뜨는 작은 도구 막대: 하이라이트 / 질문.
 * 선택이 풀리거나 스크롤하면 사라진다. 창 기준(fixed) 위치라 스크롤 상자가 몇 겹이어도 맞다.
 */
export function SelectionToolbar({ container, onHighlight, onAsk }: Props) {
  const [spot, setSpot] = useState<Spot | null>(null)

  useEffect(() => {
    const update = () => {
      const el = container.current
      const sel = window.getSelection()
      if (!el || !sel || sel.rangeCount === 0 || rangesFromSelection(el).length === 0) return setSpot(null)
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      setSpot({ top: Math.max(8, rect.top - 44), left: rect.left + rect.width / 2 })
    }
    const hide = () => setSpot(null)
    // 드래그가 끝났을 때(mouseup)와 키보드로 선택을 바꿨을 때 위치를 다시 잡는다
    const onUp = () => setTimeout(update, 0)
    const onSelectionChange = () => {
      if (window.getSelection()?.isCollapsed) hide()
    }
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keyup', onUp)
    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keyup', onUp)
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('scroll', hide, true)
    }
  }, [container])

  if (!spot) return null
  return (
    <div
      role="toolbar"
      aria-label="선택한 문장"
      // 버튼을 누를 때 선택이 풀리지 않게 한다
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-20 flex -translate-x-1/2 border border-rule-strong bg-ink text-ink-inverse"
      // 위치는 선택 영역에 따라 실행 중에 바뀌는 값이라 인라인 style로 준다
      style={{ top: spot.top, left: spot.left }}
    >
      <button type="button" onClick={onHighlight} className="min-h-9 cursor-pointer border-0 bg-transparent px-3 text-meta font-bold text-ink-inverse hover:bg-ink-secondary">
        하이라이트 <span className="font-normal opacity-80">H</span>
      </button>
      <button
        type="button"
        onClick={onAsk}
        className="min-h-9 cursor-pointer border-0 border-l border-ink-secondary bg-transparent px-3 text-meta text-ink-inverse hover:bg-ink-secondary"
      >
        질문
      </button>
    </div>
  )
}
