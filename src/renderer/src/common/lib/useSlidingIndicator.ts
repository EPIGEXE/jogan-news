// ============================================================================
// 미끄러지는 표시
//
// [역할]
// - 탭의 밑줄 · 전환기의 검은 칸처럼 고른 항목 아래로 미끄러져 가는 표시의 위치 계산
// - 고른 항목이 바뀌거나 컨테이너 크기가 바뀌면 위치 다시 계산
// - 처음 그릴 때는 움직임 없이 제자리에 놓고, 그 뒤 바뀔 때만 미끄러지게 함
// ============================================================================
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

/**
 * 고른 항목 아래로 미끄러져 가는 표시의 위치 재기
 *
 * - 컨테이너 안에서 activeSelector에 맞는 요소의 위치 · 크기를 읽어 표시에 넘길 style 생성
 * - 맞는 요소가 없으면 표시를 숨김
 * - 처음 그릴 때는 움직이지 않고 제자리에 놓이고, 그 뒤 바뀔 때만 미끄러짐
 *
 * @param {string} activeSelector - 고른 항목을 찾는 CSS 선택자
 * @param {unknown[]} deps - 바뀌면 위치를 다시 잴 값들 (고른 항목 등)
 * @returns {{ container: RefObject<T | null>, style: CSSProperties | undefined, animate: boolean }} 컨테이너에 달 ref, 표시에 넘길 style, 움직임을 켤지
 */
export function useSlidingIndicator<T extends HTMLElement>(activeSelector: string, deps: unknown[]) {
    // =============================== 상태 ===================================
    const [activeBox, setActiveBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null) // 고른 항목의 위치 · 크기 (없으면 null)
    const [isPositioned, setIsPositioned] = useState(false) // 첫 위치를 잡은 뒤인지 (움직임을 켜도 되는지)

    // =============================== Ref ===================================
    const containerRef = useRef<T>(null) // 항목들을 담은 컨테이너

    // =============================== 계산 ===================================
    const indicatorStyle: CSSProperties | undefined = activeBox
        ? { width: activeBox.width, height: activeBox.height, transform: `translate(${activeBox.x}px, ${activeBox.y}px)` }
        : { display: 'none' }

    // =============================== useEffect ===================================
    // 고른 항목의 위치 재기 (컨테이너 크기가 바뀔 때도 다시 잼)
    useLayoutEffect(() => {
        const containerElement = containerRef.current
        if (!containerElement) return
        const measureActiveBox = () => {
            const activeElement = containerElement.querySelector<HTMLElement>(activeSelector)
            setActiveBox(
                activeElement
                    ? {
                          x: activeElement.offsetLeft,
                          y: activeElement.offsetTop,
                          width: activeElement.offsetWidth,
                          height: activeElement.offsetHeight
                      }
                    : null
            )
        }
        measureActiveBox()
        // 첫 위치를 잡은 다음 프레임부터 움직임 켜기
        const animationFrameId = requestAnimationFrame(() => setIsPositioned(true))
        const resizeObserver = new ResizeObserver(measureActiveBox)
        resizeObserver.observe(containerElement)
        return () => {
            cancelAnimationFrame(animationFrameId)
            resizeObserver.disconnect()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 고른 항목이 바뀔 때 다시 잼
    }, deps)

    return { containerRef, indicatorStyle, shouldAnimate: isPositioned }
}
