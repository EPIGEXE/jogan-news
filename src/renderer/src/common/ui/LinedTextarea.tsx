import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/common/lib/cn'

/** 줄 노트 모양 입력란 (줄무늬는 app.css의 .lined-paper) */
export const LinedTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function LinedTextarea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'lined-paper block min-h-42 w-full resize-y rounded-control border border-rule bg-paper-input px-3 text-ink-body',
          'placeholder:text-ink-faint focus:border-ink',
          className
        )}
        {...rest}
      />
    )
  }
)
