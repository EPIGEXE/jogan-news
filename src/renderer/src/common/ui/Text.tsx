// ============================================================================
// 글자 부품
//
// [역할]
// - 지면의 작은 글자 부품 모음 (섹션 이름 · 분류 표시 · 원제 · 작은 정보 · 안내 글자 · 설명 문장)
// - 글자 모양은 모두 디자인 토큰 유틸리티로만 지정
// ============================================================================
import type { ReactNode } from 'react'
import { cn } from '@/common/lib/cn'

/**
 * 명조 강조색 섹션 이름
 *
 * @returns {JSX.Element} as로 고른 태그(기본 div)의 섹션 이름
 */
export function SectionLabel({ children, as: LabelElement = 'div' }: { children: ReactNode; as?: 'div' | 'h2' | 'h3' }) {
    return <LabelElement className="font-display text-label font-bold tracking-label text-accent">{children}</LabelElement>
}

/**
 * 기사 위 분류 표시
 *
 * @returns {JSX.Element} 강조색 굵은 글자의 분류 이름
 */
export function Kicker({ children }: { children: ReactNode }) {
    return <div className="text-meta font-bold tracking-kicker text-accent">{children}</div>
}

/**
 * 이탤릭 원제
 *
 * @returns {JSX.Element} 흐린 이탤릭 글자의 원제 (truncate가 켜져 있으면 한 줄로 자름)
 */
export function OriginalTitle({ children, truncate = false }: { children: ReactNode; truncate?: boolean }) {
    return <div className={cn('text-meta italic text-ink-faint', truncate && 'truncate')}>{children}</div>
}

/**
 * 출처 · 점수 같은 작은 정보
 *
 * @returns {JSX.Element} 숫자 폭을 맞춘 작은 글자
 */
export function MetaText({ children }: { children: ReactNode }) {
    return <span className="text-meta text-ink-muted tabular-nums">{children}</span>
}

/**
 * 가장 작은 안내 글자 (저장 상태 · 단축키 등)
 *
 * @returns {JSX.Element} 가장 작고 흐린 글자
 */
export function Caption({ children }: { children: ReactNode }) {
    return <span className="text-caption text-ink-faint tabular-nums">{children}</span>
}

/**
 * 설명 문장
 *
 * @returns {JSX.Element} 작은 글자의 설명 문단
 */
export function HelpText({ children, role }: { children: ReactNode; role?: string }) {
    return (
        <p className="text-meta text-ink-muted" role={role}>
            {children}
        </p>
    )
}
