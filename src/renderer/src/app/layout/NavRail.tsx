// ============================================================================
// 왼쪽 메뉴
//
// [역할]
// - 제호와 화면 이동 메뉴 표시 (위쪽 항목 · 아래쪽 항목)
// - 지금 보고 있는 화면의 메뉴 항목 강조
// - 맨 아래에 작은 정보 자리 제공 (이번 달 비용 등)
// ============================================================================
import type { ReactNode } from 'react'
import type { Route } from '@shared/ipc'
import { cn } from '@/common/lib/cn'
import { Masthead } from '@/common/ui/Masthead'

export interface NavItem {
    route: Route // 눌렀을 때 이동할 화면
    label: string
    count?: number // 이름 옆에 보여줄 숫자 (없으면 표시 안 함)
}

interface Props {
    mainItems: NavItem[] // 메뉴 위쪽 항목
    footerItems: NavItem[] // 메뉴 아래쪽 항목
    currentRoute: Route // 지금 보고 있는 화면
    onNavigate(route: Route): void
    footerContent?: ReactNode // 맨 아래 작은 정보 (이번 달 비용 등)
}

// 메뉴 항목 하나 (ruled면 넓은 화면에서 아래 괘선 표시)
function NavButton({
    item,
    isCurrent,
    ruled,
    onNavigate
}: {
    item: NavItem
    isCurrent: boolean
    ruled: boolean
    onNavigate(route: Route): void
}) {
    return (
        <button
            type="button"
            aria-current={isCurrent ? 'page' : undefined}
            data-current={isCurrent || undefined}
            onClick={() => onNavigate(item.route)}
            className={cn(
                'group flex min-h-10 cursor-pointer items-center justify-between border-0 bg-transparent p-0 text-left text-ink-secondary hover:text-ink',
                'data-current:font-bold data-current:text-ink',
                ruled && 'wide:border-b wide:border-rule'
            )}
        >
            <span className="border-accent group-data-current:border-b-2">{item.label}</span>
            {item.count !== undefined && <span className="text-meta font-normal text-ink-muted tabular-nums">{item.count}</span>}
        </button>
    )
}

/**
 * 왼쪽 메뉴 (제호 + 메뉴 + 하단 정보)
 *
 * @returns {JSX.Element} 주 메뉴 영역
 */
export function NavRail({ mainItems, footerItems, currentRoute, onNavigate, footerContent }: Props) {
    return (
        <nav aria-label="주 메뉴" className="flex h-full flex-col gap-0.5 px-5 py-4 wide:min-h-full wide:py-6">
            {/* 제호 */}
            <Masthead />

            {/* 위쪽 메뉴 */}
            <div className="mt-3 flex flex-wrap gap-4 wide:flex-col wide:gap-0">
                {mainItems.map((navItem) => (
                    <NavButton
                        key={navItem.route}
                        item={navItem}
                        isCurrent={navItem.route === currentRoute}
                        ruled
                        onNavigate={onNavigate}
                    />
                ))}
            </div>
            <div className="hidden flex-1 wide:block" />

            {/* 아래쪽 메뉴와 하단 정보 */}
            <div className="flex flex-col gap-1 border-t border-rule pt-2">
                {footerItems.map((footerNavItem) => (
                    <NavButton
                        key={footerNavItem.route}
                        item={footerNavItem}
                        isCurrent={footerNavItem.route === currentRoute}
                        ruled={false}
                        onNavigate={onNavigate}
                    />
                ))}
                {footerContent}
            </div>
        </nav>
    )
}
