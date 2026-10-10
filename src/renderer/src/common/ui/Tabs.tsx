import { cn } from '@/common/lib/cn'
import { useSlidingIndicator } from '@/common/lib/useSlidingIndicator'

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
  /** 한 줄로 두고 넘치면 가로로 스크롤 (분류 필터처럼 개수가 바뀌는 탭) */
  scroll?: boolean
}

/** 밑줄형 탭. 신문 섹션 표시처럼 활성 탭에만 강조색 밑줄 — 탭을 바꾸면 밑줄이 자를 대고 옮기듯 미끄러져 간다 */
export function Tabs<T extends string>({ items, value, onChange, label, tone = 'body', scroll = false }: Props<T>) {
  const indicator = useSlidingIndicator<HTMLDivElement>('[aria-selected="true"]', [value, items.length, items.map((i) => i.label).join()])
  return (
    <div
      ref={indicator.container}
      role="tablist"
      aria-label={label}
      className={cn('relative flex gap-x-5 gap-y-1', scroll ? 'flex-nowrap overflow-x-auto whitespace-nowrap pb-1' : 'flex-wrap')}
    >
      <span
        aria-hidden="true"
        className={cn('pointer-events-none absolute top-0 left-0', indicator.animate && 'slide-indicator')}
        style={indicator.style}
      >
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />
      </span>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={it.id === value}
          disabled={it.disabled}
          title={it.title}
          className={cn(
            'flex-none cursor-pointer border-0 border-b-2 border-transparent bg-transparent p-0 text-ink-muted',
            'aria-selected:font-bold aria-selected:text-ink',
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
