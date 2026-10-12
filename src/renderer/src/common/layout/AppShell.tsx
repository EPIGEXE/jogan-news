// ============================================================================
// 앱 화면 틀
//
// [역할]
// - 창을 메뉴 · 목록 · 기사 패널 세 단으로 나누는 틀 제공
// - 좁은 창에서는 위아래로 쌓고, 넓은 창(900px 이상)에서는 나란히 배치
// - 기사 패널 너비를 끌어서 바꾸는 손잡이 연결
// ============================================================================
import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/common/lib/cn'
import { ResizeHandle, useResizableWidth } from '@/common/layout/ResizeHandle'

/**
 * 앱 전체 틀 (왼쪽 메뉴 + 오른쪽 본문 영역)
 *
 * @returns {JSX.Element} 메뉴와 본문 영역을 담은 틀
 */
export function AppShell({ nav, children }: { nav: ReactNode; children: ReactNode }) {
    return (
        <div className="flex min-h-full flex-wrap items-stretch bg-paper wide:h-full wide:flex-nowrap wide:overflow-hidden">
            {/* 왼쪽 메뉴 */}
            <div className="basis-full border-b border-rule wide:min-w-48 wide:max-w-52 wide:grow wide:basis-52 wide:border-r wide:border-b-0">
                {nav}
            </div>

            {/* 본문 영역 */}
            <div className="flex min-w-0 grow-999 basis-110 flex-wrap items-stretch wide:flex-nowrap">{children}</div>
        </div>
    )
}

/**
 * 가운데 목록 단
 *
 * @returns {JSX.Element} 넓은 창에서 따로 스크롤되는 목록 영역
 */
export function ListPane({ children, label }: { children: ReactNode; label: string }) {
    return (
        <section aria-label={label} className="min-w-0 grow-999 basis-110 border-rule wide:h-full wide:overflow-y-auto wide:border-r">
            {children}
        </section>
    )
}

/**
 * 오른쪽 기사 패널 단
 *
 * - 넓은 창에서는 왼쪽 경계선을 끌어 너비 변경 (오늘 · 라이브러리 · 검색 결과가 같은 너비를 쓰고, 이 PC에 기억)
 * - 좁은 창에서는 목록 아래로 내려감
 *
 * @returns {JSX.Element} 너비 조절 손잡이가 달린 기사 패널 영역
 */
export function DetailPane({ children, label }: { children: ReactNode; label: string }) {
    // =============================== 훅 ===================================
    const detailPaneResize = useResizableWidth('ainews.detailPaneWidth', 460, 320, 720) // 기사 패널 너비 (기본 460px, 320 ~ 720px)

    return (
        <div
            // 너비는 끌어서 바꾸는 값이라 CSS 변수로 전달. 손잡이가 스크롤에 밀려나지 않도록 스크롤 상자 바깥에 배치
            style={{ '--detail-w': `${detailPaneResize.width}px` } as CSSProperties}
            className={cn(
                'relative min-w-0 grow basis-100 wide:h-full wide:w-(--detail-w) wide:flex-none wide:basis-auto',
                detailPaneResize.easing && 'width-ease'
            )}
        >
            {/* 너비 조절 손잡이 */}
            <ResizeHandle {...detailPaneResize} label="기사 패널 너비" className="hidden wide:block" />

            {/* 기사 패널 내용 */}
            <aside aria-label={label} className="h-full bg-paper-raised wide:overflow-y-auto">
                {children}
            </aside>
        </div>
    )
}

/**
 * 목록 · 패널로 나누지 않는 화면의 단
 *
 * @returns {JSX.Element} 본문 영역 전체를 쓰는 한 단
 */
export function SinglePane({ children, label }: { children: ReactNode; label: string }) {
    return (
        <section aria-label={label} className="min-w-0 flex-auto wide:h-full wide:overflow-y-auto">
            {children}
        </section>
    )
}
