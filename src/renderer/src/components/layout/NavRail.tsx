import type { ReactNode } from 'react'
import type { Route } from '@shared/ipc'
import { cn } from '../../lib/cn'
import { Masthead } from '../ui/Masthead'

export interface NavItem {
  route: Route
  label: string
  count?: number
}

interface Props {
  items: NavItem[]
  footerItems: NavItem[]
  current: Route
  onNavigate(route: Route): void
  /** 맨 아래 작은 정보 (이번 달 비용 등) */
  footer?: ReactNode
}

function NavButton({ item, current, ruled, onNavigate }: { item: NavItem; current: boolean; ruled: boolean; onNavigate(r: Route): void }) {
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      data-current={current || undefined}
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

/** 제호, 메뉴, 하단 정보 */
export function NavRail({ items, footerItems, current, onNavigate, footer }: Props) {
  return (
    <nav aria-label="주 메뉴" className="flex h-full flex-col gap-0.5 px-5 py-4 wide:min-h-screen wide:py-6">
      <Masthead>AI 조간</Masthead>
      <div className="mt-3 flex flex-wrap gap-4 wide:flex-col wide:gap-0">
        {items.map((it) => (
          <NavButton key={it.route} item={it} current={it.route === current} ruled onNavigate={onNavigate} />
        ))}
      </div>
      <div className="hidden flex-1 wide:block" />
      <div className="flex flex-col gap-1 border-t border-rule pt-2">
        {footerItems.map((it) => (
          <NavButton key={it.route} item={it} current={it.route === current} ruled={false} onNavigate={onNavigate} />
        ))}
        {footer}
      </div>
    </nav>
  )
}
