import { cn } from '../../lib/cn'
import { useToasts } from '../../lib/toast'

/**
 * 화면 아래 가운데에 잠깐 떴다 사라지는 알림.
 * 윤전기에서 쪽지가 나오듯 위에서부터 드러나고, 아래 강조색 선이 줄어들며 남은 시간을 보여준다.
 */
export function Toaster() {
  const toasts = useToasts()
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'relative overflow-hidden rounded-control bg-ink px-4 pt-2 pb-2.5 text-body text-ink-inverse',
            t.leaving ? 'animate-paper-out' : 'animate-paper-feed'
          )}
        >
          {t.message}
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 origin-left animate-timer bg-accent" />
        </div>
      ))}
    </div>
  )
}
