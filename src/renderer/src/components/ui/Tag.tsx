import { cn } from '../../lib/cn'

interface Props {
  name: string
  /** 있으면 오른쪽에 떼기(×) 버튼 */
  onRemove?(): void
  /** 있으면 태그 자체가 필터 버튼 */
  onSelect?(): void
  selected?: boolean
  count?: number
}

/** #태그. 장식 없이 글자만, 필터로 고르면 강조색 밑줄 */
export function Tag({ name, onRemove, onSelect, selected = false, count }: Props) {
  const label = (
    <>
      #{name}
      {count !== undefined && <span className="ml-1 text-ink-faint tabular-nums">{count}</span>}
    </>
  )
  return (
    <span className="inline-flex items-center gap-1 text-meta text-ink-secondary">
      {onSelect ? (
        <button
          type="button"
          aria-pressed={selected}
          onClick={onSelect}
          className={cn(
            'cursor-pointer border-0 border-b-2 bg-transparent p-0 hover:text-ink',
            selected ? 'border-accent font-bold text-ink' : 'border-transparent'
          )}
        >
          {label}
        </button>
      ) : (
        <span>{label}</span>
      )}
      {onRemove && (
        <button
          type="button"
          aria-label={`${name} 태그 떼기`}
          title="태그 떼기"
          onClick={onRemove}
          className="cursor-pointer border-0 bg-transparent px-0.5 text-ink-faint hover:text-danger"
        >
          ×
        </button>
      )}
    </span>
  )
}
