// ============================================================================
// 메모장
//
// [역할]
// - 기사에 대한 메모를 줄 노트 모양 입력창에 작성
// - 입력을 멈추면 자동 저장, 입력창을 벗어나거나 다른 기사로 넘어갈 때도 저장
// - 저장 상황(입력 중 · 저장 중 · 저장됨 · 실패)을 입력창 아래에 표시
// ============================================================================
import { forwardRef, useEffect, useRef, useState } from 'react'
import { formatTime } from '@/common/lib/format'
import { LinedTextarea } from '@/common/ui/LinedTextarea'
import { Caption } from '@/common/ui/Text'

const SAVE_DELAY_MS = 800 // 입력을 멈춘 뒤 자동 저장까지 기다리는 시간 (밀리초)

interface Props {
    itemId: number // 기사가 바뀌면 입력 상태를 새로 시작하기 위한 키
    initialBody: string
    onSave(body: string): Promise<{ savedAt: string }>
}

// 저장 상황 (입력 전 / 입력 중 / 저장 중 / 저장됨 / 실패)
type Status = { kind: 'idle' } | { kind: 'dirty' } | { kind: 'saving' } | { kind: 'saved'; at: string } | { kind: 'error' }

/**
 * 줄 노트 메모
 *
 * - 입력을 멈추면 자동 저장, 입력창을 벗어날 때도 저장
 *
 * @returns {JSX.Element} 메모 입력창과 저장 상황 표시 (ref는 입력창에 연결)
 */
export const MemoPad = forwardRef<HTMLTextAreaElement, Props>(function MemoPad({ itemId, initialBody, onSave }, ref) {
    // =============================== 상태 ===================================
    const [body, setBody] = useState(initialBody)
    const [status, setStatus] = useState<Status>({ kind: 'idle' })

    // =============================== Ref ===================================
    const unsavedBody = useRef<string | null>(null) // 아직 저장하지 않은 입력 내용 (없으면 null)
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null) // 자동 저장을 기다리는 타이머
    const latestOnSave = useRef(onSave) // 화면이 사라질 때도 가장 최근의 저장 함수를 부르기 위한 보관
    latestOnSave.current = onSave

    // =============================== 계산 ===================================
    // 기다리던 타이머를 취소하고 저장하지 않은 내용을 바로 저장
    const flushUnsavedBody = () => {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = null
        const bodyToSave = unsavedBody.current
        if (bodyToSave === null) return
        unsavedBody.current = null
        setStatus({ kind: 'saving' })
        latestOnSave.current(bodyToSave).then(
            (savedMemo) => setStatus({ kind: 'saved', at: savedMemo.savedAt }),
            () => setStatus({ kind: 'error' })
        )
    }

    // 입력할 때마다 자동 저장 타이머를 다시 시작
    const handleBodyChange = (typedBody: string) => {
        setBody(typedBody)
        unsavedBody.current = typedBody
        setStatus({ kind: 'dirty' })
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(flushUnsavedBody, SAVE_DELAY_MS)
    }

    // 입력창 아래에 보여줄 저장 상황 글
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

    // =============================== useEffect ===================================
    // 다른 기사로 넘어가거나 화면이 사라질 때 저장하지 못한 내용 저장
    useEffect(() => {
        setBody(initialBody)
        setStatus({ kind: 'idle' })
        return () => flushUnsavedBody()
        // initial은 기사가 바뀔 때만 다시 읽음
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [itemId])

    return (
        <div className="flex flex-col gap-2">
            {/* 메모 입력창 */}
            <label htmlFor={`memo-${itemId}`} className="sr-only">
                메모
            </label>
            <LinedTextarea
                ref={ref}
                id={`memo-${itemId}`}
                value={body}
                placeholder="이 기사에 대한 메모 (M)"
                onChange={(changeEvent) => handleBodyChange(changeEvent.target.value)}
                onBlur={flushUnsavedBody}
            />

            {/* 저장 상황 */}
            <div className="min-h-4">
                <Caption>
                    {status.kind === 'saved' && (
                        // 저장될 때마다 작은 ✓ 표시
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
