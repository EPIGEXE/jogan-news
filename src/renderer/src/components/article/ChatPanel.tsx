import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import type { ChatMessageDTO, QuickAction } from '@shared/types'
import { ErrorNotice } from '../app/Notice'
import { Button } from '../ui/Button'
import { Chip } from '../ui/Chip'
import { Caption } from '../ui/Text'
import { cn } from '../../lib/cn'

const CITATION = /\[(¶|#)\s*(\d+)\]/g

interface Props {
  messages: ChatMessageDTO[]
  streaming: string | null
  error: string | null
  quickActions: QuickAction[]
  onAsk(question: string): void
  onClear(): void
  /** 인용 번호를 눌렀을 때 (기사 채팅: 문단 번호, 브리핑 채팅: 순위) */
  onCite(n: number): void
  /** 인용 버튼에 마우스를 올렸을 때 보일 설명 (예: 기사 제목) */
  citeTitle?(n: number): string
  /** 있으면 답변마다 "메모에 추가" 버튼 */
  onAddToMemo?(text: string): void
  emptyHint: ReactNode
  placeholder: string
  /** 입력란에 미리 채울 글 (하이라이트에서 "질문"을 누를 때). key가 바뀔 때마다 채우고 입력란에 초점을 준다 */
  draft?: { text: string; key: number } | null
}

/**
 * 답변 글에서 [¶n]·[#n]을 눌러볼 수 있는 인용 버튼으로 바꾼다.
 * caret: 받는 중이면 글 끝에 타자기 커서. fresh: 방금 끝난 답변이면 인용이 차례로 도장처럼 찍힌다.
 */
function CitedText({
  text,
  onCite,
  citeTitle,
  caret = false,
  fresh = false
}: {
  text: string
  onCite(n: number): void
  citeTitle?(n: number): string
  caret?: boolean
  fresh?: boolean
}) {
  const parts: ReactNode[] = []
  let last = 0
  let order = 0
  for (const m of text.matchAll(CITATION)) {
    const n = Number(m[2])
    parts.push(text.slice(last, m.index))
    parts.push(
      <button
        key={`${m.index}-${n}`}
        type="button"
        onClick={() => onCite(n)}
        title={citeTitle?.(n)}
        className={cn(
          'mx-0.5 inline-flex min-h-6 cursor-pointer items-center rounded-control border-0 bg-transparent px-1 align-baseline text-meta font-bold text-accent underline underline-offset-3 hover:bg-paper-sunken hover:text-ink',
          fresh && 'animate-stamp'
        )}
        // 인용 순서대로 조금씩 늦게 찍힌다 (실행 중에 정해지는 값)
        style={fresh ? { animationDelay: `${Math.min(order++ * 60, 600)}ms` } : undefined}
      >
        {m[1]}
        {n}
      </button>
    )
    last = (m.index ?? 0) + m[0].length
  }
  parts.push(text.slice(last))
  return (
    <p className="whitespace-pre-wrap text-reading text-ink-body">
      {parts}
      {caret && (
        <span aria-hidden="true" className="ml-0.5 animate-caret text-accent">
          ▍
        </span>
      )}
    </p>
  )
}

/** AI 질문 패널: 대화, 빠른 질문, 입력란. 신문 Q&A처럼 질문은 명조, 답은 본문 글자 */
export const ChatPanel = forwardRef<HTMLTextAreaElement, Props>(function ChatPanel(p, ref) {
  const [text, setText] = useState('')
  const busy = p.streaming !== null
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // 방금 받기를 마친 답변 (인용이 도장처럼 찍히는 움직임은 이것에만)
  const [freshId, setFreshId] = useState<number | null>(null)
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !busy) {
      const last = [...p.messages].reverse().find((m) => m.role === 'assistant')
      if (last) setFreshId(last.id)
    }
    wasBusy.current = busy
  }, [busy, p.messages])
  useImperativeHandle(ref, () => inputRef.current!, [])

  const draftKey = p.draft?.key
  useEffect(() => {
    if (draftKey === undefined || !p.draft) return
    setText(p.draft.text)
    // 커서를 끝에 두고 이어서 질문을 쓰게 한다
    setTimeout(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key가 바뀔 때만 채운다
  }, [draftKey])

  // 새 답변 조각이 오면 대화 끝이 보이게 한다
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [p.messages.length, p.streaming])

  const submit = () => {
    if (!text.trim() || busy) return
    p.onAsk(text)
    setText('')
  }

  return (
    <div className="flex flex-col gap-4">
      {p.messages.length === 0 && !busy && <Caption>{p.emptyHint}</Caption>}

      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {p.messages.map((m) =>
          m.role === 'user' ? (
            <li key={m.id} className="border-t border-rule pt-3 font-display text-title font-semibold text-ink">
              <span className="mr-2 text-accent">Q.</span>
              {m.content}
            </li>
          ) : (
            <li key={m.id} className="flex flex-col gap-2">
              <CitedText text={m.content} onCite={p.onCite} citeTitle={p.citeTitle} fresh={m.id === freshId} />
              {p.onAddToMemo && (
                <div>
                  <Button variant="text" onClick={() => p.onAddToMemo?.(m.content)}>
                    메모에 추가
                  </Button>
                </div>
              )}
            </li>
          )
        )}
        {busy && (
          <li className="flex flex-col gap-1">
            <CitedText text={p.streaming ?? ''} onCite={p.onCite} citeTitle={p.citeTitle} caret />
            {!p.streaming && <Caption>답하는 중…</Caption>}
          </li>
        )}
      </ol>
      <div ref={endRef} />

      {p.error && <ErrorNotice>{p.error}</ErrorNotice>}

      {p.quickActions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {p.quickActions.map((a) => (
            <Chip key={a.label} disabled={busy} onClick={() => p.onAsk(a.prompt)} title={a.prompt}>
              {a.label}
            </Chip>
          ))}
        </div>
      )}

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label className="sr-only" htmlFor="chat-input">
          질문
        </label>
        <textarea
          ref={inputRef}
          id="chat-input"
          rows={3}
          value={text}
          placeholder={p.placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter로 보내고, Shift+Enter는 줄바꿈 (한글 조합 중에는 보내지 않음)
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          className="w-full resize-y rounded-control border border-rule bg-paper-input px-3 py-2 text-ink-body placeholder:text-ink-faint focus:border-ink"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Caption>Enter 보내기 · Shift+Enter 줄바꿈</Caption>
          <div className="flex items-center gap-3">
            {p.messages.length > 0 && (
              <Button variant="text" disabled={busy} onClick={p.onClear}>
                대화 지우기
              </Button>
            )}
            <Button type="submit" variant="solid" icon="chat" disabled={busy || !text.trim()}>
              질문하기
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
})
