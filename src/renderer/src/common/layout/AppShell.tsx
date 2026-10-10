import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/common/lib/cn'
import { ResizeHandle, useResizableWidth } from '@/common/layout/ResizeHandle'

// 3단 구성: 메뉴 / 목록 / 기사 패널. 좁은 창에서는 위아래로 쌓이고, wide(900px) 이상에서 나란히 선다.

/** 앱 전체 틀: 왼쪽 메뉴 + 오른쪽 본문 영역 */
export function AppShell({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-wrap items-stretch bg-paper wide:h-full wide:flex-nowrap wide:overflow-hidden">
      <div className="basis-full border-b border-rule wide:min-w-48 wide:max-w-52 wide:grow wide:basis-52 wide:border-r wide:border-b-0">
        {nav}
      </div>
      <div className="flex min-w-0 grow-999 basis-110 flex-wrap items-stretch wide:flex-nowrap">{children}</div>
    </div>
  )
}

/** 가운데 목록 단 */
export function ListPane({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section
      aria-label={label}
      className="min-w-0 grow-999 basis-110 border-rule wide:h-full wide:overflow-y-auto wide:border-r"
    >
      {children}
    </section>
  )
}

/**
 * 오른쪽 기사 패널 단. 넓은 창에서는 왼쪽 경계선을 끌어 너비를 바꾼다(오늘·라이브러리·검색 결과가 같은 너비를 쓰고, 이 PC에 기억).
 * 좁은 창에서는 목록 아래로 내려간다.
 */
export function DetailPane({ children, label }: { children: ReactNode; label: string }) {
  const pane = useResizableWidth('ainews.detailPaneWidth', 460, 320, 720)
  return (
    <div
      // 너비는 끌어서 바꾸는 값이라 CSS 변수로 넘긴다. 손잡이가 스크롤에 밀려나지 않게 스크롤 상자 바깥에 둔다
      style={{ '--detail-w': `${pane.width}px` } as CSSProperties}
      className={cn('relative min-w-0 grow basis-100 wide:h-full wide:w-(--detail-w) wide:flex-none wide:basis-auto', pane.easing && 'width-ease')}
    >
      <ResizeHandle {...pane} label="기사 패널 너비" className="hidden wide:block" />
      <aside aria-label={label} className="h-full bg-paper-raised wide:overflow-y-auto">
        {children}
      </aside>
    </div>
  )
}

/** 목록·패널로 나누지 않는 화면 */
export function SinglePane({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section aria-label={label} className="min-w-0 flex-auto wide:h-full wide:overflow-y-auto">
      {children}
    </section>
  )
}
