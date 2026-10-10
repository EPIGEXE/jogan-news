import type { ButtonHTMLAttributes, ReactNode } from 'react'

/** 작은 선택 버튼 (빠른 질문 등). 일반 버튼보다 가볍게 */
export function Chip({ children, className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-8 cursor-pointer items-center rounded-control border border-rule bg-paper-input px-3 text-meta text-ink-secondary transition-colors duration-120 hover:enabled:border-ink hover:enabled:text-ink disabled:cursor-default disabled:text-ink-faint ${className ?? ''}`}
      {...rest}
    >
      {children}
    </button>
  )
}
