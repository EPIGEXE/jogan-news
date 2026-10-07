import type { ReactNode } from 'react'

// 3단 구성: 메뉴 / 목록 / 기사 패널. 좁은 창에서는 위아래로 쌓이고, wide(900px) 이상에서 나란히 선다.

/** 앱 전체 틀: 왼쪽 메뉴 + 오른쪽 본문 영역 */
export function AppShell({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-wrap items-stretch bg-paper">
      <div className="basis-full border-b border-rule wide:min-w-48 wide:max-w-52 wide:grow wide:basis-52 wide:border-r wide:border-b-0">
        {nav}
      </div>
      <div className="flex min-w-0 grow-999 basis-110 flex-wrap items-stretch">{children}</div>
    </div>
  )
}

/** 가운데 목록 단 */
export function ListPane({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section
      aria-label={label}
      className="min-w-0 grow-999 basis-110 border-rule wide:h-screen wide:overflow-y-auto wide:border-r"
    >
      {children}
    </section>
  )
}

/** 오른쪽 기사 패널 단 */
export function DetailPane({ children, label }: { children: ReactNode; label: string }) {
  return (
    <aside aria-label={label} className="min-w-0 grow basis-100 bg-paper-raised wide:h-screen wide:max-w-115 wide:overflow-y-auto">
      {children}
    </aside>
  )
}

/** 목록·패널로 나누지 않는 화면 */
export function SinglePane({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section aria-label={label} className="min-w-0 flex-auto wide:h-screen wide:overflow-y-auto">
      {children}
    </section>
  )
}
