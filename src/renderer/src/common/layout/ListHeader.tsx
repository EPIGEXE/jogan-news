// ============================================================================
// 목록 머리
//
// [역할]
// - 라이브러리 · 아카이브 목록 위에 제목과 검색 · 필터 영역 표시
// ============================================================================
import type { ReactNode } from 'react'

/**
 * 목록 머리 (명조 제목 + 이중선 + 검색 · 필터)
 *
 * @returns {JSX.Element} 제목 줄과 그 아래 검색 · 필터 영역
 */
export function ListHeader({ title, meta, children }: { title: string; meta?: ReactNode; children?: ReactNode }) {
    return (
        <header className="flex flex-col gap-3 border-b-3 border-double border-rule-strong pb-4">
            {/* 제목 줄 (오른쪽에 보조 정보) */}
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h1 className="font-display text-headline font-bold tracking-tight">{title}</h1>
                {meta && <span className="text-meta text-ink-muted tabular-nums">{meta}</span>}
            </div>

            {/* 검색 · 필터 */}
            {children}
        </header>
    )
}
