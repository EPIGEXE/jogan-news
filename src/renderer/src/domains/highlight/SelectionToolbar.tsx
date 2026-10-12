// ============================================================================
// 선택 도구 막대
//
// [역할]
// - 본문 문장을 드래그하면 선택 영역 위에 뜨는 작은 도구 막대 (하이라이트 · 질문)
// - 선택이 풀리거나 스크롤하면 숨김
// ============================================================================
import { useEffect, useState, type RefObject } from 'react'
import { rangesFromSelection } from '@/domains/highlight/highlight'

interface Props {
    containerRef: RefObject<HTMLElement | null> // 본문을 감싼 요소, 이 안의 문단을 선택했을 때만 표시
    onHighlight(): void
    onAsk(): void
}

// 도구 막대를 띄울 화면 위치 (창 기준)
interface Spot {
    top: number
    left: number
}

/**
 * 본문 문장을 드래그하면 선택 영역 위에 뜨는 작은 도구 막대 (하이라이트 / 질문)
 *
 * - 선택이 풀리거나 스크롤하면 사라짐
 * - 창 기준(fixed) 위치라 스크롤 상자가 몇 겹이어도 맞음
 *
 * @returns {JSX.Element | null} 도구 막대 (본문 안의 선택이 없으면 null)
 */
export function SelectionToolbar({ containerRef, onHighlight, onAsk }: Props) {
    // =============================== 상태 ===================================
    const [spot, setSpot] = useState<Spot | null>(null) // 도구 막대 위치 (숨길 때는 null)

    // =============================== useEffect ===================================
    // 선택 · 스크롤을 지켜보며 도구 막대 위치 갱신
    useEffect(() => {
        const updateSpot = () => {
            const containerElement = containerRef.current
            const selection = window.getSelection()
            if (!containerElement || !selection || selection.rangeCount === 0 || rangesFromSelection(containerElement).length === 0)
                return setSpot(null)
            const selectionRect = selection.getRangeAt(0).getBoundingClientRect()
            setSpot({ top: Math.max(8, selectionRect.top - 44), left: selectionRect.left + selectionRect.width / 2 })
        }
        const hideToolbar = () => setSpot(null)
        // 드래그가 끝났을 때(mouseup)와 키보드로 선택을 바꿨을 때 위치를 다시 계산
        const onMouseOrKeyUp = () => setTimeout(updateSpot, 0)
        const onSelectionChange = () => {
            if (window.getSelection()?.isCollapsed) hideToolbar()
        }
        document.addEventListener('mouseup', onMouseOrKeyUp)
        document.addEventListener('keyup', onMouseOrKeyUp)
        document.addEventListener('selectionchange', onSelectionChange)
        window.addEventListener('scroll', hideToolbar, true)
        return () => {
            document.removeEventListener('mouseup', onMouseOrKeyUp)
            document.removeEventListener('keyup', onMouseOrKeyUp)
            document.removeEventListener('selectionchange', onSelectionChange)
            window.removeEventListener('scroll', hideToolbar, true)
        }
    }, [containerRef])

    if (!spot) return null

    return (
        <div
            role="toolbar"
            aria-label="선택한 문장"
            // 버튼을 누를 때 선택이 풀리지 않게 막음
            onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
            className="fixed z-20 flex -translate-x-1/2 border border-rule-strong bg-ink text-ink-inverse"
            // 위치는 선택 영역에 따라 실행 중에 바뀌는 값이라 인라인 style로 지정
            style={{ top: spot.top, left: spot.left }}
        >
            <button
                type="button"
                onClick={onHighlight}
                className="min-h-9 cursor-pointer border-0 bg-transparent px-3 text-meta font-bold text-ink-inverse hover:bg-ink-secondary"
            >
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
