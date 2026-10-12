// ============================================================================
// 줄 노트 입력란
//
// [역할]
// - 줄 노트 모양의 여러 줄 입력란 표시 (줄무늬는 app.css의 .lined-paper)
// ============================================================================
import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/common/lib/cn'

/**
 * 줄 노트 모양 입력란 (줄무늬는 app.css의 .lined-paper)
 *
 * @returns {JSX.Element} 바깥에서 ref로 직접 다룰 수 있는 textarea
 */
export const LinedTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function LinedTextarea(
    { className, ...textareaAttributes },
    textareaRef
) {
    return (
        <textarea
            ref={textareaRef}
            className={cn(
                'lined-paper block min-h-42 w-full resize-y rounded-control border border-rule bg-paper-input px-3 text-ink-body',
                'placeholder:text-ink-faint focus:border-ink',
                className
            )}
            {...textareaAttributes}
        />
    )
})
