// ============================================================================
// 버튼
//
// [역할]
// - 앱 공통 버튼 표시 (채움 · 외곽선 · 글자만 세 가지 모양)
// - 글자 앞에 아이콘 표시 (아이콘이 채워지는 순간 도장 찍는 움직임)
// ============================================================================
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/common/lib/cn'
import { Icon, type IconName } from '@/common/ui/Icon'

// 버튼 모양별 클래스
// 높이 · 여백 · 테두리 색은 모양마다 따로 지정 (기본 클래스와 겹치면 Tailwind에서 어느 쪽이 이길지 보장되지 않음)
// 비활성은 채움 없이 흐린 외곽선으로 표시 (회색 채움은 "누를 수 있는 버튼"처럼 보임)
const VARIANT_CLASSES = {
    solid: 'min-h-10 px-4 border-ink bg-ink text-ink-inverse hover:enabled:bg-ink-body disabled:border-rule disabled:bg-transparent disabled:text-ink-faint',
    outline: 'min-h-10 px-4 border-control-border text-ink hover:enabled:border-ink disabled:border-rule disabled:text-ink-faint',
    text: 'border-transparent text-ink-muted underline underline-offset-3 hover:enabled:text-ink disabled:text-ink-faint disabled:no-underline'
} as const

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: keyof typeof VARIANT_CLASSES // 버튼 모양 (기본은 외곽선)
    icon?: IconName // 글자 앞에 붙일 아이콘
    iconFilled?: boolean // 아이콘을 채워서 그릴지 (저장됨 같은 켜진 상태 표시)
    children: ReactNode
}

// 아이콘이 비었다가 채워질 때마다 바뀌는 값 (처음 그릴 때는 0). 저장했을 때 도장 찍는 움직임에 사용
function useStampKey(isIconFilled: boolean | undefined): number {
    const [stampKey, setStampKey] = useState(0)
    const previousIconFilledRef = useRef(isIconFilled) // 직전 렌더의 채움 여부

    // 비어 있던 아이콘이 채워진 순간에만 값 증가
    useEffect(() => {
        if (isIconFilled && previousIconFilledRef.current === false) setStampKey((previousStampKey) => previousStampKey + 1)
        previousIconFilledRef.current = isIconFilled
    }, [isIconFilled])

    return stampKey
}

/**
 * 앱 공통 버튼
 *
 * - type을 주지 않으면 'button'
 *
 * @returns {JSX.Element} 아이콘(있으면)과 글자를 담은 버튼
 */
export function Button({ variant = 'outline', icon, iconFilled, children, className, type = 'button', ...buttonAttributes }: Props) {
    // =============================== 훅 ===================================
    const stampKey = useStampKey(iconFilled) // 아이콘이 채워질 때마다 바뀌는 값 (도장 움직임을 다시 시작시키는 용도)

    return (
        <button
            type={type}
            className={cn(
                'inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-control border',
                'transition-colors duration-120 disabled:cursor-default',
                VARIANT_CLASSES[variant],
                className
            )}
            {...buttonAttributes}
        >
            {icon && (
                // 채워지는 순간 도장처럼 찍히는 아이콘
                <span key={stampKey} className={cn('inline-flex', stampKey > 0 && 'animate-stamp')}>
                    <Icon name={icon} filled={iconFilled} />
                </span>
            )}
            {children}
        </button>
    )
}
