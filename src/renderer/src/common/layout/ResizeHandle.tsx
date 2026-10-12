// ============================================================================
// 너비 조절 손잡이
//
// [역할]
// - 단의 경계선을 끌어서 너비를 바꾸는 손잡이 표시 (키보드 ← / → 로도 조절)
// - 바꾼 너비를 이 PC에 기억했다가 다음에 그대로 사용
// - 너비가 창의 절반을 넘지 않도록 제한 (옆의 목록 · 본문이 밀려나거나 아래로 떨어지지 않게 하기 위함)
// ============================================================================
import { useCallback, useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '@/common/lib/cn'

// 값을 최소 · 최대 사이로 맞춤
const clamp = (value: number, lowerBound: number, upperBound: number) => Math.max(lowerBound, Math.min(upperBound, value))

/**
 * 끌어서 바꾸는 너비 관리 (마지막 값을 이 PC에 기억)
 *
 * - 창 너비의 절반을 넘지 않게 제한 (옆의 목록 · 본문이 밀려나거나 아래로 떨어지지 않게 하기 위함)
 * - 창을 줄이면 너비도 같이 줄어듦
 *
 * @param {string} storageKey - 너비를 기억해 둘 저장소 이름
 * @param {number} initialWidth - 기억한 값이 없을 때와 기본 너비로 되돌릴 때 쓰는 너비 (px)
 * @param {number} minWidth - 가장 좁은 너비 (px)
 * @param {number} maxWidth - 가장 넓은 너비 (px)
 * @returns {{ width: number, setWidth: (requestedWidth: number) => void, reset: () => void, min: number, max: number, easing: boolean }} 지금 너비와 너비를 바꾸는 함수들 (max는 창 너비까지 반영한 한도)
 */
export function useResizableWidth(storageKey: string, initialWidth: number, minWidth: number, maxWidth: number) {
    // =============================== 상태 ===================================
    // 기억해 둔 너비 (저장소를 읽지 못하거나 값이 없으면 기본 너비)
    const [storedWidth, setStoredWidth] = useState(() => {
        try {
            return Number(localStorage.getItem(storageKey)) || initialWidth
        } catch {
            return initialWidth
        }
    })
    const [windowWidth, setWindowWidth] = useState(() => window.innerWidth) // 지금 창 너비
    const [isEasing, setIsEasing] = useState(false) // 기본 너비로 돌아갈 때만 잠깐 부드럽게 움직이는 중인지 (끄는 중에는 바로 따라와야 하므로 끔)

    // =============================== 계산 ===================================
    const maxAllowedWidth = Math.max(minWidth, Math.min(maxWidth, Math.floor(windowWidth / 2))) // 지금 창에서 허용하는 가장 넓은 너비 (창의 절반까지)
    const width = clamp(storedWidth, minWidth, maxAllowedWidth) // 실제로 쓰는 너비

    // 너비 변경 (허용 범위로 맞춘 뒤 이 PC에 기억)
    const setWidth = useCallback(
        (requestedWidth: number) => {
            const clampedWidth = clamp(
                Math.round(requestedWidth),
                minWidth,
                Math.max(minWidth, Math.min(maxWidth, Math.floor(window.innerWidth / 2)))
            )
            setStoredWidth(clampedWidth)
            try {
                localStorage.setItem(storageKey, String(clampedWidth))
            } catch {
                // 기억하지 못해도 이번 화면에서는 바뀐 너비 사용
            }
        },
        [storageKey, minWidth, maxWidth]
    )

    // 기본 너비로 되돌림 (두 번 눌렀을 때)
    const reset = () => {
        setIsEasing(true)
        setWidth(initialWidth)
        setTimeout(() => setIsEasing(false), 220)
    }

    // =============================== useEffect ===================================
    // 창 크기가 바뀌면 창 너비 갱신
    useEffect(() => {
        const handleWindowResize = () => setWindowWidth(window.innerWidth)
        window.addEventListener('resize', handleWindowResize)
        return () => window.removeEventListener('resize', handleWindowResize)
    }, [])

    return { width, setWidth, reset, min: minWidth, max: maxAllowedWidth, easing: isEasing }
}

interface Props {
    width: number // 지금 너비 (px)
    setWidth(requestedWidth: number): void // 끌거나 키보드로 조절할 때 호출
    reset(): void // 두 번 눌렀을 때 호출 (기본 너비로 복귀)
    min: number
    max: number
    label: string // 화면 낭독기와 도움말에 쓰는 이름
    className?: string
}

const KEYBOARD_WIDTH_STEP = 24 // 키보드로 한 번에 바꾸는 너비 (px)

/**
 * 오른쪽 단의 왼쪽 경계에 두는 너비 조절 손잡이
 *
 * - 왼쪽으로 끌면 넓어짐
 * - 키보드 ← / → 로 조절, 두 번 누르면 기본 너비로 복귀
 *
 * @returns {JSX.Element} 경계선 위에 겹쳐 놓는 손잡이
 */
export function ResizeHandle({ width, setWidth, reset, min, max, label, className }: Props) {
    // =============================== 상태 ===================================
    const [isDragging, setIsDragging] = useState(false) // 끄는 중인지

    // =============================== 계산 ===================================
    // 끄는 동안은 창 전체에서 마우스 움직임 수신 (손잡이가 좁아서 금방 벗어나도 계속 따라오게 하기 위함)
    const onPointerDown = (pointerDownEvent: PointerEvent<HTMLDivElement>) => {
        pointerDownEvent.preventDefault()
        const startX = pointerDownEvent.clientX
        const startWidth = width
        setIsDragging(true)
        document.body.style.cursor = 'col-resize'
        const handlePointerMove = (pointerMoveEvent: globalThis.PointerEvent) => setWidth(startWidth + (startX - pointerMoveEvent.clientX))
        const stopDragging = () => {
            setIsDragging(false)
            document.body.style.cursor = ''
            window.removeEventListener('pointermove', handlePointerMove)
            window.removeEventListener('pointerup', stopDragging)
            window.removeEventListener('pointercancel', stopDragging)
        }
        window.addEventListener('pointermove', handlePointerMove)
        window.addEventListener('pointerup', stopDragging)
        window.addEventListener('pointercancel', stopDragging)
    }

    // 키보드 조절 (← 넓게, → 좁게)
    const onKeyDown = (keyboardEvent: KeyboardEvent<HTMLDivElement>) => {
        if (keyboardEvent.key === 'ArrowLeft') setWidth(width + KEYBOARD_WIDTH_STEP)
        else if (keyboardEvent.key === 'ArrowRight') setWidth(width - KEYBOARD_WIDTH_STEP)
        else return
        keyboardEvent.preventDefault()
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
            className={cn(
                'group/handle absolute inset-y-0 -left-1.5 z-20 w-3 cursor-col-resize touch-none focus-visible:outline-none',
                className
            )}
        >
            {/* 보이는 선: 평소에는 괘선과 겹치고, 마우스를 올리거나 끄는 중에는 강조색 */}
            <span
                className={cn(
                    'absolute inset-y-0 left-1.5 w-px transition-colors duration-120',
                    isDragging ? 'bg-accent' : 'bg-transparent group-hover/handle:bg-ink-faint group-focus-visible/handle:bg-accent'
                )}
            />
        </div>
    )
}
