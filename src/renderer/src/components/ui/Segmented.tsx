import { cn } from '../../lib/cn'
import { useSlidingIndicator } from '../../lib/useSlidingIndicator'

export interface SegmentItem<T extends string> {
  id: T
  label: string
  title?: string
}

interface Props<T extends string> {
  items: SegmentItem<NoInfer<T>>[]
  value: T
  onChange: (id: NoInfer<T>) => void
  label: string
}

/** 붙어 있는 버튼 묶음에서 하나를 고르는 전환기 (예: 본문 한국어 / 원문 / 함께 보기). 검은 칸이 고른 쪽으로 미끄러진다 */
export function Segmented<T extends string>({ items, value, onChange, label }: Props<T>) {
  const indicator = useSlidingIndicator<HTMLDivElement>('[aria-checked="true"]', [value])
  return (
    <div
      ref={indicator.container}
      role="radiogroup"
      aria-label={label}
      className="relative inline-flex flex-none border border-control-border bg-paper-input"
    >
      <span
        aria-hidden="true"
        className={cn('pointer-events-none absolute top-0 left-0 bg-ink', indicator.animate && 'slide-indicator')}
        style={indicator.style}
      />
      {items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          role="radio"
          aria-checked={it.id === value}
          title={it.title}
          onClick={() => onChange(it.id)}
          className={cn(
            'relative min-h-8 cursor-pointer border-0 bg-transparent px-3 text-meta text-ink-secondary transition-colors duration-200 hover:text-ink',
            'aria-checked:font-bold aria-checked:text-ink-inverse',
            i > 0 && 'border-l border-control-border'
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
