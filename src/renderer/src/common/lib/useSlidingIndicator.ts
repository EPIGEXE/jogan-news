import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

/**
 * 탭의 밑줄·전환기의 검은 칸처럼, 고른 항목 아래로 미끄러져 가는 표시의 위치를 잰다.
 * 컨테이너 안에서 activeSelector에 맞는 요소의 위치·크기를 읽어 표시에 넘길 style을 돌려준다.
 * 처음 그릴 때는 움직이지 않고 제자리에 놓이고, 그 뒤 바뀔 때만 미끄러진다.
 */
export function useSlidingIndicator<T extends HTMLElement>(activeSelector: string, deps: unknown[]) {
  const container = useRef<T>(null)
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [ready, setReady] = useState(false)

  useLayoutEffect(() => {
    const el = container.current
    if (!el) return
    const measure = () => {
      const active = el.querySelector<HTMLElement>(activeSelector)
      setBox(active ? { x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight } : null)
    }
    measure()
    // 첫 위치를 잡은 다음 프레임부터 움직임을 켠다
    const raf = requestAnimationFrame(() => setReady(true))
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 고른 항목이 바뀔 때 다시 잰다
  }, deps)

  const style: CSSProperties | undefined = box
    ? { width: box.w, height: box.h, transform: `translate(${box.x}px, ${box.y}px)` }
    : { display: 'none' }
  return { container, style, animate: ready }
}
