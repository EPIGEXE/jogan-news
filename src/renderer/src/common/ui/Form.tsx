// ============================================================================
// 입력 부품
//
// [역할]
// - 폼에서 쓰는 공통 부품 모음 (한 줄 입력란 · 이름 붙은 입력 묶음 · 체크박스)
// ============================================================================
import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/common/lib/cn'

// 입력란 너비별 클래스 (wide: 남는 자리를 채움, narrow: 좁은 고정 너비, auto: 지정 없음)
const WIDTH_CLASSES = { wide: 'grow basis-70', narrow: 'w-27.5', auto: '' } as const

/**
 * 한 줄 입력란
 *
 * @returns {JSX.Element} 앱 공통 모양의 input
 */
export function TextInput({
    width = 'auto',
    className,
    ...inputAttributes
}: InputHTMLAttributes<HTMLInputElement> & { width?: keyof typeof WIDTH_CLASSES }) {
    return (
        <input
            className={cn(
                'min-h-10 rounded-control border border-control-border bg-paper-input px-3 focus:border-ink',
                WIDTH_CLASSES[width],
                className
            )}
            {...inputAttributes}
        />
    )
}

/**
 * 위에 작은 이름이 붙은 입력 묶음
 *
 * @returns {JSX.Element} 이름과 입력란을 묶은 label
 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="flex flex-col gap-1 text-meta text-ink-muted">
            {label}
            {children}
        </label>
    )
}

/**
 * 체크박스 + 설명
 *
 * @returns {JSX.Element} 설명 글자를 눌러도 켜지고 꺼지는 체크박스
 */
export function Checkbox({
    children,
    ...checkboxAttributes
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { children: ReactNode }) {
    return (
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2">
            <input type="checkbox" className="size-4 accent-accent" {...checkboxAttributes} />
            {children}
        </label>
    )
}
