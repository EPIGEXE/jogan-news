import type { ReactNode } from 'react'
import { SectionLabel } from '@/common/ui/Text'

/** 섹션 이름 + 기사 행 묶음. 선택 배경이 여백까지 닿도록 목록을 좌우로 살짝 넓힌다 */
export function ArticleGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pt-4">
      <SectionLabel as="h2">{label}</SectionLabel>
      <ol className="-mx-3 mt-1 list-none p-0">{children}</ol>
    </div>
  )
}
