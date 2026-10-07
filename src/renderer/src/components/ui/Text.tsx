import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

// 지면의 작은 글자 부품들. 모두 토큰 유틸리티만 쓴다.

/** 명조 강조색 섹션 이름 */
export function SectionLabel({ children, as: Tag = 'div' }: { children: ReactNode; as?: 'div' | 'h2' | 'h3' }) {
  return <Tag className="font-display text-label font-bold tracking-label text-accent">{children}</Tag>
}

/** 기사 위 분류 표시 */
export function Kicker({ children }: { children: ReactNode }) {
  return <div className="text-meta font-bold tracking-kicker text-accent">{children}</div>
}

/** 이탤릭 원제 */
export function OriginalTitle({ children, truncate = false }: { children: ReactNode; truncate?: boolean }) {
  return <div className={cn('text-meta italic text-ink-faint', truncate && 'truncate')}>{children}</div>
}

/** 출처·점수 같은 작은 정보 */
export function Meta({ children }: { children: ReactNode }) {
  return <span className="text-meta text-ink-muted tabular-nums">{children}</span>
}

/** 가장 작은 안내 글자 (저장 상태, 단축키 등) */
export function Caption({ children }: { children: ReactNode }) {
  return <span className="text-caption text-ink-faint tabular-nums">{children}</span>
}

/** 설명 문장 */
export function Help({ children, role }: { children: ReactNode; role?: string }) {
  return (
    <p className="text-meta text-ink-muted" role={role}>
      {children}
    </p>
  )
}
