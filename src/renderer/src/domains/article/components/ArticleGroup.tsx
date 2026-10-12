// ============================================================================
// 기사 묶음
//
// [역할]
// - 섹션 이름과 그 아래 기사 행들을 한 묶음으로 표시
// ============================================================================
import type { ReactNode } from 'react'
import { SectionLabel } from '@/common/ui/Text'

/**
 * 섹션 이름 + 기사 행 묶음
 *
 * - 선택 배경이 여백까지 닿도록 목록을 좌우로 살짝 넓힘
 *
 * @returns {JSX.Element} 섹션 이름과 기사 행 목록
 */
export function ArticleGroup({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="pt-4">
            <SectionLabel as="h2">{label}</SectionLabel>
            <ol className="-mx-3 mt-1 list-none p-0">{children}</ol>
        </div>
    )
}
