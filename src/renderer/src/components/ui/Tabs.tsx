import { cn } from '../../lib/cn'

export interface TabItem<T extends string> {
  id: T
  label: string
  disabled?: boolean
  title?: string
}

// T는 value(현재 상태)에서만 추론한다. items의 리터럴이 string으로 넓어져 타입이 흐려지는 것을 막는다.
interface Props<T extends string> {
  items: TabItem<NoInfer<T>>[]
  value: T
  onChange: (id: NoInfer<T>) => void
  label: string
  /** display: 명조 글꼴 탭 (기사 패널의 메모/질문) */
  tone?: 'body' | 'display'
}

/** 밑줄형 탭. 신문 섹션 표시처럼 활성 탭에만 강조색 밑줄 */
export function Tabs<T extends string>({ items, value, onChange, label, tone = 'body' }: Props<T>) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-x-5 gap-y-1">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={it.id === value}
          disabled={it.disabled}
          title={it.title}
          className={cn(
            'cursor-pointer border-0 border-b-2 border-transparent bg-transparent p-0 text-ink-muted',
            'aria-selected:border-accent aria-selected:font-bold aria-selected:text-ink',
            'disabled:cursor-default disabled:text-ink-faint',
            tone === 'display' ? 'min-h-9 font-display' : 'min-h-8'
          )}
          onClick={() => onChange(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
