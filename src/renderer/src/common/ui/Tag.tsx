// ============================================================================
// 태그
//
// [역할]
// - #태그 한 개 표시 (장식 없이 글자만)
// - 쓰임에 따라 필터 버튼이 되거나 떼기(×) 버튼 추가
// ============================================================================
import { cn } from '@/common/lib/cn'

interface Props {
    name: string
    onRemove?(): void // 있으면 오른쪽에 떼기(×) 버튼 표시
    onSelect?(): void // 있으면 태그 자체가 필터 버튼
    selected?: boolean // 필터로 고른 상태인지
    count?: number // 이름 옆에 보여줄 개수
}

/**
 * #태그 (장식 없이 글자만, 필터로 고르면 강조색 밑줄)
 *
 * @returns {JSX.Element} 태그 이름과 필요에 따라 떼기 버튼
 */
export function Tag({ name, onRemove, onSelect, selected = false, count }: Props) {
    // 태그 글자 (#이름 + 개수), 필터 버튼일 때와 아닐 때 함께 사용
    const tagLabel = (
        <>
            #{name}
            {count !== undefined && <span className="ml-1 text-ink-faint tabular-nums">{count}</span>}
        </>
    )

    return (
        <span className="inline-flex items-center gap-1 text-meta text-ink-secondary">
            {/* 태그 이름 (onSelect가 있으면 필터 버튼) */}
            {onSelect ? (
                <button
                    type="button"
                    aria-pressed={selected}
                    onClick={onSelect}
                    className={cn(
                        'min-h-7 cursor-pointer border-0 border-b-2 bg-transparent px-0.5 hover:text-ink',
                        selected ? 'border-accent font-bold text-ink' : 'border-transparent'
                    )}
                >
                    {tagLabel}
                </button>
            ) : (
                <span>{tagLabel}</span>
            )}

            {/* 떼기 버튼 */}
            {onRemove && (
                <button
                    type="button"
                    aria-label={`${name} 태그 떼기`}
                    title="태그 떼기"
                    onClick={onRemove}
                    className="inline-flex size-6 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-ink-muted hover:bg-paper-sunken hover:text-danger"
                >
                    ×
                </button>
            )}
        </span>
    )
}
