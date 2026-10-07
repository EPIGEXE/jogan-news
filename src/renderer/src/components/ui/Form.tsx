import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

const WIDTH = { wide: 'grow basis-70', narrow: 'w-27.5', auto: '' } as const

/** 한 줄 입력란 */
export function TextInput({ width = 'auto', className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { width?: keyof typeof WIDTH }) {
  return (
    <input
      className={cn(
        'min-h-10 rounded-control border border-control-border bg-paper-input px-3 focus:border-ink',
        WIDTH[width],
        className
      )}
      {...rest}
    />
  )
}

/** 위에 작은 이름이 붙은 입력 묶음 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-meta text-ink-muted">
      {label}
      {children}
    </label>
  )
}

/** 체크박스 + 설명 */
export function Checkbox({ children, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { children: ReactNode }) {
  return (
    <label className="inline-flex min-h-10 cursor-pointer items-center gap-2">
      <input type="checkbox" className="size-4 accent-accent" {...rest} />
      {children}
    </label>
  )
}
