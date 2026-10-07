import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Icon, type IconName } from './Icon'

// 높이·여백·테두리 색은 변형마다 따로 준다. 기본 클래스와 겹치면 Tailwind에서 어느 쪽이 이길지 보장되지 않는다.
const VARIANT = {
  solid: 'min-h-10 px-4 border-ink bg-ink text-ink-inverse hover:enabled:bg-ink-body',
  outline: 'min-h-10 px-4 border-control-border text-ink hover:enabled:border-ink',
  text: 'border-transparent text-ink-muted underline underline-offset-3 hover:enabled:text-ink'
} as const

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANT
  icon?: IconName
  iconFilled?: boolean
  children: ReactNode
}

export function Button({ variant = 'outline', icon, iconFilled, children, className, type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-control border',
        'transition-colors duration-120 disabled:cursor-default disabled:opacity-55',
        VARIANT[variant],
        className
      )}
      {...rest}
    >
      {icon && <Icon name={icon} filled={iconFilled} />}
      {children}
    </button>
  )
}
