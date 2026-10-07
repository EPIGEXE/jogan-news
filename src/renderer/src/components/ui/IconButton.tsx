import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'
import { Icon, type IconName } from './Icon'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName
  /** 아이콘만 있는 버튼이므로 화면 낭독기용 이름이 꼭 필요하다 */
  label: string
  active?: boolean
}

export function IconButton({ icon, label, active = false, className, type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'inline-flex size-10 flex-none cursor-pointer items-center justify-center rounded-control border transition-colors duration-120',
        active ? 'border-accent text-accent' : 'border-rule text-ink-muted hover:border-ink hover:text-ink',
        className
      )}
      {...rest}
    >
      <Icon name={icon} filled={active} />
    </button>
  )
}
