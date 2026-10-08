import { forwardRef, useEffect, useRef, useState } from 'react'
import { formatTime } from '../../lib/format'
import { LinedTextarea } from '../ui/LinedTextarea'
import { Caption } from '../ui/Text'

const SAVE_DELAY_MS = 800

interface Props {
  /** 기사가 바뀌면 입력 상태를 새로 시작하기 위한 키 */
  itemId: number
  initial: string
  onSave(body: string): Promise<{ savedAt: string }>
}

type Status = { kind: 'idle' } | { kind: 'dirty' } | { kind: 'saving' } | { kind: 'saved'; at: string } | { kind: 'error' }

/** 줄 노트 메모. 입력을 멈추면 자동 저장하고, 창을 벗어날 때도 저장한다 */
export const MemoPad = forwardRef<HTMLTextAreaElement, Props>(function MemoPad({ itemId, initial, onSave }, ref) {
  const [body, setBody] = useState(initial)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveRef = useRef(onSave)
  saveRef.current = onSave

  const flush = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const value = pending.current
    if (value === null) return
    pending.current = null
    setStatus({ kind: 'saving' })
    saveRef.current(value).then(
      (r) => setStatus({ kind: 'saved', at: r.savedAt }),
      () => setStatus({ kind: 'error' })
    )
  }

  // 다른 기사로 넘어가거나 화면이 사라질 때 저장하지 못한 내용을 저장한다.
  useEffect(() => {
    setBody(initial)
    setStatus({ kind: 'idle' })
    return () => flush()
    // initial은 기사가 바뀔 때만 다시 읽는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  const onChange = (value: string) => {
    setBody(value)
    pending.current = value
    setStatus({ kind: 'dirty' })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_DELAY_MS)
  }

  const statusText =
    status.kind === 'saving'
      ? '저장 중…'
      : status.kind === 'saved'
        ? `자동 저장됨 · ${formatTime(status.at)}`
        : status.kind === 'error'
          ? '저장 실패 — 다시 입력하면 재시도합니다'
          : status.kind === 'dirty'
            ? '입력 중'
            : body
              ? '메모를 쓰면 이 기사는 자동으로 저장됩니다'
              : ''

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`memo-${itemId}`} className="sr-only">
        메모
      </label>
      <LinedTextarea
        ref={ref}
        id={`memo-${itemId}`}
        value={body}
        placeholder="이 기사에 대한 메모 (M)"
        onChange={(e) => onChange(e.target.value)}
        onBlur={flush}
      />
      <div className="min-h-4">
        <Caption>
          {status.kind === 'saved' && (
            // 저장될 때마다 작은 ✓가 찍힌다
            <span key={status.at} className="mr-1 inline-block animate-stamp text-accent">
              ✓
            </span>
          )}
          {statusText}
        </Caption>
      </div>
    </div>
  )
})
