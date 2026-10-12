// ============================================================================
// 알림 표시
//
// [역할]
// - 동작 결과를 알리는 짧은 알림을 화면 아래 가운데에 잠깐 표시
// - 남은 표시 시간을 알림 아래의 줄어드는 선으로 표시
// ============================================================================
import { cn } from '@/common/lib/cn'
import { useToasts } from '@/common/lib/toast'

/**
 * 화면 아래 가운데에 잠깐 떴다 사라지는 알림
 *
 * - 윤전기에서 쪽지가 나오듯 위에서부터 드러남
 * - 아래 강조색 선이 줄어들며 남은 시간 표시
 *
 * @returns {JSX.Element} 지금 떠 있는 알림 목록
 */
export function Toaster() {
    const toasts = useToasts() // 지금 떠 있는 알림 목록

    return (
        <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex flex-col items-center gap-2">
            {toasts.map((toastItem) => (
                <div
                    key={toastItem.id}
                    className={cn(
                        'relative overflow-hidden rounded-control bg-ink px-4 pt-2 pb-2.5 text-body text-ink-inverse',
                        toastItem.leaving ? 'animate-paper-out' : 'animate-paper-feed'
                    )}
                >
                    {toastItem.message}
                    {/* 남은 시간 선 */}
                    <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 origin-left animate-timer bg-accent" />
                </div>
            ))}
        </div>
    )
}
