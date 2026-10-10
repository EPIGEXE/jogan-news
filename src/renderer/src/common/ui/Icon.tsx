import type { SVGProps } from 'react'

// 선 아이콘 모음. 글자색(currentColor)을 따른다.

const PATHS = {
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  pencil: 'M4 20h4L19 9l-4-4L4 16z',
  chat: 'M4 5h16v11H9l-5 4z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  check: 'M5 12l5 5L20 7'
} as const

export type IconName = keyof typeof PATHS

interface Props extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
  filled?: boolean
}

export function Icon({ name, size = 16, filled = false, ...rest }: Props) {
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
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
