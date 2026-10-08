import { cn } from '../../lib/cn'

/** 불러오는 동안 자리를 잡아 두는 회색 막대. 잉크가 배어들 듯 천천히 짙어졌다 옅어진다 */
export function SkeletonLine({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('h-4 animate-ink-breathe rounded-control bg-paper-sunken', className)} />
}

/** 기사 목록 자리 표시: 제목 두 줄 + 원제 한 줄 묶음을 count개 */
export function SkeletonList({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-label="불러오는 중" className="flex flex-col">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 border-b border-rule-soft py-4">
          <SkeletonLine className="h-5 w-11/12" />
          <SkeletonLine className="h-5 w-2/3" />
          <SkeletonLine className="w-1/3" />
        </div>
      ))}
    </div>
  )
}

/** 본문 자리 표시: 문단 count개 */
export function SkeletonParagraphs({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-label="불러오는 중" className="flex flex-col gap-5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <SkeletonLine />
          <SkeletonLine />
          <SkeletonLine className="w-4/5" />
        </div>
      ))}
    </div>
  )
}
