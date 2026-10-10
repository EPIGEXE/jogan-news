import { cn } from '@/common/lib/cn'

/**
 * 목록 한 줄 오른쪽의 "읽기" 버튼. 선택한 줄에는 늘 보이고, 다른 줄은 마우스를 올렸을 때 보인다.
 * 줄을 감싼 요소에 group/row와 relative가 있어야 한다. 키보드로는 목록에서 Enter가 같은 동작이라 탭 순서에서 뺀다.
 */
export function RowReadButton({
  selected,
  onClick,
  label = '읽기',
  title = '기사 읽기 (Enter)'
}: {
  selected: boolean
  onClick(): void
  label?: string
  title?: string
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onClick}
      title={title}
      className={cn(
        'absolute top-3 right-3 min-h-8 cursor-pointer items-center rounded-control border px-3 text-meta font-bold transition-colors duration-120',
        selected
          ? 'inline-flex animate-nudge-in border-ink bg-ink text-ink-inverse'
          : 'hidden border-control-border bg-paper-input text-ink-secondary group-hover/row:inline-flex hover:border-ink hover:text-ink'
      )}
    >
      {label} →
    </button>
  )
}
