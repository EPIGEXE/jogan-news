// ============================================================================
// 탭
//
// [역할]
// - 밑줄형 탭 묶음 표시 (신문 섹션 표시처럼 고른 탭에만 강조색 밑줄)
// - 탭을 바꾸면 밑줄이 고른 탭으로 미끄러지는 움직임 표시
// ============================================================================
import { cn } from '@/common/lib/cn'
import { useSlidingIndicator } from '@/common/lib/useSlidingIndicator'

export interface TabItem<T extends string> {
    id: T
    label: string
    disabled?: boolean
    title?: string // 마우스를 올렸을 때 보이는 도움말
}

// T는 value(현재 상태)에서만 추론 (items의 리터럴이 string으로 넓어져 타입이 흐려지는 것을 막기 위함)
interface Props<T extends string> {
    items: TabItem<NoInfer<T>>[]
    value: T // 지금 고른 탭의 id
    onChange: (id: NoInfer<T>) => void
    label: string // 화면 낭독기용 묶음 이름
    tone?: 'body' | 'display' // display는 명조 글꼴 탭 (기사 패널의 메모 / 질문)
    scroll?: boolean // 한 줄로 두고 넘치면 가로로 스크롤 (분류 필터처럼 개수가 바뀌는 탭)
}

/**
 * 밑줄형 탭
 *
 * - 신문 섹션 표시처럼 활성 탭에만 강조색 밑줄
 * - 탭을 바꾸면 밑줄이 자를 대고 옮기듯 미끄러져 감
 *
 * @returns {JSX.Element} 하나만 고를 수 있는 탭 묶음
 */
export function Tabs<T extends string>({ items, value, onChange, label, tone = 'body', scroll = false }: Props<T>) {
    // =============================== 훅 ===================================
    // 고른 탭의 위치 · 크기 (밑줄을 그 자리에 놓는 용도). 고른 탭 · 탭 개수 · 탭 이름이 바뀌면 다시 잼
    const indicator = useSlidingIndicator<HTMLDivElement>('[aria-selected="true"]', [
        value,
        items.length,
        items.map((tabItem) => tabItem.label).join()
    ])

    return (
        <div
            ref={indicator.containerRef}
            role="tablist"
            aria-label={label}
            className={cn('relative flex gap-x-5 gap-y-1', scroll ? 'flex-nowrap overflow-x-auto whitespace-nowrap pb-1' : 'flex-wrap')}
        >
            {/* 고른 탭으로 미끄러지는 밑줄 */}
            <span
                aria-hidden="true"
                className={cn('pointer-events-none absolute top-0 left-0', indicator.shouldAnimate && 'slide-indicator')}
                style={indicator.indicatorStyle}
            >
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />
            </span>

            {/* 탭 버튼 */}
            {items.map((tabItem) => (
                <button
                    key={tabItem.id}
                    type="button"
                    role="tab"
                    aria-selected={tabItem.id === value}
                    disabled={tabItem.disabled}
                    title={tabItem.title}
                    className={cn(
                        'flex-none cursor-pointer border-0 border-b-2 border-transparent bg-transparent p-0 text-ink-muted',
                        'aria-selected:font-bold aria-selected:text-ink',
                        'disabled:cursor-default disabled:text-ink-faint',
                        tone === 'display' ? 'min-h-9 font-display' : 'min-h-8'
                    )}
                    onClick={() => onChange(tabItem.id)}
                >
                    {tabItem.label}
                </button>
            ))}
        </div>
    )
}
