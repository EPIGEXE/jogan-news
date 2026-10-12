// ============================================================================
// 단일 단 화면의 지면 틀
//
// [역할]
// - 목록 · 패널로 나누지 않는 화면(설정 · 진단 · 준비 중 화면)의 본문 틀 제공
// - 화면 제목 · 섹션 · 가로 줄 같은 공통 배치 부품 모음
// ============================================================================
import type { ReactNode } from 'react'
import { SectionLabel } from '@/common/ui/Text'

/**
 * 화면 본문 틀 (너비 제한 + 바깥 여백)
 *
 * @returns {JSX.Element} 내용을 위에서 아래로 쌓는 본문 영역
 */
export function PageBody({ children }: { children: ReactNode }) {
    return <div className="flex max-w-190 flex-col gap-6 px-7 pt-6 pb-7">{children}</div>
}

/**
 * 화면 제목 (명조 제목 + 이중선)
 *
 * @returns {JSX.Element} 화면 맨 위 제목
 */
export function PageTitle({ children }: { children: string }) {
    return (
        <h1 className="border-b-3 border-double border-rule-strong pb-3 font-display text-headline font-bold tracking-tight">{children}</h1>
    )
}

/**
 * 화면 안의 한 섹션 (섹션 이름 + 오른쪽 보조 정보 + 내용 + 아래 괘선)
 *
 * @returns {JSX.Element} 섹션 이름 줄과 내용
 */
export function PageSection({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-3 border-b border-rule pb-5">
            {/* 섹션 이름 줄 (오른쪽에 보조 정보) */}
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <SectionLabel as="h2">{title}</SectionLabel>
                {aside}
            </div>

            {/* 섹션 내용 */}
            {children}
        </section>
    )
}

/**
 * 가로로 늘어놓는 줄 (버튼 · 입력란 묶음)
 *
 * @returns {JSX.Element} 자리가 모자라면 다음 줄로 넘어가는 가로 줄
 */
export function PageRow({ children }: { children: ReactNode }) {
    return <div className="flex flex-wrap items-center gap-3">{children}</div>
}
