import { useCallback, useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '../../lib/cn'

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

/**
 * 끌어서 바꾸는 너비. 이 PC에 마지막 값을 기억한다.
 * 창 너비의 절반을 넘지 않게 해서, 옆의 목록·본문이 밀려나거나 아래로 떨어지지 않게 한다(창을 줄이면 같이 줄어듦).
 */
export function useResizableWidth(key: string, initial: number, min: number, max: number) {
  const [stored, setStored] = useState(() => {
    try {
      return Number(localStorage.getItem(key)) || initial
    } catch {
      return initial
    }
  })
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const limit = Math.max(min, Math.min(max, Math.floor(windowWidth / 2)))
  const width = clamp(stored, min, limit)

  const setWidth = useCallback(
    (w: number) => {
      const next = clamp(Math.round(w), min, Math.max(min, Math.min(max, Math.floor(window.innerWidth / 2))))
      setStored(next)
      try {
        localStorage.setItem(key, String(next))
      } catch {
        // 기억하지 못해도 이번 화면에서는 바뀐 너비를 쓴다
      }
    },
    [key, min, max]
  )
  // 두 번 눌러 기본 너비로 돌아갈 때만 잠깐 부드럽게 움직인다 (끄는 중에는 바로 따라와야 하므로 끔)
  const [easing, setEasing] = useState(false)
  const reset = () => {
    setEasing(true)
    setWidth(initial)
    setTimeout(() => setEasing(false), 220)
  }
  return { width, setWidth, reset, min, max: limit, easing }
}

interface Props {
  width: number
  setWidth(w: number): void
  reset(): void
  min: number
  max: number
  label: string
  className?: string
}

const KEY_STEP = 24

/**
 * 오른쪽 단의 왼쪽 경계에 두는 너비 조절 손잡이. 왼쪽으로 끌면 넓어진다.
 * 키보드: ←/→로 조절, 두 번 누르면 기본 너비로.
 */
export function ResizeHandle({ width, setWidth, reset, min, max, label, className }: Props) {
  const [active, setActive] = useState(false)

  // 끄는 동안은 창 전체에서 마우스 움직임을 받는다 (손잡이가 좁아서 금방 벗어나도 계속 따라오게)
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    setActive(true)
    document.body.style.cursor = 'col-resize'
    const move = (ev: globalThis.PointerEvent) => setWidth(startW + (startX - ev.clientX))
    const up = () => {
      setActive(false)
      document.body.style.cursor = ''
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') setWidth(width + KEY_STEP)
    else if (e.key === 'ArrowRight') setWidth(width - KEY_STEP)
    else return
    e.preventDefault()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label} (끌어서 조절, 두 번 누르면 기본 너비)`}
      onPointerDown={onPointerDown}
      onDoubleClick={reset}
      onKeyDown={onKeyDown}
      className={cn('group/handle absolute inset-y-0 -left-1.5 z-20 w-3 cursor-col-resize touch-none focus-visible:outline-none', className)}
    >
      {/* 보이는 선: 평소에는 괘선과 겹치고, 마우스를 올리거나 끄는 중에는 강조색 */}
      <span
        className={cn(
          'absolute inset-y-0 left-1.5 w-px transition-colors duration-120',
          active ? 'bg-accent' : 'bg-transparent group-hover/handle:bg-ink-faint group-focus-visible/handle:bg-accent'
        )}
      />
    </div>
  )
}
