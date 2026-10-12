// ============================================================================
// 목록 줄의 읽기 버튼
//
// [역할]
// - 기사 목록 한 줄 오른쪽에 읽기 화면으로 가는 버튼 표시
// - 선택한 줄에는 항상 표시, 다른 줄은 마우스를 올렸을 때만 표시
// ============================================================================
import { cn } from '@/common/lib/cn'

/**
 * 목록 한 줄 오른쪽의 "읽기" 버튼
 *
 * - 선택한 줄에는 항상 표시, 다른 줄은 마우스를 올렸을 때 표시
 * - 줄을 감싼 요소에 group/row와 relative 필요
 * - 탭 순서에서 제외 (키보드로는 목록에서 Enter가 같은 동작)
 *
 * @returns {JSX.Element} 읽기 버튼
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
