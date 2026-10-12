// ============================================================================
// 아이콘
//
// [역할]
// - 앱에서 쓰는 선 아이콘 모음 (북마크 · 연필 · 말풍선 · 바깥 링크 · 새로 고침 · 체크)
// - 주변 글자색을 따라 표시 (currentColor)
// ============================================================================
import type { SVGProps } from 'react'

// 아이콘 이름별 SVG 경로 (24 x 24 기준)
const ICON_PATHS = {
    bookmark: 'M6 3h12v18l-6-4-6 4z',
    pencil: 'M4 20h4L19 9l-4-4L4 16z',
    chat: 'M4 5h16v11H9l-5 4z',
    external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
    refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
    check: 'M5 12l5 5L20 7'
} as const

export type IconName = keyof typeof ICON_PATHS

interface Props extends SVGProps<SVGSVGElement> {
    name: IconName
    size?: number // 가로 · 세로 크기 (px, 기본 16)
    filled?: boolean // 선 안쪽을 글자색으로 채울지
}

/**
 * 선 아이콘
 *
 * @returns {JSX.Element} 화면 낭독기에는 숨겨지는 장식용 SVG
 */
export function Icon({ name, size = 16, filled = false, ...svgAttributes }: Props) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill={filled ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            {...svgAttributes}
        >
            <path d={ICON_PATHS[name]} />
        </svg>
    )
}
