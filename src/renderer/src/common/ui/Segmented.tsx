// ============================================================================
// 전환기
//
// [역할]
// - 붙어 있는 버튼 묶음에서 하나를 고르는 전환기 표시 (예: 본문 한국어 / 원문 / 함께 보기)
// - 고른 쪽으로 검은 칸이 미끄러지는 움직임 표시
// ============================================================================
import { cn } from '@/common/lib/cn'
import { useSlidingIndicator } from '@/common/lib/useSlidingIndicator'

export interface SegmentItem<T extends string> {
    id: T
    label: string
    title?: string // 마우스를 올렸을 때 보이는 도움말
}

interface Props<T extends string> {
    items: SegmentItem<NoInfer<T>>[]
    value: T // 지금 고른 항목의 id
    onChange: (id: NoInfer<T>) => void
    label: string // 화면 낭독기용 묶음 이름
}

/**
 * 붙어 있는 버튼 묶음에서 하나를 고르는 전환기 (예: 본문 한국어 / 원문 / 함께 보기)
 *
 * - 검은 칸이 고른 쪽으로 미끄러짐
 *
 * @returns {JSX.Element} 하나만 고를 수 있는 버튼 묶음
 */
export function Segmented<T extends string>({ items, value, onChange, label }: Props<T>) {
    // =============================== 훅 ===================================
    const indicator = useSlidingIndicator<HTMLDivElement>('[aria-checked="true"]', [value]) // 고른 버튼의 위치 · 크기 (검은 칸을 그 자리에 놓는 용도)

    return (
        <div
            ref={indicator.containerRef}
            role="radiogroup"
            aria-label={label}
            className="relative inline-flex flex-none border border-control-border bg-paper-input"
        >
            {/* 고른 쪽으로 미끄러지는 검은 칸 */}
            <span
                aria-hidden="true"
                className={cn('pointer-events-none absolute top-0 left-0 bg-ink', indicator.shouldAnimate && 'slide-indicator')}
                style={indicator.indicatorStyle}
            />

            {/* 항목 버튼 */}
            {items.map((segmentItem, segmentIndex) => (
                <button
                    key={segmentItem.id}
                    type="button"
                    role="radio"
                    aria-checked={segmentItem.id === value}
                    title={segmentItem.title}
                    onClick={() => onChange(segmentItem.id)}
                    className={cn(
                        'relative min-h-8 cursor-pointer border-0 bg-transparent px-3 text-meta text-ink-secondary transition-colors duration-200 hover:text-ink',
                        'aria-checked:font-bold aria-checked:text-ink-inverse',
                        segmentIndex > 0 && 'border-l border-control-border'
                    )}
                >
                    {segmentItem.label}
                </button>
            ))}
        </div>
    )
}
