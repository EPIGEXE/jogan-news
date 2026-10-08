import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Icon, type IconName } from './Icon'

// 높이·여백·테두리 색은 변형마다 따로 준다. 기본 클래스와 겹치면 Tailwind에서 어느 쪽이 이길지 보장되지 않는다.
// 비활성은 채움 없이 흐린 외곽선으로: 회색 채움은 "누를 수 있는 버튼"처럼 보인다.
const VARIANT = {
  solid:
    'min-h-10 px-4 border-ink bg-ink text-ink-inverse hover:enabled:bg-ink-body disabled:border-rule disabled:bg-transparent disabled:text-ink-faint',
  outline: 'min-h-10 px-4 border-control-border text-ink hover:enabled:border-ink disabled:border-rule disabled:text-ink-faint',
  text: 'border-transparent text-ink-muted underline underline-offset-3 hover:enabled:text-ink disabled:text-ink-faint disabled:no-underline'
} as const

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANT
  icon?: IconName
  iconFilled?: boolean
  children: ReactNode
}

/** 아이콘이 비었다가 채워질 때마다 바뀌는 값 (처음 그릴 때는 0). 저장했을 때 도장 찍는 움직임에 쓴다 */
function useStampKey(filled: boolean | undefined): number {
  const prev = useRef(filled)
  const [key, setKey] = useState(0)
  useEffect(() => {
    if (filled && prev.current === false) setKey((k) => k + 1)
    prev.current = filled
  }, [filled])
  return key
}

export function Button({ variant = 'outline', icon, iconFilled, children, className, type = 'button', ...rest }: Props) {
  const stamp = useStampKey(iconFilled)
  return (
    <button
      type={type}
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-control border',
        'transition-colors duration-120 disabled:cursor-default',
        VARIANT[variant],
        className
      )}
      {...rest}
    >
      {icon && (
        // 채워지는 순간 도장처럼 찍힌다
        <span key={stamp} className={cn('inline-flex', stamp > 0 && 'animate-stamp')}>
          <Icon name={icon} filled={iconFilled} />
        </span>
      )}
      {children}
    </button>
  )
}
