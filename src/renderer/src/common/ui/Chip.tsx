// ============================================================================
// 칩 버튼
//
// [역할]
// - 일반 버튼보다 가벼운 작은 선택 버튼 표시 (빠른 질문 등)
// ============================================================================
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * 작은 선택 버튼 (빠른 질문 등, 일반 버튼보다 가볍게)
 *
 * @returns {JSX.Element} 칩 모양 버튼
 */
export function Chip({
    children,
    className,
    type = 'button',
    ...buttonAttributes
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
    return (
        <button
            type={type}
            className={`inline-flex min-h-8 cursor-pointer items-center rounded-control border border-rule bg-paper-input px-3 text-meta text-ink-secondary transition-colors duration-120 hover:enabled:border-ink hover:enabled:text-ink disabled:cursor-default disabled:text-ink-faint ${className ?? ''}`}
            {...buttonAttributes}
        >
            {children}
        </button>
    )
}
